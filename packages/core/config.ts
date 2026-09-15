import { z } from "zod";
import { join, toFileUrl } from "@std/path";
import { WORKSPACE_IDS } from "./workspace.ts";
import type { ProjectContext, WorkspaceId, WorkspacePlugin } from "./workspace.ts";

/** Thrown for any config problem: malformed file, unknown workspace ids, or an invalid final resolution. */
export class ConfigError extends Error {}

export interface WorkspaceResolution {
  enabled: boolean;
  enabledBy: "default" | "auto" | "config" | "ui" | "env";
  source?: Record<string, unknown>;
}

export interface ResolvedConfig {
  workspaces: Record<WorkspaceId, WorkspaceResolution>;
  /** Unknown top-level keys from the config file, preserved for round-trip fidelity. */
  extra: Record<string, unknown>;
}

/**
 * Shared text for the all-disabled error: the CLI's `config` save path, the
 * vite write-back guard, and resolveConfig all surface the same message so
 * shell error display matches CLI output.
 */
export const ALL_DISABLED_MESSAGE =
  "enable at least one workspace (hint: berrybench config enable design)";

const KNOWN_IDS: Record<string, true> = {};
for (const id of WORKSPACE_IDS) KNOWN_IDS[id] = true;
const WorkspaceIdSchema = z.enum(WORKSPACE_IDS);

const WorkspaceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  enabledBy: z.enum(["config", "ui", "auto"]).optional(),
  source: z.record(z.string(), z.unknown()).optional(),
});

// `.passthrough()` only at the top level: unknown top-level keys survive a
// rewrite, but the workspaces record rejects unknown workspace ids.
const FileConfigSchema = z.object({
  workspaces: z.record(WorkspaceIdSchema, WorkspaceConfigSchema).optional(),
}).passthrough();

/**
 * Resolve workspace enablement by merging, lowest to highest precedence:
 * plugin defaults → auto-detection → config file → BERRYBENCH_WORKSPACES env override.
 * Throws ConfigError when the file/env references an unknown workspace id or
 * when no workspace ends up enabled.
 */
export async function resolveConfig(
  ctx: ProjectContext,
  plugins: readonly WorkspacePlugin[],
  fileConfig?: unknown, // provided -> use instead of reading disk
): Promise<ResolvedConfig> {
  const current = new Map<WorkspaceId, WorkspaceResolution>();

  for (const plugin of plugins) {
    current.set(plugin.id, { enabled: plugin.defaultEnabled, enabledBy: "default" });
  }

  for (const plugin of plugins) {
    const detected = await plugin.detect(ctx);
    if (detected !== plugin.defaultEnabled) {
      current.set(plugin.id, { enabled: detected, enabledBy: "auto" });
    }
  }

  let extra: Record<string, unknown> = {};
  let file = fileConfig;
  if (file === undefined) {
    file = await readFileConfig(ctx.root);
  }
  if (file !== undefined) {
    assertKnownWorkspaceIds(file);
    const parsed = FileConfigSchema.safeParse(file);
    if (!parsed.success) {
      throw new ConfigError(`invalid berrybench.config.ts: ${describeZodError(parsed.error)}`);
    }
    // Preserve unknown top-level keys (deep-cloned) so a config write-back
    // round-trips them instead of silently dropping user settings.
    extra = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === "workspaces") continue;
      try {
        extra[key] = structuredClone(value);
      } catch {
        // Non-cloneable value (shouldn't happen in a config file): keep as-is.
        extra[key] = value;
      }
    }
    for (const [id, cfg] of Object.entries(parsed.data.workspaces ?? {})) {
      const workspaceId = id as WorkspaceId;
      const resolution = current.get(workspaceId);
      if (resolution === undefined) continue; // valid id, but no plugin registered
      const enabled = cfg.enabled ?? resolution.enabled;
      const enabledBy = cfg.enabled !== undefined
        ? (cfg.enabledBy === "ui" ? "ui" : "config")
        : resolution.enabledBy;
      const source = cfg.source ?? resolution.source;
      current.set(workspaceId, {
        enabled,
        enabledBy,
        ...(source !== undefined ? { source } : {}),
      });
    }
  }

  const envValue = ctx.env["BERRYBENCH_WORKSPACES"];
  if (envValue !== undefined && envValue.trim() !== "") {
    const ids = envValue.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const id of ids) {
      if (!KNOWN_IDS[id]) throw new ConfigError(`unknown workspace id: ${id}`);
    }
    const enabledIds = new Set(ids);
    for (const plugin of plugins) {
      current.set(plugin.id, { enabled: enabledIds.has(plugin.id), enabledBy: "env" });
    }
  }

  const workspaces = {} as Record<WorkspaceId, WorkspaceResolution>;
  for (const plugin of plugins) {
    workspaces[plugin.id] = current.get(plugin.id)!;
  }
  const anyEnabled = Object.values(workspaces).some((w) => w.enabled);
  if (!anyEnabled) {
    throw new ConfigError(ALL_DISABLED_MESSAGE);
  }
  return { workspaces, extra };
}

function assertKnownWorkspaceIds(file: unknown): void {
  if (typeof file !== "object" || file === null || Array.isArray(file)) return;
  const workspaces = (file as Record<string, unknown>).workspaces;
  if (typeof workspaces !== "object" || workspaces === null || Array.isArray(workspaces)) return;
  for (const key of Object.keys(workspaces)) {
    if (!KNOWN_IDS[key]) throw new ConfigError(`unknown workspace id: ${key}`);
  }
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "root"}: ${issue.message}`)
    .join("; ");
}

const CONFIG_HEADER = "// Generated by BerryBench. Edit freely; the CLI merges your edits.";

/** Serialize the resolved config to a deterministic, key-sorted TypeScript config file. */
export function formatConfigFile(
  resolved: ResolvedConfig,
  detectedNotes: Record<string, string>,
): string {
  const lines = [CONFIG_HEADER, "export default {", "  workspaces: {"];
  const ids = [
    ...WORKSPACE_IDS.filter((id) => id in resolved.workspaces),
    ...Object.keys(resolved.workspaces).filter((id) => !WORKSPACE_IDS.includes(id as WorkspaceId))
      .sort(),
  ];
  for (const id of ids) {
    const note = detectedNotes[id];
    if (note !== undefined) lines.push(`    // ${id}: ${note}`);
    const workspace = resolved.workspaces[id as WorkspaceId];
    let entry = `    ${id}: { enabled: ${workspace.enabled}`;
    if (workspace.enabledBy === "ui") {
      entry += `, enabledBy: 'ui'`;
    }
    if (workspace.source !== undefined) {
      entry += `, source: ${serializeValue(workspace.source)}`;
    }
    lines.push(`${entry} },`);
  }
  lines.push("  },");
  // Unknown top-level keys from the file, re-emitted key-sorted so user
  // settings survive a write-back untouched.
  const extraKeys = Object.keys(resolved.extra ?? {}).sort((a, b) => a.localeCompare(b));
  for (const key of extraKeys) {
    lines.push(
      `  ${isIdentifier(key) ? key : quote(key)}: ${serializeValue(resolved.extra[key])},`,
    );
  }
  lines.push("};");
  return `${lines.join("\n")}\n`;
}

// Serialize an arbitrary (JSON-ish) value as a single-line TS expression.
function serializeValue(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return quote(value);
    case "boolean":
      return String(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "bigint":
      return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return "{}";
    return `{ ${
      entries.map(([k, v]) => `${isIdentifier(k) ? k : quote(k)}: ${serializeValue(v)}`).join(", ")
    } }`;
  }
  return "null";
}

function quote(value: string): string {
  return `'${
    value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
  }'`;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/**
 * Read `<root>/berrybench.config.ts` via dynamic import, cache-busted by file
 * mtime. Returns undefined when the file does not exist; throws ConfigError
 * when it exists but cannot be imported or does not default-export an object.
 */
export async function readFileConfig(root: string): Promise<unknown | undefined> {
  const filePath = join(root, "berrybench.config.ts");
  let mtimeMs: number;
  try {
    mtimeMs = (await Deno.stat(filePath)).mtime?.getTime() ?? 0;
  } catch {
    return undefined;
  }
  const url = `${toFileUrl(filePath).href}?mtime=${mtimeMs}`;
  // The config file is user-authored and only known at runtime, so a dynamic
  // import is required here; the `?mtime=` query busts Deno's module cache so
  // edits are picked up on the next read.
  let mod: Record<string, unknown>;
  try {
    mod = await import(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`failed to load config file ${filePath}: ${detail}`);
  }
  const value = mod["default"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`config file ${filePath} must default-export a plain object`);
  }
  return value;
}

/**
 * The design-package preview integration knobs, from the config file's
 * `preview` section (an unknown top-level key preserved in `extra` so edits
 * round-trip through formatConfigFile):
 *   preview: { css: ['src/app.css'], viteConfig: 'berrybench.vite.config.ts' }
 * - `css` global stylesheets for the preview canvas, relative to the design
 *   package dir (absolute paths allowed); empty when absent.
 * - `viteConfig` a vite config file whose plugins join the preview server
 *   (tailwind/mdsvex-style tooling); suppresses the built-in auto-tailwind.
 * Malformed shapes throw ConfigError naming the offending key.
 */
export function previewOptions(resolved: ResolvedConfig): {
  css: string[];
  viteConfig?: string;
} {
  const preview = resolved.extra["preview"];
  if (preview === undefined) return { css: [] };
  if (typeof preview !== "object" || preview === null || Array.isArray(preview)) {
    throw new ConfigError("invalid berrybench.config.ts: `preview` must be an object");
  }
  const { css, viteConfig } = preview as Record<string, unknown>;
  const result: { css: string[]; viteConfig?: string } = {
    css: css === undefined ? [] : previewStringList(css, "preview.css"),
  };
  if (viteConfig !== undefined) {
    if (typeof viteConfig !== "string" || viteConfig.trim() === "") {
      throw new ConfigError(
        "invalid berrybench.config.ts: `preview.viteConfig` must be a non-empty string",
      );
    }
    result.viteConfig = viteConfig;
  }
  return result;
}

// `preview.css` accepts a single path or a list; anything else is malformed.
function previewStringList(value: unknown, key: string): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (list === null || list.some((v) => typeof v !== "string" || v.trim() === "")) {
    throw new ConfigError(
      `invalid berrybench.config.ts: ${key} must be a string or an array of non-empty strings`,
    );
  }
  return list;
}

/**
 * Ensure `<root>` exists, then serialize `resolved` to `<root>/berrybench.config.ts`
 * via formatConfigFile. This is the single settings writer: the CLI's
 * `config enable|disable` and the future #/settings UI both persist through it,
 * so every save is deterministic, key-sorted, and goes through the same
 * serialization as `init`.
 */
export async function writeConfigFile(
  root: string,
  resolved: ResolvedConfig,
  notes?: Record<string, string>,
): Promise<void> {
  await Deno.mkdir(root, { recursive: true });
  await Deno.writeTextFile(
    join(root, "berrybench.config.ts"),
    formatConfigFile(resolved, notes ?? {}),
  );
}
