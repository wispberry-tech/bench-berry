import { ConfigError, readFileConfig, resolveConfig, writeConfigFile } from '../../core/mod.ts';
import type { ProjectContext, ResolvedConfig, WorkspaceId } from '../../core/mod.ts';
import type { CliContext } from '../main.ts';
import {
  plugins,
  projectDir,
  registry,
  usage,
  type Out,
} from './shared.ts';

export async function cmdConfig(rest: string[], ctx: CliContext, out: Out, err: Out): Promise<number> {
  const [sub, ...more] = rest;
  if (sub === 'enable' || sub === 'disable') {
    return cmdConfigSet(sub, more, ctx, out, err);
  }

  // Existing --print [--json] behavior, unchanged.
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

async function cmdConfigSet(
  verb: 'enable' | 'disable',
  more: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  const [idArg, dirArg, ...extra] = more;
  if (idArg === undefined) {
    err(`usage: berrybench config ${verb} <id> [dir]`);
    return 1;
  }
  if (extra.length > 0) {
    err(`unknown command: ${extra[0]}`);
    err(usage());
    return 1;
  }
  if (!plugins.some((plugin) => plugin.id === idArg)) {
    err(`unknown workspace: ${idArg}`);
    return 1;
  }
  const id = idArg as WorkspaceId;
  const enabled = verb === 'enable';

  const projectCtx: ProjectContext = { root: projectDir(ctx, dirArg), env: ctx.env };

  // Read the current file ({} default when absent); a corrupt file is a hard
  // error so the settings writer can never clobber it.
  let file: unknown;
  try {
    file = await readFileConfig(projectCtx.root);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }
  if (file === undefined) file = {};

  let resolved: ResolvedConfig;
  try {
    resolved = await resolveConfig(projectCtx, plugins, file);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // resolveConfig hard-fails when no workspace ends up enabled — but this
    // save may be the thing that enables one (fresh bootstrap) or disables the
    // last one. Re-resolve with the target temporarily enabled so the merge
    // succeeds uncorrupted, then apply the real toggle below.
    const fileObj = file as Record<string, unknown>;
    const workspaces = (typeof fileObj.workspaces === 'object' && fileObj.workspaces !== null)
      ? fileObj.workspaces as Record<string, unknown>
      : {};
    const existing = (typeof workspaces[id] === 'object' && workspaces[id] !== null)
      ? workspaces[id] as Record<string, unknown>
      : {};
    const bootFile = { ...fileObj, workspaces: { ...workspaces, [id]: { ...existing, enabled: true } } };
    try {
      resolved = await resolveConfig(projectCtx, plugins, bootFile);
    } catch (second) {
      if (second instanceof ConfigError) {
        err(second.message);
        return 1;
      }
      throw second;
    }
  }

  const target = resolved.workspaces[id];
  resolved.workspaces[id] = { ...target, enabled, enabledBy: 'config' };
  await writeConfigFile(projectCtx.root, resolved);
  out(`${id}: ${enabled ? 'on' : 'off'}`);
  return 0;
}