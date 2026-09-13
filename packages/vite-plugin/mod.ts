// packages/vite-plugin/mod.ts
// Vite plugin exposing BerryBench build output as virtual modules:
//   virtual:berrybench-config            -> .berrybench/resolved-config.json
//   virtual:berrybench-snapshots         -> aggregate: one key per ENABLED workspace
//   virtual:berrybench-snapshots/<id>    -> .berrybench/snapshots/<id>.json
//   virtual:berrybench-env               -> { dev, preview: { base } } (dev vs build)
// Missing or unparseable files degrade to a safe module instead of failing the
// build (load failures are warnings, never build errors — see §5 of the plan).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isAbsolute, join, relative } from "@std/path";
import { ALL_DISABLED_MESSAGE, resolveConfig, writeConfigFile } from "../core/config.ts";
import type { ResolvedConfig } from "../core/config.ts";
import { WORKSPACE_IDS, type WorkspaceId } from "../core/workspace.ts";
import { apiPlugin } from "../ws-api/mod.ts";
import { dbPlugin } from "../ws-db/mod.ts";
import { designPlugin } from "../ws-design/mod.ts";
import { resolvePreviewBase } from "../preview/config.ts";

export const CONFIG_MODULE = "virtual:berrybench-config";
export const SNAPSHOTS_MODULE = "virtual:berrybench-snapshots";
export const SNAPSHOTS_PREFIX = "virtual:berrybench-snapshots/";
/** Env module consumed by the shell: `{ dev, preview: { base } }`. */
export const ENV_MODULE = "virtual:berrybench-env";
/** Project-relative snapshot directory; mirrors packages/snapshot/mod.ts. */
export const SNAPSHOT_DIR = ".berrybench/snapshots";

const CONFIG_FILE = ".berrybench/resolved-config.json";
const CONFIG_FILE_NAME = "berrybench.config.ts";
const BERRYBENCH_DIR = ".berrybench";
/** Canonical workspace ids; the single source of truth lives in core/workspace.ts. */
const SNAPSHOT_IDS = WORKSPACE_IDS;

/**
 * The workspace plugins whose ids appear in a resolved config; mirrors
 * packages/cli/commands/shared.ts.
 */
const PLUGINS = [designPlugin, apiPlugin, dbPlugin];

/** Return the workspace id when `id` is a known snapshot module, else undefined. */
function snapshotIdOf(id: string): string | undefined {
  if (!id.startsWith(SNAPSHOTS_PREFIX)) return undefined;
  const name = id.slice(SNAPSHOTS_PREFIX.length);
  return (SNAPSHOT_IDS as readonly string[]).includes(name) ? name : undefined;
}

/** Validated delta body for POST /__berrybench/config (absent keys are unchanged). */
interface ConfigDelta {
  workspaces?: Record<string, { enabled: boolean }>;
  theme?: { accent?: string };
}

/** Parse + validate the settings write-back body; throws Error with a user-facing message. */
function parseConfigDelta(raw: string): ConfigDelta {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("body must be a JSON object");
  }
  const delta = body as Record<string, unknown>;
  const parsed: ConfigDelta = {};

  if (delta.workspaces !== undefined) {
    if (
      typeof delta.workspaces !== "object" || delta.workspaces === null ||
      Array.isArray(delta.workspaces)
    ) {
      throw new Error("workspaces must be an object");
    }
    parsed.workspaces = {};
    for (const [id, cfg] of Object.entries(delta.workspaces as Record<string, unknown>)) {
      if (!(SNAPSHOT_IDS as readonly string[]).includes(id)) {
        throw new Error(`unknown workspace id: ${id}`);
      }
      if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
        throw new Error(`workspace ${id}: expected an object`);
      }
      const enabled = (cfg as Record<string, unknown>).enabled;
      if (typeof enabled !== "boolean") {
        throw new Error(`workspace ${id}: enabled must be a boolean`);
      }
      parsed.workspaces[id] = { enabled };
    }
  }

  if (delta.theme !== undefined) {
    if (typeof delta.theme !== "object" || delta.theme === null || Array.isArray(delta.theme)) {
      throw new Error("theme must be an object");
    }
    const theme = delta.theme as Record<string, unknown>;
    parsed.theme = {};
    if (theme.accent !== undefined) {
      if (typeof theme.accent !== "string") throw new Error("theme.accent must be a string");
      parsed.theme.accent = theme.accent;
    }
  }
  return parsed;
}

/**
 * The current resolved config for a merge: `.berrybench/resolved-config.json`
 * when readable, else a fresh resolution from the config file + detection so
 * the merge never clobbers data.
 */
async function currentResolvedConfig(root: string): Promise<ResolvedConfig> {
  try {
    const text = await Deno.readTextFile(join(root, CONFIG_FILE));
    return JSON.parse(text) as ResolvedConfig;
  } catch {
    return resolveConfig({ root, env: Deno.env.toObject() }, PLUGINS);
  }
}

/** Merge a validated delta onto the current config; toggled workspaces are stamped as ui-managed. */
function mergeConfigDelta(current: ResolvedConfig, delta: ConfigDelta): ResolvedConfig {
  const merged: ResolvedConfig = {
    ...current,
    workspaces: { ...current.workspaces },
  };
  for (const [id, cfg] of Object.entries(delta.workspaces ?? {})) {
    const workspaceId = id as WorkspaceId;
    // Preserve the workspace's existing fields (notably `source`) while
    // applying the toggle and the ui provenance stamp.
    merged.workspaces[workspaceId] = {
      ...merged.workspaces[workspaceId],
      enabled: cfg.enabled,
      enabledBy: "ui",
    };
  }
  if (delta.theme !== undefined) {
    const theme = { ...(merged.theme ?? {}) as NonNullable<ResolvedConfig["theme"]> };
    if (delta.theme.accent !== undefined) theme.accent = delta.theme.accent;
    merged.theme = theme;
  }
  return merged;
}

/** Marker for oversized write-back bodies; the middleware maps this to HTTP 413. */
class RequestTooLargeError extends Error {}

/** Cap for the settings write-back body (a delta is tiny; 1 MiB is generous). */
const MAX_BODY_UTF16 = 1024 * 1024;

function readRequestBody(req: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    if (data.length > MAX_BODY_UTF16) return; // already rejecting; stop accumulating
    data += chunk;
    if (data.length > MAX_BODY_UTF16) {
      reject(new RequestTooLargeError("request body too large (max 1 MiB)"));
    }
  });
  req.on("end", () => resolve(data));
  req.on("error", reject);
  return promise;
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function berrybench(opts: { root: string }): Plugin {
  const configPath = join(opts.root, CONFIG_FILE);
  const snapshotsPath = join(opts.root, SNAPSHOT_DIR);
  const watchRoot = join(opts.root, BERRYBENCH_DIR);

  // Captured at configResolved; load() emits the dev/build variant so the one
  // virtual module serves both modes (build + `vite preview` -> prod object).
  let envState = { dev: false };

  return {
    name: "berrybench",

    configResolved(config) {
      envState = {
        // 'serve' + a non-production mode is the dev server; anything else
        // (build, production-ish serve) emits the static relative base.
        dev: config.command === "serve" && config.mode !== "production",
      };
    },

    resolveId(source) {
      if (source === CONFIG_MODULE || source === SNAPSHOTS_MODULE || source === ENV_MODULE) {
        return source;
      }
      const id = snapshotIdOf(source);
      return id !== undefined ? source : null;
    },

    async load(id) {
      if (id === ENV_MODULE) {
        return `export default ${
          JSON.stringify({
            dev: envState.dev,
            preview: { base: envState.dev ? resolvePreviewBase(true) : "./preview/" },
          })
        };`;
      }
      if (id === CONFIG_MODULE) {
        try {
          const text = await Deno.readTextFile(configPath);
          return `export default ${JSON.stringify(JSON.parse(text))};`;
        } catch {
          // Missing or unparseable resolved config: boot with an empty object.
          return "export default {};";
        }
      }
      if (id === SNAPSHOTS_MODULE) {
        // Aggregate: exactly one key per ENABLED workspace (disabled ids are
        // never present); a missing/unparseable snapshot file degrades to an
        // error object per key instead of failing the load.
        try {
          const text = await Deno.readTextFile(configPath);
          const resolved = JSON.parse(text) as ResolvedConfig;
          // Keys come from the resolved config's OWN workspace entries (not a
          // static list), so a new workspace id aggregates automatically.
          const enabled: Record<string, unknown> = {};
          for (const [name, ws] of Object.entries(resolved.workspaces ?? {})) {
            if (ws?.enabled !== true) continue;
            try {
              const snap = await Deno.readTextFile(join(snapshotsPath, `${name}.json`));
              enabled[name] = JSON.parse(snap);
            } catch {
              enabled[name] = { error: `no snapshot for ${name}` };
            }
          }
          return `export default ${JSON.stringify(enabled)};`;
        } catch {
          // No resolved config on disk: no workspace is enabled.
          return "export default {};";
        }
      }
      const snapshot = snapshotIdOf(id);
      if (snapshot !== undefined) {
        try {
          const text = await Deno.readTextFile(join(snapshotsPath, `${snapshot}.json`));
          return `export default ${JSON.stringify(JSON.parse(text))};`;
        } catch {
          return `export default { error: 'no snapshot for ${snapshot}' };`;
        }
      }
      return null;
    },

    configureServer(server) {
      // The dev server's own watcher only covers the vite root (the shell
      // dir), so .berrybench rewrites under the project root never reach the
      // watcher. Watch it explicitly and invalidate the virtual modules here:
      // vite 7 dispatches the plugin `watchChange` hook via hookParallel,
      // which discards return values, so the hook cannot drive invalidation.
      server.watcher.add(watchRoot);
      const invalidate = (file: string): void => {
        const rel = relative(watchRoot, file);
        const underBerrybench = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
        if (!underBerrybench) return;
        // Any change under .berrybench may affect every virtual module; mark
        // them stale (harmless when a module was never imported yet).
        for (
          const id of [
            CONFIG_MODULE,
            SNAPSHOTS_MODULE,
            ENV_MODULE,
            ...SNAPSHOT_IDS.map((name) => SNAPSHOTS_PREFIX + name),
          ]
        ) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod !== undefined) server.moduleGraph.invalidateModule(mod);
        }
        // Virtual-module content cannot be diffed by HMR; force a page reload
        // so the shell re-imports the refreshed snapshots/config.
        server.hot.send({ type: "full-reload", path: "*" });
      };
      server.watcher.on("change", invalidate);
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);

      // Settings write-back: merge the delta onto the current resolved config
      // and persist through the canonical writer (berrybench.config.ts).
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || (req.url?.split("?")[0] ?? "") !== "/__berrybench/config") {
          next();
          return;
        }
        try {
          const delta = parseConfigDelta(await readRequestBody(req));
          const current = await currentResolvedConfig(opts.root);
          const merged = mergeConfigDelta(current, delta);
          // resolveConfig hard-fails on an all-disabled resolution; refuse the
          // write-back here with the identical message so the shell's error
          // display matches CLI output, and never persist a broken config.
          if (!Object.values(merged.workspaces).some((w) => w.enabled)) {
            respondJson(res, 400, { ok: false, error: ALL_DISABLED_MESSAGE });
            return;
          }
          await writeConfigFile(opts.root, merged);
          respondJson(res, 200, { ok: true, file: CONFIG_FILE_NAME });
        } catch (error) {
          if (error instanceof RequestTooLargeError) {
            respondJson(res, 413, { ok: false, error: error.message });
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          respondJson(res, 400, { ok: false, error: message });
        }
      });
    },
  };
}
