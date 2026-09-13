// packages/shell/src/lib/router.ts
/// <reference lib="dom" />
// Hash router: parses '#/design?comp=x'-style hashes and resolves them against
// the live resolved config + snapshots. Unknown/invalid/disabled workspaces
// resolve to the first enabled workspace; deep-link ids that are not in the
// snapshot resolve to the workspace home. Pure TS, fully deno-checkable.
import type { ResolvedConfig, WorkspaceId } from "./types.ts";
import { isApiSnapshot, isDbSnapshot, isDesignSnapshot, WORKSPACE_IDS } from "./types.ts";

/** Parsed hash — ws is null for empty/unknown hashes and for '#/settings'. */
export interface ParsedHash {
  ws: WorkspaceId | null;
  key?: string;
  id?: string;
}

export type Route =
  | { kind: "settings" }
  | { kind: "workspace"; ws: WorkspaceId | null; key?: string; id?: string };

const KEY_BY_WS: Record<WorkspaceId, string> = {
  design: "comp",
  api: "op",
  db: "table",
};

/**
 * Parse a location hash into a route shape.
 * '#/design?comp=colors' -> { ws: 'design', key: 'comp', id: 'colors' }
 * '#/settings'           -> { ws: null, key: 'settings' }
 * '' / '#' / '#/'        -> { ws: null }
 */
export function parseHash(hash: string): ParsedHash {
  const body = hash.replace(/^#\/?/, "").split("?")[0];
  const segments = body.split("/").filter(Boolean);
  if (segments.length === 0) return { ws: null };
  const head = segments[0];
  if (head === "settings") return { ws: null, key: "settings" };
  if (!(WORKSPACE_IDS as readonly string[]).includes(head)) return { ws: null };
  const ws = head as WorkspaceId;
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  for (const key of [KEY_BY_WS[ws], "comp", "op", "table"]) {
    const id = params.get(key);
    if (id) return { ws, key, id };
  }
  return { ws };
}

/** First enabled workspace id, or null when none are enabled. */
function firstEnabled(config: ResolvedConfig): WorkspaceId | null {
  for (const id of WORKSPACE_IDS) {
    if (config.workspaces[id]?.enabled) return id;
  }
  return null;
}

/** Whether `id` exists as a deep-link target in the workspace's snapshot. */
function hasDeepLink(
  ws: WorkspaceId,
  id: string,
  snapshots: Record<WorkspaceId, unknown>,
): boolean {
  const snap = snapshots[ws];
  if (ws === "design") {
    return isDesignSnapshot(snap) && snap.stories.some((s) => s.file === id);
  }
  if (ws === "api") {
    return isApiSnapshot(snap) && snap.ops.some((o) => o.id === id);
  }
  // db
  return isDbSnapshot(snap) && snap.tables.some((t) => t.name === id);
}

/**
 * Resolve a parsed hash against config + snapshots. Disabled/unknown workspaces
 * redirect to the first enabled one; unknown deep-link ids fall back to the
 * workspace home. When nothing is enabled, ws is null (caller renders an
 * empty state).
 */
export function resolve(
  parsed: ParsedHash,
  config: ResolvedConfig,
  snapshots: Record<WorkspaceId, unknown>,
): Route {
  if (parsed.key === "settings") return { kind: "settings" };
  const ws = parsed.ws !== null && config.workspaces[parsed.ws]?.enabled
    ? parsed.ws
    : firstEnabled(config);
  if (ws === null) return { kind: "workspace", ws: null };
  if (parsed.ws === null || parsed.ws !== ws) return { kind: "workspace", ws };
  if (parsed.key && parsed.id && hasDeepLink(ws, parsed.id, snapshots)) {
    return { kind: "workspace", ws, key: parsed.key, id: parsed.id };
  }
  return { kind: "workspace", ws };
}

/** Canonical hash for a route (used for redirects and navigation). */
export function hashFor(route: Route): string {
  if (route.kind === "settings") return "#/settings";
  if (route.ws === null) return "#/";
  if (route.key && route.id) return `#/${route.ws}?${route.key}=${encodeURIComponent(route.id)}`;
  return `#/${route.ws}`;
}

/**
 * Navigate to a hash; when already there, re-sync (covers clicking the active
 * rail item).
 */
export function go(hash: string, sync: () => void): void {
  if (location.hash === hash) {
    sync();
  } else {
    location.hash = hash;
  }
}
