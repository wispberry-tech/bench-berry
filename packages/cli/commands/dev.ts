import { join, SEPARATOR } from '@std/path';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ConfigError } from '../../core/mod.ts';
import { SNAPSHOT_DIR } from '../../snapshot/mod.ts';
import { berrybench } from '../../vite-plugin/mod.ts';
import { previewViteConfig } from '../../preview/config.ts';
import type { CliContext } from '../main.ts';
import {
  printSnapshotLines,
  projectDir,
  usage,
  writeProjectSnapshots,
  RESOLVED_CONFIG_FILE,
  type Out,
} from './shared.ts';

export async function cmdDev(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  let dirArg: string | undefined;
  for (const arg of rest) {
    // `--watch` is accepted for backwards compatibility; the snapshot loop now
    // always runs so settings/snapshot rewrites reach the dev server.
    if (arg === '--watch') continue;
    if (arg.startsWith('-')) {
      err(`unknown command: ${arg}`);
      err(usage());
      return 1;
    }
    if (dirArg !== undefined) {
      err(`unknown command: ${arg}`);
      err(usage());
      return 1;
    }
    dirArg = arg;
  }

  const root = projectDir(ctx, dirArg);
  try {
    await writeOnce(root, ctx.env, out, err);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  const shellDir = Deno.env.get('BERRYBENCH_SHELL_DIR') ?? join(import.meta.dirname!, '../../shell');
  if (await missingShellDir(shellDir)) {
    err(
      `Shell app not found at ${shellDir}; run from a berry-bench checkout or set BERRYBENCH_SHELL_DIR to a berry-bench checkout/packages/shell`,
    );
    return 1;
  }
  const port = Number(Deno.env.get('BERRYBENCH_PORT') ?? 5173);

  let server: ViteDevServer;
  try {
    server = await createServer({
      root: shellDir,
      base: '/',
      server: {
        port,
        fs: { strict: false },
      },
      plugins: [svelte(), berrybench({ root })],
    });
  } catch (error) {
    err(`dev server failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  out(`watching ${root}`);
  // The snapshot loop never resolves (it keeps the process alive); boot it
  // concurrently so a listen failure still surfaces as exit 1.
  const loop = watchLoop(root, ctx.env, out, err);
  try {
    await server.listen();
  } catch (error) {
    err(`dev server failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await server.close();
    } catch {
      // Not listening; nothing to close.
    }
    return 1;
  }
  out(`berrybench dev: http://localhost:${port}/`);
  // Second dev server: the live component preview iframe app (the Canvas).
  // It serves the preview app at '/preview/' and reads story files from the
  // project's src via the @stories alias — outside the preview app's own
  // vite root, hence the relaxed fs strictness.
  const previewPort = Number(Deno.env.get('BERRYBENCH_PREVIEW_PORT') ?? 5174);
  let previewServer: ViteDevServer;
  try {
    previewServer = await createServer({
      ...previewViteConfig(root, join(root, 'dist/preview'), { base: '/preview/' }),
      server: {
        port: previewPort,
        fs: { strict: false },
      },
    });
    await previewServer.listen();
  } catch (error) {
    err(`preview server failed: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await server.close();
    } catch {
      // Not listening; nothing to close.
    }
    return 1;
  }
  const address = previewServer.httpServer?.address();
  const actualPreviewPort =
    typeof address === 'object' && address !== null ? address.port : previewPort;
  out(`berrybench preview: http://localhost:${actualPreviewPort}/preview/`);
  await loop;
  return 0; // unreachable: watchLoop never resolves
}

/**
 * True when the shell app is unreachable: the resolved shell dir does not
 * exist and BERRYBENCH_SHELL_DIR was not set to point elsewhere. In compiled
 * binaries import.meta.dirname points at the executable's extract dir, so the
 * default repo-relative path is the compiled-binary failure case.
 */
async function missingShellDir(shellDir: string): Promise<boolean> {
  if (Deno.env.get('BERRYBENCH_SHELL_DIR') !== undefined) return false;
  try {
    await Deno.stat(shellDir);
    return false;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true;
    throw error;
  }
}

/** One resolve + snapshot write + report pass, shared by the initial run and every watch batch. */
async function writeOnce(
  root: string,
  env: Record<string, string | undefined>,
  out: Out,
  err: Out,
): Promise<void> {
  const { resolved, results } = await writeProjectSnapshots(root, env);
  out('snapshots ready: .berrybench/snapshots/*.json');
  printSnapshotLines(out, resolved, results);
}

/**
 * Deno.watchFs loop with a 300ms debounce. Events under the snapshot output
 * dir and the resolved-config file are ignored so our own writes cannot
 * retrigger a batch.
 */
async function watchLoop(
  root: string,
  env: Record<string, string | undefined>,
  out: Out,
  err: Out,
): Promise<void> {
  const snapDir = join(root, SNAPSHOT_DIR);
  const resolvedConfigPath = join(root, RESOLVED_CONFIG_FILE);
  const ownOutput = (p: string): boolean =>
    p === snapDir || p.startsWith(`${snapDir}${SEPARATOR}`) || p === resolvedConfigPath;
  const watcher = Deno.watchFs(root, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  for await (const event of watcher) {
    if (event.paths.length > 0 && event.paths.every(ownOutput)) continue;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void (async () => {
        try {
          await writeOnce(root, env, out, err);
        } catch (error) {
          // A mid-session resolution failure (e.g. config breakage) is a
          // warning, not a crash: keep watching so a fix hot-applies.
          const message = error instanceof Error ? error.message : String(error);
          err(`snapshot failed: ${message}`);
        }
      })();
    }, 300);
  }
}