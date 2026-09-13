import { join } from '@std/path';
import { formatConfigFile } from '../../core/mod.ts';
import type { ProjectContext, WorkspacePlugin } from '../../core/mod.ts';
import type { CliContext } from '../main.ts';
import {
  CONFIG_FILE,
  defaultResolution,
  detectAll,
  plugins,
  projectDir,
  usage,
  type Out,
} from './shared.ts';

function noteFor(plugin: WorkspacePlugin, detected: boolean): string {
  if (detected) return 'on (auto)';
  return plugin.defaultEnabled ? 'off (detected)' : 'off (default)';
}

export async function cmdInit(rest: string[], ctx: CliContext, out: Out, err: Out): Promise<number> {
  const [dirArg, ...extra] = rest;
  if (extra.length > 0) {
    err(`unknown command: ${extra[0]}`);
    err(usage());
    return 1;
  }
  // resolve(cwd, dir): dir wins when absolute (POSIX rightmost-absolute), else joins cwd.
  const proj = projectDir(ctx, dirArg);
  await Deno.mkdir(proj, { recursive: true });
  const configPath = join(proj, CONFIG_FILE);
  try {
    await Deno.stat(configPath);
    err(`${CONFIG_FILE} already exists — edit it`);
    return 1;
  } catch {
    // Missing file: proceed with scaffolding.
  }

  const projectCtx: ProjectContext = { root: proj, env: ctx.env };
  const detected = await detectAll(plugins, projectCtx);
  const notes: Record<string, string> = {};
  for (const plugin of plugins) {
    notes[plugin.id] = noteFor(plugin, detected.get(plugin.id) ?? false);
  }
  const resolved = defaultResolution(plugins, detected);
  await Deno.writeTextFile(configPath, formatConfigFile(resolved, notes));

  const flags = plugins
    .map((plugin) => `${plugin.id}: ${resolved.workspaces[plugin.id].enabled ? 'on' : 'off'}`)
    .join(', ');
  out(`wrote ${CONFIG_FILE} (${flags})`);
  return 0;
}