// packages/shell/src/lib/types.ts
// Canonical BerryBench shell types — copied verbatim from the Phase 3 batch
// Contract (ResolvedConfig + the three snapshot shapes). Pure TS so these stay
// deno-checkable; components and lib modules import from here (never re-declare).
// The aggregate virtual module `virtual:berrybench-snapshots` default-exports
// `Record<WorkspaceId, unknown>` with one key per ENABLED workspace — so values
// are narrowed here with the exported type guards.

export type WorkspaceId = "design" | "api" | "db";

type EnablementSource = "default" | "auto" | "config" | "ui" | "env";

interface WorkspaceResolution {
  enabled: boolean;
  enabledBy: EnablementSource;
  source?: Record<string, unknown>;
}

export interface ThemeConfig {
  accent?: string;
}

export interface ResolvedConfig {
  workspaces: Record<WorkspaceId, WorkspaceResolution>;
  theme?: ThemeConfig;
}

// ---------- snapshot shapes (Contract verbatim) ----------

export interface ApiSnapshot {
  title?: string;
  version?: string;
  server?: string;
  endpointCount: number;
  ops: {
    id: string;
    method: string;
    path: string;
    summary?: string;
    table?: string;
    comp?: string;
    operationId?: string;
    tags?: string[];
    parameters?: {
      name: string;
      in: string;
      required?: boolean;
      description?: string;
      type?: string;
      example?: unknown;
    }[];
    requestSchema?: unknown;
    requestExample?: unknown;
    responses?: { status: string; description?: string; schema?: unknown; example?: unknown }[];
  }[];
}

// ---------- phase 4: story meta + preview protocol (§4.6) ----------

/** One scenario override for a story: name + props to render with. */
interface StoryScenario {
  name: string;
  props: Record<string, unknown>;
}

/**
 * Per-story metadata carried in the design snapshot (§4.6). `file` is the
 * project-relative story path ('src/...'); every other field is optional.
 */
interface StoryMeta {
  file: string;
  title?: string;
  description?: string;
  props?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  code?: string;
  scenarios?: StoryScenario[];
}

/**
 * PostMessage protocol between the shell and the live preview iframe
 * (mirrors packages/preview/protocol.ts). The shell sends
 * setProps/setStory/setTheme and listens for ready/error.
 */
export type PreviewMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "setProps"; props: Record<string, unknown> }
  | { type: "setStory"; storyId: string }
  | { type: "setTheme"; theme: "light" | "dark" };

interface DesignSnapshot {
  packageName?: string;
  version?: string;
  stories: StoryMeta[];
}

export interface DbSnapshot {
  error?: string;
  connection?: { host: string; database: string };
  tables: {
    name: string;
    schema: string;
    rowCount?: number;
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      default?: string;
      primaryKey: boolean;
    }[];
    foreignKeys: {
      column: string;
      referencesTable: string;
      referencesColumn: string;
    }[];
  }[];
}

/** Value produced by the aggregate snapshot module for a missing/unparseable file. */
interface SnapshotError {
  error: string;
}

// ---------- type guards ----------

export function isDesignSnapshot(v: unknown): v is DesignSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<DesignSnapshot>;
  return Array.isArray(s.stories) && s.stories.every(
    (row) => typeof row === "object" && row !== null && typeof row.file === "string",
  );
}

export function isApiSnapshot(v: unknown): v is ApiSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<ApiSnapshot>;
  return typeof s.endpointCount === "number" && Array.isArray(s.ops) && s.ops.every(
    (row) =>
      typeof row === "object" && row !== null && typeof row.id === "string" &&
      typeof row.method === "string" && typeof row.path === "string",
  );
}

export function isDbSnapshot(v: unknown): v is DbSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<DbSnapshot>;
  if (s.error !== undefined && typeof s.error !== "string") return false;
  if (s.connection !== undefined && (typeof s.connection !== "object" || s.connection === null)) {
    return false;
  }
  return Array.isArray(s.tables) && s.tables.every(
    (row) =>
      typeof row === "object" && row !== null && typeof row.name === "string" &&
      typeof row.schema === "string" &&
      Array.isArray(row.columns) && row.columns.every(
        (col) =>
          typeof col === "object" && col !== null && typeof col.name === "string" &&
          typeof col.type === "string",
      ) &&
      Array.isArray(row.foreignKeys) && row.foreignKeys.every(
        (fk) =>
          typeof fk === "object" && fk !== null && typeof fk.column === "string" &&
          typeof fk.referencesTable === "string" && typeof fk.referencesColumn === "string",
      ),
  );
}

export function isSnapshotError(v: unknown): v is SnapshotError {
  return typeof v === "object" && v !== null && typeof (v as SnapshotError).error === "string";
}

// ---------- workspace metadata ----------

// Pinned to core's `WORKSPACE_IDS` (packages/core/workspace.ts) — this file
// compiles independently of core, so the literal must be updated alongside
// any change to the canonical list (registry, config schema, snapshot writer,
// vite plugin all derive from that const).
export const WORKSPACE_IDS: readonly WorkspaceId[] = ["design", "api", "db"] as const;

export const WORKSPACE_LABELS: Record<WorkspaceId, string> = {
  design: "Design System",
  api: "API Explorer",
  db: "Database",
};
