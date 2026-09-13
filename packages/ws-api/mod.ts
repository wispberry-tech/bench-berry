import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import type { ProjectContext, WorkspacePlugin } from "../core/workspace.ts";

export interface ApiParam {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  /** Resolved schema `.type` (string form), when the param has a schema. */
  type?: string;
  /** Example value for the param (explicit or synthesized from its schema). */
  example?: unknown;
}

export interface ApiResponse {
  status: string;
  description?: string;
  schema?: unknown;
  /** Example payload for this response (explicit or synthesized). */
  example?: unknown;
}

export interface ApiOp {
  id: string;
  method: string;
  path: string;
  summary?: string;
  /** Cross-link target id: ws-db table name (§5 `x-berrybench` extension). */
  table?: string;
  /** Cross-link target id: ws-design story (by title or file basename, §5 `x-berrybench` extension). */
  comp?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ApiParam[];
  requestSchema?: unknown;
  /** Example body for the request (explicit or synthesized). */
  requestExample?: unknown;
  responses?: ApiResponse[];
}

export interface ApiSnapshot {
  title?: string;
  version?: string;
  /** First `servers[].url` from the spec, when present. */
  server?: string;
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

/**
 * Resolve a local `#/…` JSON-pointer $ref against the spec. Walks the
 * spec object by decoded segments (JSON-pointer ~0/~1); returns the
 * resolved node, or the ORIGINAL $ref node on any failure (non-string/
 * non-local ref, missing segment, or depth > 5 — the depth guard also
 * terminates $ref cycles).
 */
function resolveRef(spec: Record<string, unknown>, node: unknown, depth = 0): unknown {
  if (depth > 5 || !isRecord(node)) return node;
  const ref = node["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  const segments = ref.slice(2).split("/").map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = spec;
  for (const seg of segments) {
    if (!isRecord(cur)) return node;
    cur = cur[seg];
  }
  return resolveRef(spec, cur, depth + 1);
}

/**
 * Pull a schema from a media-type content map (requestBody.content /
 * response.content): the `application/json` entry's `.schema`, else the
 * FIRST content entry's `.schema`, else undefined when content is not a
 * record or an entry has no schema.
 */
function schemaFromContent(content: unknown): unknown {
  if (!isRecord(content)) return undefined;
  const jsonEntry = isRecord(content["application/json"]) ? content["application/json"] : undefined;
  const entry = jsonEntry ?? Object.values(content)[0];
  return isRecord(entry) ? entry.schema : undefined;
}

/** First explicit example on an OpenAPI node: `.example`, else first `.examples[*].value`. */
function explicitExample(node: unknown): unknown {
  if (!isRecord(node)) return undefined;
  if ("example" in node && node.example !== undefined) return node.example;
  if (isRecord(node.examples)) {
    for (const ex of Object.values(node.examples)) {
      if (isRecord(ex) && "value" in ex && ex.value !== undefined) return ex.value;
    }
  }
  return undefined;
}

/**
 * Minimal JSON example synthesized from a schema. Bounded and deterministic:
 * depth > 4 -> null; explicit `.example`/`.default`/`.const` win; `enum` ->
 * first member; `allOf` branches shallow-merge into one schema; `oneOf`/
 * `anyOf` -> first branch; arrays take the item shape; objects map up to the
 * first 20 properties. Anything unsupported -> null.
 */
export function exampleFromSchema(
  spec: Record<string, unknown>,
  schema: unknown,
  depth = 0,
): unknown {
  if (depth > 4 || !isRecord(schema)) return null;
  if (typeof schema.$ref === "string") {
    return exampleFromSchema(spec, resolveRef(spec, schema), depth + 1);
  }
  if ("example" in schema && schema.example !== undefined) return schema.example;
  if ("default" in schema && schema.default !== undefined) return schema.default;
  if ("const" in schema && schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const branch of schema.allOf) {
      const resolved = resolveRef(spec, branch);
      if (isRecord(resolved)) Object.assign(merged, resolved);
    }
    return exampleFromSchema(spec, merged, depth + 1);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return exampleFromSchema(spec, schema.oneOf[0], depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return exampleFromSchema(spec, schema.anyOf[0], depth + 1);
  }
  if (schema.type === "array") {
    if (Array.isArray(schema.items)) {
      return schema.items.map((item) => exampleFromSchema(spec, item, depth + 1));
    }
    return schema.items === undefined ? [] : [exampleFromSchema(spec, schema.items, depth + 1)];
  }
  if (schema.type === "object") {
    const out: Record<string, unknown> = {};
    const props = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propSchema] of Object.entries(props).slice(0, 20)) {
      out[key] = exampleFromSchema(spec, propSchema, depth + 1);
    }
    return out;
  }
  if (schema.type === "string") return "string";
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  return null;
}

/**
 * Example for a media-type content map: the application/json entry (else the
 * first entry), its explicit example, else one synthesized from its resolved
 * schema. Undefined when content has no usable entry or nothing synthesizable.
 */
function exampleFromContent(spec: Record<string, unknown>, content: unknown): unknown {
  if (!isRecord(content)) return undefined;
  const jsonEntry = isRecord(content["application/json"]) ? content["application/json"] : undefined;
  const entry = jsonEntry ?? Object.values(content)[0];
  if (!isRecord(entry)) return undefined;
  const explicit = explicitExample(entry);
  if (explicit !== undefined) return explicit;
  const synthesized = exampleFromSchema(spec, resolveRef(spec, entry.schema));
  // A synthesized null means "nothing representable" — treat as absent so
  // callers don't store/serialize a pointless example.
  return synthesized === null ? undefined : synthesized;
}

function buildOps(spec: Record<string, unknown>): ApiOp[] {
  const ops: ApiOp[] = [];
  if (!isRecord(spec.paths)) return ops;
  // Colliding slugs (e.g. `/pets` vs `/pets/`) get deterministic suffixes:
  // first occurrence keeps the bare id, later ones `-2`, `-3`, … in op order.
  // Duplicate ids would break the shell's exact-match op routing and #each keys.
  const seen: Record<string, number> = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const [key, op] of Object.entries(item)) {
      const method = key.toLowerCase();
      if (!HTTP_METHODS[method]) continue; // parameters/$ref/servers/tags/summary/description etc.
      if (!isRecord(op)) continue;
      const baseId = slugId(path, method);
      const count = seen[baseId] ?? 0;
      seen[baseId] = count + 1;
      const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
      let summary: string | undefined;
      if (typeof op.summary === "string") {
        summary = op.summary;
      } else if (typeof op.description === "string") {
        summary = op.description.split(/\r?\n/)[0]?.trim() || undefined;
      }
      const entry: ApiOp = { id, method: method.toUpperCase(), path };
      if (summary !== undefined) entry.summary = summary;
      // §5 cross-links: `x-berrybench: { table?, comp? }` per op (object form only).
      const xb = op["x-berrybench"];
      if (isRecord(xb)) {
        if (typeof xb.table === "string") entry.table = xb.table;
        if (typeof xb.comp === "string") entry.comp = xb.comp;
      }
      // §3 OpenAPI I/O surface — additive; each field set only when present.
      if (typeof op.operationId === "string") entry.operationId = op.operationId;
      if (Array.isArray(op.tags)) {
        const tags = op.tags.filter((t): t is string => typeof t === "string");
        if (tags.length > 0) entry.tags = tags;
      }
      if (Array.isArray(op.parameters)) {
        const params: ApiParam[] = [];
        for (const p of op.parameters) {
          // `$ref` parameter entries are unresolvable per-op — skipped (§3).
          if (!isRecord(p) || typeof p.$ref === "string") continue;
          const name = p.name;
          const loc = p.in;
          if (typeof name !== "string" || typeof loc !== "string") continue;
          const param: ApiParam = { name, in: loc };
          if (p.required === true) param.required = true;
          if (typeof p.description === "string") param.description = p.description;
          // §6 examples: explicit param example wins, else a minimal example
          // synthesized from the resolved schema (schema example/default/const
          // and enum members are honored by the synthesizer).
          const resolvedSchema = resolveRef(spec, p.schema);
          if (isRecord(resolvedSchema) && typeof resolvedSchema.type === "string") {
            param.type = resolvedSchema.type;
          }
          let example = explicitExample(p);
          if (example === undefined) {
            const synthesized = exampleFromSchema(spec, resolvedSchema);
            if (synthesized !== null) example = synthesized;
          }
          if (example !== undefined) param.example = example;
          params.push(param);
        }
        if (params.length > 0) entry.parameters = params;
      }
      const rb = op.requestBody;
      if (isRecord(rb)) {
        const s = schemaFromContent(rb.content);
        if (s !== undefined) entry.requestSchema = resolveRef(spec, s);
        const ex = exampleFromContent(spec, rb.content);
        if (ex !== undefined) entry.requestExample = ex;
      }
      if (isRecord(op.responses)) {
        const responses: ApiResponse[] = [];
        for (const [status, r] of Object.entries(op.responses)) {
          if (!isRecord(r)) continue;
          const response: ApiResponse = { status };
          if (typeof r.description === "string") response.description = r.description;
          const s = schemaFromContent(r.content);
          if (s !== undefined) response.schema = resolveRef(spec, s);
          const ex = exampleFromContent(spec, r.content);
          if (ex !== undefined) response.example = ex;
          responses.push(response);
        }
        if (responses.length > 0) entry.responses = responses;
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
    // curl base URL: first `servers[].url` when it is a string.
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    const firstServer = servers[0];
    const server = isRecord(firstServer) && typeof firstServer.url === "string"
      ? firstServer.url
      : undefined;

    const snapshot: ApiSnapshot = { endpointCount: ops.length, ops };
    if (title !== undefined) snapshot.title = title;
    if (version !== undefined) snapshot.version = version;
    if (server !== undefined) snapshot.server = server;
    return snapshot;
  },
};
