import { join, SEPARATOR } from '@std/path';
import { ConfigError } from '../../core/mod.ts';
import { SNAPSHOT_DIR } from '../../snapshot/mod.ts';
import type { CliContext } from '../main.ts';
import {
  printSnapshotLines,
  projectDir,
  usage,
  writeProjectSnapshots,
  type Out,
} from './shared.ts';

export async function cmdDev(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  let watch = false;
  let dirArg: string | undefined;
  for (const arg of rest) {
    if (arg === '--watch') {
      watch = true;
      continue;
    }
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

  if (!watch) return 0;
  out(`watching ${root}`);
  await watchLoop(root, ctx.env, out, err);
  return 0; // unreachable: watchLoop never resolves
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
 * dir are ignored so our own writes cannot retrigger a batch.
 */
async function watchLoop(
  root: string,
  env: Record<string, string | undefined>,
  out: Out,
  err: Out,
): Promise<void> {
  const snapDir = join(root, SNAPSHOT_DIR);
  const insideSnapDir = (p: string): boolean => p === snapDir || p.startsWith(`${snapDir}${SEPARATOR}`);
  const watcher = Deno.watchFs(root, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  for await (const event of watcher) {
    if (event.paths.length > 0 && event.paths.every(insideSnapDir)) continue;
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