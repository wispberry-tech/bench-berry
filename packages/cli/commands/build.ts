import { join } from '@std/path';
import { build as viteBuild } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ConfigError } from '../../core/mod.ts';
import { berrybench } from '../../vite-plugin/mod.ts';
import type { CliContext } from '../main.ts';
import {
  printSnapshotLines,
  projectDir,
  RESOLVED_CONFIG_FILE,
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

  // writeProjectSnapshots already refreshed .berrybench/resolved-config.json;
  // this command additionally writes the manifest and the shell bundle.
  const resolvedConfigPath = join(root, RESOLVED_CONFIG_FILE);
  const manifestPath = join(root, '.berrybench/manifest.json');
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    workspaces: written.results,
  };
  await Deno.mkdir(join(root, '.berrybench'), { recursive: true });
  await Deno.writeTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  out(resolvedConfigPath);
  out(manifestPath);
  printSnapshotLines(out, written.resolved, written.results);

  const shellDir = Deno.env.get('BERRYBENCH_SHELL_DIR') ?? join(import.meta.dirname!, '../../shell');
  const outDir = join(root, 'dist');
  try {
    await viteBuild({
      root: shellDir,
      base: './',
      build: {
        outDir,
        emptyOutDir: true,
      },
      plugins: [svelte(), berrybench({ root })],
    });
  } catch (error) {
    err(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  out(`built ${outDir}`);
  return 0;
}