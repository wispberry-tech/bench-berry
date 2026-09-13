import { join } from '@std/path';
import { ConfigError } from '../../core/mod.ts';
import type { CliContext } from '../main.ts';
import {
  printSnapshotLines,
  projectDir,
  usage,
  writeProjectSnapshots,
  VERSION,
  type Out,
  type SnapshotWrite,
} from './shared.ts';

export async function cmdBuild(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  const [dirArg, ...extra] = rest;
  if (extra.length > 0) {
    err(`unknown command: ${extra[0]}`);
    err(usage());
    return 1;
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

  const berrybenchDir = join(root, '.berrybench');
  await Deno.mkdir(berrybenchDir, { recursive: true });

  const resolvedConfigPath = join(berrybenchDir, 'resolved-config.json');
  await Deno.writeTextFile(resolvedConfigPath, `${JSON.stringify(written.resolved, null, 2)}\n`);

  const manifestPath = join(berrybenchDir, 'manifest.json');
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    workspaces: written.results,
  };
  await Deno.writeTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  out(resolvedConfigPath);
  out(manifestPath);
  printSnapshotLines(out, written.resolved, written.results);
  return 0;
}