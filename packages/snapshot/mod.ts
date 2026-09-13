import { z } from 'zod';
import { join } from '@std/path';
import type {
  ProjectContext,
  ResolvedConfig,
  WorkspaceId,
  WorkspacePlugin,
} from '../core/mod.ts';

/** Project-relative directory (under `root`) holding workspace snapshots. */
export const SNAPSHOT_DIR = '.berrybench/snapshots';

/** Canonical type guard for this package. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Snapshot written when a workspace's load/validation fails — the DB-unreachable contract (§5). */
export interface ErrorSnapshot {
  error: string;
}

/** Per-workspace outcome of writeSnapshots. `ok` is false only when the file write/delete itself threw. */
export interface SnapshotResult {
  ok: boolean;
  file?: string; // project-relative path of the written snapshot, when one was written
  error?: string;
}

const apiOpSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  summary: z.string().optional(),
  table: z.string().optional(),
  comp: z.string().optional(),
});

/** ws-api snapshot shape: `{ title?, version?, endpointCount, ops }`. */
export const apiSnapshotSchema = z.object({
  title: z.string().optional(),
  version: z.string().optional(),
  endpointCount: z.number(),
  ops: z.array(apiOpSchema),
});

/** ws-design snapshot shape: `{ packageName?, version?, stories }`. */
export const designSnapshotSchema = z.object({
  packageName: z.string().optional(),
  version: z.string().optional(),
  stories: z.array(z.object({
    file: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    code: z.string().optional(),
    scenarios: z.array(z.object({
      name: z.string(),
      props: z.record(z.string(), z.unknown()),
    })).optional(),
  })),
});

/** ws-db snapshot shape: `{ error?, connection?, tables }`. */
export const dbSnapshotSchema = z.object({
  error: z.string().optional(),
  connection: z.object({
    host: z.string(),
    database: z.string(),
  }).optional(),
  tables: z.array(z.object({
    name: z.string(),
    columns: z.number(),
  })),
});

/** Shape of an error snapshot: `{ error: string }`. */
export const errorSnapshotSchema = z.object({
  error: z.string(),
});

const WORKSPACE_IDS: readonly WorkspaceId[] = ['design', 'api', 'db'];

const SNAPSHOT_SCHEMAS: Record<WorkspaceId, z.ZodTypeAny> = {
  api: apiSnapshotSchema,
  design: designSnapshotSchema,
  db: dbSnapshotSchema,
};

/** Absolute path to a workspace's snapshot file: `<root>/.berrybench/snapshots/<id>.json`. */
export function snapshotPath(root: string, id: WorkspaceId): string {
  return join(root, SNAPSHOT_DIR, `${id}.json`);
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await Deno.remove(filePath);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

async function writeOne(
  root: string,
  plugins: readonly WorkspacePlugin[],
  id: WorkspaceId,
  enabled: boolean,
  env: Record<string, string | undefined>,
): Promise<SnapshotResult> {
  const filePath = snapshotPath(root, id);
  try {
    if (!enabled) {
      // Disabled workspace leaves NO stale snapshot on disk.
      await removeIfPresent(filePath);
      return { ok: true, file: undefined };
    }
    const plugin = plugins.find((p) => p.id === id);
    let data: unknown;
    if (plugin === undefined) {
      data = { error: `load failed: no plugin registered for workspace: ${id}` };
    } else {
      const ctx: ProjectContext = {
        root,
        env,
      };
      try {
        data = await plugin.load(ctx);
        const parsed = SNAPSHOT_SCHEMAS[id].safeParse(data);
        if (!parsed.success) {
          // First zod message line: `path: message` when the issue has a path.
          const issue = parsed.error.issues[0];
          const detail = issue === undefined
            ? parsed.error.message
            : issue.path.length > 0
            ? `${issue.path.join('.')}: ${issue.message}`
            : issue.message;
          data = { error: `snapshot validation failed: ${detail}` };
        }
      } catch (err) {
        data = { error: `load failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    // Deterministic content: pretty-printed JSON + trailing newline.
    await Deno.writeTextFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { create: true });
    // Error snapshots carry `error` on the result so consumers (e.g. `snapshot --strict`) can see them.
    const error = isRecord(data) && typeof data.error === 'string' ? data.error : undefined;
    return { ok: true, file: join(SNAPSHOT_DIR, `${id}.json`), ...(error === undefined ? {} : { error }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Load and persist a snapshot per workspace in `resolved.workspaces`, in fixed
 * `design` → `api` → `db` order. Enabled workspaces validate their plugin's
 * `load()` result against the workspace zod schema; invalid results and thrown
 * loads become error snapshots (`{ error }`) — a warning, not a failure. A
 * disabled workspace gets its snapshot file deleted so no stale snapshot
 * survives on disk.
 */
export async function writeSnapshots(opts: {
  root: string;
  plugins: readonly WorkspacePlugin[];
  resolved: ResolvedConfig;
  env?: Record<string, string | undefined>; // default: Deno.env.toObject() — drives ws-db's BERRYBENCH_DATABASE_URL
}): Promise<Record<WorkspaceId, SnapshotResult>> {
  const { root, plugins, resolved } = opts;
  const env = opts.env ?? Deno.env.toObject();
  try {
    await Deno.mkdir(join(root, SNAPSHOT_DIR), { recursive: true });
  } catch {
    // Directory creation may fail (read-only FS); per-workspace ops report it.
  }
  const results = {} as Record<WorkspaceId, SnapshotResult>;
  for (const id of WORKSPACE_IDS) {
    const resolution = resolved.workspaces[id];
    if (resolution === undefined) continue; // only keys present in resolved.workspaces
    results[id] = await writeOne(root, plugins, id, resolution.enabled, env);
  }
  return results;
}

/** Read a snapshot as raw JSON; `undefined` when no snapshot file exists. */
export async function readSnapshot<T = unknown>(
  root: string,
  id: WorkspaceId,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(snapshotPath(root, id));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
  return JSON.parse(text) as T;
}

/** Workspace ids (fixed `design` → `api` → `db` order) whose snapshot file exists on disk. */
export async function listSnapshots(root: string): Promise<WorkspaceId[]> {
  const present = new Set<WorkspaceId>(); // dynamic: entries come from the directory listing
  try {
    for await (const entry of Deno.readDir(join(root, SNAPSHOT_DIR))) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const base = entry.name.slice(0, -'.json'.length) as WorkspaceId;
      if (WORKSPACE_IDS.includes(base)) present.add(base);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return WORKSPACE_IDS.filter((id) => present.has(id));
}