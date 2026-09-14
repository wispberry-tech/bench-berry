import { join, resolve } from "@std/path";
import { createRegistry, resolveConfig } from "../../core/mod.ts";
import type {
  ProjectContext,
  ResolvedConfig,
  WorkspaceId,
  WorkspacePlugin,
} from "../../core/mod.ts";
import { designPlugin } from "../../ws-design/mod.ts";
import { apiPlugin } from "../../ws-api/mod.ts";
import { dbPlugin } from "../../ws-db/mod.ts";
import { SNAPSHOT_DIR, writeSnapshots } from "../../snapshot/mod.ts";
import type { SnapshotResult } from "../../snapshot/mod.ts";
import type { CliContext } from "../main.ts";

export const VERSION = "0.1.0";

export const CONFIG_FILE = "berrybench.config.ts";

/** Project-relative file the vite plugin boots `virtual:berrybench-config` from. */
export const RESOLVED_CONFIG_FILE = ".berrybench/resolved-config.json";

/**
 * True when the shell app is unreachable: the resolved shell dir has no
 * index.html and BERRYBENCH_SHELL_DIR was not set to point elsewhere. In
 * compiled binaries import.meta.dirname points at the executable's extract
 * dir, so the default repo-relative path is the compiled-binary failure case.
 * (The extract may still contain a packages/shell/package.json when the shell
 * is a deno workspace member; index.html is the required shell artifact.)
 */
export async function missingShellDir(shellDir: string): Promise<boolean> {
  if (Deno.env.get("BERRYBENCH_SHELL_DIR") !== undefined) return false;
  try {
    await Deno.stat(join(shellDir, "index.html"));
    return false;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true;
    throw error;
  }
}

/** All workspace plugins, in canonical display order. */
export const plugins: readonly WorkspacePlugin[] = [designPlugin, apiPlugin, dbPlugin];

export const registry = createRegistry(plugins);

export type Out = (s: string) => void;

export function output(ctx: CliContext): { out: Out; err: Out } {
  return {
    out: ctx.stdout ?? ((s: string) => console.log(s)),
    err: ctx.stderr ?? ((s: string) => console.error(s)),
  };
}

/**
 * Preview-app alias roots when the design package lives in a subdir
 * (monorepos: frontend/): the design snapshot's srcRoot ('.' | 'frontend')
 * decides where @stories globs and @pkg framework detection point. Missing or
 * unreadable snapshot keeps the root-relative defaults.
 */
export function designPreviewAliases(
  root: string,
): { storiesRoot: string; packageJsonPath: string; libRoot: string } {
  try {
    const snap = JSON.parse(
      Deno.readTextFileSync(join(root, SNAPSHOT_DIR, "design.json")),
    ) as { srcRoot?: string };
    const base = snap.srcRoot && snap.srcRoot !== "." ? join(root, snap.srcRoot) : root;
    return {
      storiesRoot: join(base, "src"),
      packageJsonPath: join(base, "package.json"),
      libRoot: join(base, "src/lib"),
    };
  } catch {
    return {
      storiesRoot: join(root, "src"),
      packageJsonPath: join(root, "package.json"),
      libRoot: join(root, "src/lib"),
    };
  }
}

export function usage(): string {
  return [
    "berrybench — workspace app CLI",
    "",
    "Usage:",
    "  berrybench init [dir]                            create berrybench.config.ts (default: .)",
    "  berrybench config --print [--json]               print the fully resolved config",
    "  berrybench config enable|disable <id> [dir]      toggle a workspace in berrybench.config.ts",
    "  berrybench detect                                show workspace detection and resolution",
    "  berrybench snapshot [dir] [--strict]             write workspace snapshots to .berrybench/snapshots/",
    "  berrybench dev [dir] [--watch]                   write snapshots; --watch re-writes on changes",
    "  berrybench build [dir]                           write snapshots + resolved-config + manifest",
    "  berrybench --version                             print the version",
    "  berrybench --help                                show this help",
    "",
  ].join("\n");
}

/** Resolve to defaults + detection (no config file): used by `init` to pick initial flags. */
export function defaultResolution(
  plugins: readonly WorkspacePlugin[],
  detected: ReadonlyMap<string, boolean>,
): ResolvedConfig {
  const workspaces = {} as Record<WorkspaceId, { enabled: boolean; enabledBy: "default" | "auto" }>;
  for (const plugin of plugins) {
    const isDetected = detected.get(plugin.id) ?? false;
    workspaces[plugin.id] = {
      enabled: plugin.defaultEnabled || isDetected,
      enabledBy: isDetected ? "auto" : "default",
    };
  }
  return { workspaces, extra: {} };
}

export async function detectAll(
  plugins: readonly WorkspacePlugin[],
  ctx: ProjectContext,
): Promise<Map<string, boolean>> {
  const detected = new Map<string, boolean>();
  for (const plugin of plugins) {
    detected.set(plugin.id, await plugin.detect(ctx));
  }
  return detected;
}

/** resolve(cwd, dir): dir wins when absolute (POSIX rightmost-absolute), else joins cwd. */
export function projectDir(ctx: CliContext, dirArg?: string): string {
  return resolve(ctx.cwd, dirArg ?? ".");
}

/**
 * Step 2 of the CLI lifecycle: resolve the config for `root` (defaults ← detect
 * ← file ← env), then write typed JSON snapshots for every enabled workspace.
 */
export interface SnapshotWrite {
  resolved: ResolvedConfig;
  results: Record<WorkspaceId, SnapshotResult>;
}

/**
 * Persist the resolved config to `.berrybench/resolved-config.json` (pretty
 * JSON, trailing newline) — the file `virtual:berrybench-config` boots from.
 */
export async function writeResolvedConfigFile(
  root: string,
  resolved: ResolvedConfig,
): Promise<string> {
  const dir = join(root, ".berrybench");
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, "resolved-config.json");
  await Deno.writeTextFile(path, `${JSON.stringify(resolved, null, 2)}\n`);
  return path;
}

export async function writeProjectSnapshots(
  root: string,
  env: Record<string, string | undefined>,
): Promise<SnapshotWrite> {
  const resolved = await resolveConfig({ root, env }, plugins);
  const results = await writeSnapshots({ root, plugins, resolved });
  // Every snapshot pass refreshes the resolved config so a `dev` server boots
  // (and reloads) from real data without a prior `build`.
  await writeResolvedConfigFile(root, resolved);
  return { resolved, results };
}

export interface SnapshotFailure {
  id: WorkspaceId;
  error: string;
}

/** One line per workspace: `design: on (auto) · ok` / `db: off · skipped` / `api: on (config) · error: <msg>`. */
export function printSnapshotLines(
  out: Out,
  resolved: ResolvedConfig,
  results: Record<WorkspaceId, SnapshotResult>,
): SnapshotFailure[] {
  const failures: SnapshotFailure[] = [];
  for (const plugin of plugins) {
    const resolution = resolved.workspaces[plugin.id];
    if (!resolution.enabled) {
      out(`${plugin.id}: off · skipped`);
      continue;
    }
    const result = results[plugin.id];
    const error = result?.error ?? (result === undefined ? "no snapshot result" : undefined);
    out(
      `${plugin.id}: on (${resolution.enabledBy}) · ${
        error === undefined ? "ok" : `error: ${error}`
      }`,
    );
    if (error !== undefined) failures.push({ id: plugin.id, error });
  }
  return failures;
}
