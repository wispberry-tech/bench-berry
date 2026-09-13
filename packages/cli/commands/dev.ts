import { dirname, join, SEPARATOR } from "@std/path";
import { createServer, type ViteDevServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { ConfigError } from "../../core/mod.ts";
import { SNAPSHOT_DIR } from "../../snapshot/mod.ts";
import { berrybench } from "../../vite-plugin/mod.ts";
import { previewViteConfig } from "../../preview/config.ts";
import type { CliContext } from "../main.ts";
import {
  designPreviewAliases,
  missingShellDir,
  type Out,
  printSnapshotLines,
  projectDir,
  RESOLVED_CONFIG_FILE,
  usage,
  writeProjectSnapshots,
} from "./shared.ts";

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
    if (arg === "--watch") continue;
    if (arg.startsWith("-")) {
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
  // Probe before writing any .berrybench artifacts: a failing command must
  // leave no side effects behind.
  const shellDir = Deno.env.get("BERRYBENCH_SHELL_DIR") ??
    join(import.meta.dirname!, "../../shell");
  if (await missingShellDir(shellDir)) {
    err(
      `Shell app not found at ${shellDir}; run from a berry-bench checkout or set BERRYBENCH_SHELL_DIR to a berry-bench checkout/packages/shell`,
    );
    return 1;
  }
  try {
    await writeOnce(root, ctx.env, out, err);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  const port = Number(Deno.env.get("BERRYBENCH_PORT") ?? 5173);

  let server: ViteDevServer;
  try {
    server = await createServer({
      root: shellDir,
      base: "/",
      server: {
        port,
        // Deterministic failure on a busy port: the printed URL and the
        // preview iframe base always point at the actually-bound port.
        strictPort: true,
        fs: { strict: false },
      },
      plugins: [tailwindcss(), svelte(), berrybench({ root })],
    });
  } catch (error) {
    err(serverStartupError(error, port, "BERRYBENCH_PORT", "dev server"));
    return 1;
  }

  out(`watching ${root}`);
  // The snapshot loop never resolves (it keeps the process alive); boot it
  // concurrently so a listen failure still surfaces as exit 1.
  const loop = watchLoop(root, ctx.env, out, err);
  try {
    await server.listen();
  } catch (error) {
    err(serverStartupError(error, port, "BERRYBENCH_PORT", "dev server"));
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
  const previewPort = Number(Deno.env.get("BERRYBENCH_PREVIEW_PORT") ?? 5174);
  // Compiled binaries: import.meta.dirname resolves to the executable's
  // extract dir, so the preview app must come from a sibling of the
  // user-supplied shell checkout instead of the build machine's checkout.
  const previewAppRoot = Deno.env.get("BERRYBENCH_SHELL_DIR") !== undefined
    ? join(dirname(shellDir), "preview")
    : undefined;
  let previewServer: ViteDevServer;
  try {
    previewServer = await createServer({
      ...previewViteConfig(root, join(root, "dist/preview"), {
        base: "/preview/",
        ...designPreviewAliases(root),
        ...(previewAppRoot !== undefined ? { root: previewAppRoot } : {}),
      }),
      server: {
        port: previewPort,
        strictPort: true,
        fs: { strict: false },
      },
    });
    await previewServer.listen();
  } catch (error) {
    err(serverStartupError(error, previewPort, "BERRYBENCH_PREVIEW_PORT", "preview server"));
    try {
      await server.close();
    } catch {
      // Not listening; nothing to close.
    }
    return 1;
  }
  const address = previewServer.httpServer?.address();
  const actualPreviewPort = typeof address === "object" && address !== null
    ? address.port
    : previewPort;
  out(`berrybench preview: http://localhost:${actualPreviewPort}/preview/`);
  await loop;
  return 0; // unreachable: watchLoop never resolves
}

/**
 * Classify a dev-server startup failure: an occupied strict port gets a
 * deterministic env-var hint; anything else degrades to the generic message.
 */
function serverStartupError(error: unknown, port: number, envVar: string, label: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("already in use")) {
    return `port ${port} is in use — set ${envVar} to a free port`;
  }
  return `${label} failed: ${message}`;
}

/** One resolve + snapshot write + report pass, shared by the initial run and every watch batch. */
async function writeOnce(
  root: string,
  env: Record<string, string | undefined>,
  out: Out,
  err: Out,
): Promise<void> {
  const { resolved, results } = await writeProjectSnapshots(root, env);
  out("snapshots ready: .berrybench/snapshots/*.json");
  printSnapshotLines(out, resolved, results);
}

/**
 * Deno.watchFs loop with a 300ms debounce. Events under the snapshot output
 * dir and the resolved-config file are ignored so our own writes cannot
 * retrigger a batch; node_modules/.git/dist noise is ignored too. A per-batch
 * failure is a warning (keep watching so a fix hot-applies); a broken watcher
 * itself is fatal — a dead watcher with live servers misleads more than a
 * stopped session, so it prints the error and exits 1.
 */
const IGNORED_PATH_SEGMENTS = ["/node_modules/", "/.git/", "/dist/"] as const;
async function watchLoop(
  root: string,
  env: Record<string, string | undefined>,
  out: Out,
  err: Out,
): Promise<void> {
  const snapDir = join(root, SNAPSHOT_DIR);
  const resolvedConfigPath = join(root, RESOLVED_CONFIG_FILE);
  const ownOutput = (p: string): boolean =>
    p === snapDir || p.startsWith(`${snapDir}${SEPARATOR}`) || p === resolvedConfigPath ||
    IGNORED_PATH_SEGMENTS.some((seg) => p.includes(seg) || p.endsWith(seg.slice(0, -1)));
  const watcher = Deno.watchFs(root, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(`watcher failed: ${message}`);
    Deno.exit(1);
  }
}
