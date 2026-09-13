import { ConfigError } from '../../core/mod.ts';
import type { CliContext } from '../main.ts';
import {
  printSnapshotLines,
  projectDir,
  usage,
  writeProjectSnapshots,
  type Out,
  type SnapshotWrite,
} from './shared.ts';

export async function cmdSnapshot(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  let strict = false;
  let dirArg: string | undefined;
  for (const arg of rest) {
    if (arg === '--strict') {
      strict = true;
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
  let written: SnapshotWrite;
  try {
    written = await writeProjectSnapshots(root, ctx.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  const failures = printSnapshotLines(out, written.resolved, written.results);
  if (strict && failures.length > 0) {
    for (const failure of failures) {
      err(`error: ${failure.id} snapshot failed: ${failure.error}`);
    }
    err(`error: snapshot --strict: ${failures.length} workspace(s) produced error snapshots`);
    return 1;
  }
  return 0;
}