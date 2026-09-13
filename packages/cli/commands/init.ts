import { join, relative } from "@std/path";
import { formatConfigFile } from "../../core/mod.ts";
import type { ProjectContext, WorkspacePlugin } from "../../core/mod.ts";
import { designRootOf } from "../../ws-design/mod.ts";
import type { CliContext } from "../main.ts";
import {
  CONFIG_FILE,
  defaultResolution,
  detectAll,
  type Out,
  plugins,
  projectDir,
  usage,
} from "./shared.ts";

function noteFor(plugin: WorkspacePlugin, detected: boolean): string {
  if (detected) return "on (auto)";
  return plugin.defaultEnabled ? "off (detected)" : "off (default)";
}

export async function cmdInit(
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
    .map((plugin) => `${plugin.id}: ${resolved.workspaces[plugin.id].enabled ? "on" : "off"}`)
    .join(", ");
  out(`wrote ${CONFIG_FILE} (${flags})`);
  await scaffoldStories(proj, out);
  return 0;
}

/**
 * Story convention (§4.6 v2): a fresh project (no `src/` yet) gets a
 * components pair copied verbatim from templates/stories/ so `deno task dev`
 * has something to render. Existing src/ trees are left alone.
 */
async function scaffoldStories(proj: string, out: Out): Promise<void> {
  const designRoot = (await designRootOf(proj)) ?? proj;
  const srcDir = join(designRoot, "src");
  try {
    const stat = await Deno.stat(srcDir);
    if (stat.isDirectory) return;
  } catch {
    // No src/ yet: proceed with the scaffold.
  }
  const templatesDir = join(import.meta.dirname!, "../../../templates/stories");
  const componentsDir = join(srcDir, "components");
  // Probe the template source before touching the project: compiled binaries
  // cannot reach the repo-relative path (import.meta.dirname is the
  // executable's extract dir), and init must still succeed there — the config
  // write above is the contract, the scaffold is best-effort.
  try {
    await Deno.stat(join(templatesDir, "button.story.svelte"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  const storyFile = join(componentsDir, "button.story.svelte");
  try {
    await Deno.mkdir(componentsDir, { recursive: true });
    await Deno.copyFile(join(templatesDir, "button.svelte"), join(componentsDir, "button.svelte"));
    await Deno.copyFile(join(templatesDir, "button.story.svelte"), storyFile);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Template set half-present (shouldn't happen in a checkout): leave the
      // project as untouched as possible rather than a broken pair.
      return;
    }
    throw error;
  }
  const rel = relative(proj, storyFile);
  out(`scaffolded ${rel.startsWith("..") ? storyFile : rel} (story convention)`);
}
