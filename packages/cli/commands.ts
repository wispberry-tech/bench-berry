import { join, resolve } from '@std/path';
import { createRegistry, formatConfigFile, resolveConfig, ConfigError } from '../core/mod.ts';
import type {
  ProjectContext,
  ResolvedConfig,
  WorkspaceId,
  WorkspacePlugin,
  WorkspaceResolution,
} from '../core/mod.ts';
import { designPlugin } from '../ws-design/mod.ts';
import { apiPlugin } from '../ws-api/mod.ts';
import { dbPlugin } from '../ws-db/mod.ts';
import type { CliContext } from './main.ts';

export const VERSION = '0.1.0';

const CONFIG_FILE = 'berrybench.config.ts';

/** All workspace plugins, in canonical display order. */
export const plugins: readonly WorkspacePlugin[] = [designPlugin, apiPlugin, dbPlugin];

const registry = createRegistry(plugins);

function noteFor(plugin: WorkspacePlugin, detected: boolean): string {
  if (detected) return 'on (auto)';
  return plugin.defaultEnabled ? 'off (detected)' : 'off (default)';
}

/** Resolve to defaults + detection (no config file): used by `init` to pick initial flags. */
function defaultResolution(
  plugins: readonly WorkspacePlugin[],
  detected: ReadonlyMap<string, boolean>,
): ResolvedConfig {
  const workspaces = {} as Record<WorkspaceId, WorkspaceResolution>;
  for (const plugin of plugins) {
    const isDetected = detected.get(plugin.id) ?? false;
    workspaces[plugin.id] = {
      enabled: plugin.defaultEnabled || isDetected,
      enabledBy: isDetected ? 'auto' : 'default',
    };
  }
  return { workspaces };
}

export function usage(): string {
  return [
    'berrybench — workspace app CLI',
    '',
    'Usage:',
    '  berrybench init [dir]                create berrybench.config.ts (default: .)',
    '  berrybench config --print [--json]   print the fully resolved config',
    '  berrybench detect                    show workspace detection and resolution',
    '  berrybench --version                 print the version',
    '  berrybench --help                    show this help',
    '',
  ].join('\n');
}

type Out = (s: string) => void;

function output(ctx: CliContext): { out: Out; err: Out } {
  return {
    out: ctx.stdout ?? ((s: string) => console.log(s)),
    err: ctx.stderr ?? ((s: string) => console.error(s)),
  };
}

export async function dispatch(args: string[], ctx: CliContext): Promise<number> {
  const { out, err } = output(ctx);
  const [cmd, ...rest] = args;

  if (cmd === undefined || cmd === '--help') {
    out(usage());
    return 0;
  }
  if (cmd === '--version') {
    out(VERSION);
    return 0;
  }

  switch (cmd) {
    case 'init':
      return cmdInit(rest, ctx, out, err);
    case 'config':
      return cmdConfig(rest, ctx, out, err);
    case 'detect':
      return cmdDetect(rest, ctx, out, err);
    default:
      err(`unknown command: ${cmd}`);
      err(usage());
      return 1;
  }
}

async function detectAll(
  plugins: readonly WorkspacePlugin[],
  ctx: ProjectContext,
): Promise<Map<string, boolean>> {
  const detected = new Map<string, boolean>();
  for (const plugin of plugins) {
    detected.set(plugin.id, await plugin.detect(ctx));
  }
  return detected;
}

async function cmdInit(rest: string[], ctx: CliContext, out: Out, err: Out): Promise<number> {
  const [dirArg, ...extra] = rest;
  if (extra.length > 0) {
    err(`unknown command: ${extra[0]}`);
    err(usage());
    return 1;
  }
  // resolve(cwd, dir): dir wins when absolute (POSIX rightmost-absolute), else joins cwd.
  const proj = resolve(ctx.cwd, dirArg ?? '.');
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

  const flags = registry.workspaceIds()
    .map((id) => `${id}: ${resolved.workspaces[id as WorkspaceId].enabled ? 'on' : 'off'}`)
    .join(', ');
  out(`wrote ${CONFIG_FILE} (${flags})`);
  return 0;
}

async function cmdConfig(rest: string[], ctx: CliContext, out: Out, err: Out): Promise<number> {
  let json = false;
  for (const arg of rest) {
    if (arg === '--print') continue;
    if (arg === '--json') {
      json = true;
      continue;
    }
    err(`unknown command: ${arg}`);
    err(usage());
    return 1;
  }

  let resolved: ResolvedConfig;
  try {
    resolved = await resolveConfig({ root: ctx.cwd, env: ctx.env }, plugins);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  if (json) {
    out(JSON.stringify(resolved, null, 2));
    return 0;
  }

  for (const id of registry.workspaceIds()) {
    const r = resolved.workspaces[id as WorkspaceId];
    out(`${id}: ${r.enabled ? 'on' : 'off'} (${r.enabledBy})`);
  }
  if (resolved.theme !== undefined) {
    const parts: string[] = [];
    if (resolved.theme.accent !== undefined) parts.push(`accent=${resolved.theme.accent}`);
    if (resolved.theme.defaultTheme !== undefined) {
      parts.push(`default=${resolved.theme.defaultTheme}`);
    }
    if (parts.length > 0) out(`theme: ${parts.join(' ')}`);
  }
  return 0;
}

async function cmdDetect(rest: string[], ctx: CliContext, out: Out, err: Out): Promise<number> {
  if (rest.length > 0) {
    err(`unknown command: ${rest[0]}`);
    err(usage());
    return 1;
  }

  let detected: Map<string, boolean>;
  let resolved: ResolvedConfig;
  try {
    const projectCtx: ProjectContext = { root: ctx.cwd, env: ctx.env };
    detected = await detectAll(plugins, projectCtx);
    resolved = await resolveConfig(projectCtx, plugins);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  const header = ['id', 'label', 'defaultEnabled', 'detected', 'enabled', 'enabledBy'];
  const rows = registry.workspaceIds().map((id) => {
    const plugin = registry.byId(id as WorkspaceId)!;
    const r = resolved.workspaces[id as WorkspaceId];
    return [
      id,
      plugin.label,
      String(plugin.defaultEnabled),
      String(detected.get(id) ?? false),
      r.enabled ? 'on' : 'off',
      r.enabledBy,
    ];
  });
  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...rows.map((row) => row[col].length))
  );
  const formatRow = (cells: readonly string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join('  ').replace(/\s+$/, '');

  out(formatRow(header));
  for (const row of rows) out(formatRow(row));
  return 0;
}