import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import type { ProjectContext, WorkspacePlugin } from "../core/workspace.ts";

export interface ApiOp {
  id: string;
  method: string;
  path: string;
  summary?: string;
  /** Cross-link target id: ws-db table name (§5 `x-berrybench` extension). */
  table?: string;
  /** Cross-link target id: ws-design story (by title or file basename, §5 `x-berrybench` extension). */
  comp?: string;
}

export interface ApiSnapshot {
  title?: string;
  version?: string;
  endpointCount: number;
  ops: ApiOp[];
}

const SPEC_FILE_NAMES = ["openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml"] as const;
const SPEC_DIRS = [".", "docs", "api"] as const;
const HTTP_METHODS: Record<string, true> = {
  get: true,
  post: true,
  put: true,
  patch: true,
  delete: true,
  head: true,
  options: true,
};

/** Canonical object guard for this package's YAML-shaped data. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(root: string, msg: string): never {
  throw new Error(`unable to parse openapi.yaml in ${root}: ${msg}`);
}

/**
 * Slug a path + method. `{x}` segments become `{seg}`, everything non-alnum
 * collapses to a single dash, leading/trailing dashes are trimmed, and the
 * lowercase method is appended: `/issues` GET -> `issues-get`,
 * `/issues/{id}` GET -> `issues-seg-get`, `/` GET -> `get`.
 */
function slugId(path: string, method: string): string {
  const templated = path.replace(/\{[^}]*\}/g, "{seg}");
  const base = templated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? `${base}-${method}` : method;
}

function buildOps(spec: Record<string, unknown>): ApiOp[] {
  const ops: ApiOp[] = [];
  if (!isRecord(spec.paths)) return ops;
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const [key, op] of Object.entries(item)) {
      const method = key.toLowerCase();
      if (!HTTP_METHODS[method]) continue; // parameters/$ref/servers/tags/summary/description etc.
      if (!isRecord(op)) continue;
      let summary: string | undefined;
      if (typeof op.summary === "string") {
        summary = op.summary;
      } else if (typeof op.description === "string") {
        summary = op.description.split(/\r?\n/)[0]?.trim() || undefined;
      }
      const entry: ApiOp = { id: slugId(path, method), method: method.toUpperCase(), path };
      if (summary !== undefined) entry.summary = summary;
      // §5 cross-links: `x-berrybench: { table?, comp? }` per op (object form only).
      const xb = op["x-berrybench"];
      if (isRecord(xb)) {
        if (typeof xb.table === "string") entry.table = xb.table;
        if (typeof xb.comp === "string") entry.comp = xb.comp;
      }
      ops.push(entry);
    }
  }
  return ops;
}

async function findSpecFile(root: string): Promise<string | undefined> {
  for (const dir of SPEC_DIRS) {
    for (const name of SPEC_FILE_NAMES) {
      const file = join(root, dir, name);
      try {
        const stat = await Deno.stat(file);
        if (stat.isFile) return file;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) continue;
        throw err;
      }
    }
  }
  return undefined;
}

export const apiPlugin: WorkspacePlugin<ApiSnapshot> = {
  id: "api",
  label: "API Explorer",
  icon: "i-api",
  defaultEnabled: true,
  requiredDeps: ["openapi.yaml"],

  async detect(ctx: ProjectContext): Promise<boolean> {
    return (await findSpecFile(ctx.root)) !== undefined;
  },

  async load(ctx: ProjectContext): Promise<ApiSnapshot> {
    const root = ctx.root;
    const file = await findSpecFile(root);
    if (!file) {
      fail(
        root,
        "no openapi/swagger spec found (openapi.yaml, openapi.yml, swagger.yaml, swagger.yml in ., docs/, or api/)",
      );
    }

    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch (err) {
      fail(root, err instanceof Error ? err.message : String(err));
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      fail(root, err instanceof Error ? err.message : String(err));
    }
    if (!isRecord(parsed)) fail(root, "expected an OpenAPI document object");

    const ops = buildOps(parsed);
    const info = isRecord(parsed.info) ? parsed.info : {};
    const title = typeof info.title === "string" ? info.title : undefined;
    const version = typeof info.version === "string" ? info.version : undefined;

    const snapshot: ApiSnapshot = { endpointCount: ops.length, ops };
    if (title !== undefined) snapshot.title = title;
    if (version !== undefined) snapshot.version = version;
    return snapshot;
  },
};
