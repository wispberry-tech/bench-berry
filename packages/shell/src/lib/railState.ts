// packages/shell/src/lib/railState.ts
/// <reference lib="dom" />
// Shared rail collapse state for workspace sidebars. Persisted per
// workspace+group under `berrybench:rail`; absence = expanded (the default).
// `setGroupCollapsed` updates immutably so Svelte `$state` reactivity picks
// the change up, and prunes `false` entries to keep the stored blob small.
const RAIL_KEY = "berrybench:rail";

/** ws id -> group -> collapsed. Only `true` entries are stored. */
type RailState = Record<string, Record<string, true>>;

/**
 * Read stored collapse state. Anything unparseable, or parsed into a
 * non-object shape, is ignored; non-object rows are dropped. Returns a
 * fresh object so callers can treat it as immutable state.
 */
export function readRailState(): RailState {
  try {
    const parsed = JSON.parse(localStorage.getItem(RAIL_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: RailState = {};
    for (const [ws, groups] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof groups === "object" && groups !== null && !Array.isArray(groups)) {
        out[ws] = groups as Record<string, true>;
      }
    }
    return out;
  } catch {
    // localStorage unavailable (private mode etc.) — default to all expanded.
    return {};
  }
}

/** True when the group is stored as collapsed (default: expanded). */
export function isCollapsed(state: RailState, ws: string, group: string): boolean {
  return state[ws]?.[group] === true;
}

/**
 * Return a NEW state with the group toggled to `collapsed` (immutable update
 * of the ws row) and persist it; persistence failures are ignored. Absence of
 * a key means expanded, so `false` deletes rather than storing `false`.
 */
export function setGroupCollapsed(
  state: RailState,
  ws: string,
  group: string,
  collapsed: boolean,
): RailState {
  const row = { ...state[ws] };
  if (collapsed) row[group] = true;
  else delete row[group];
  const next: RailState = { ...state, [ws]: row };
  try {
    localStorage.setItem(RAIL_KEY, JSON.stringify(next));
  } catch {
    // persistence unavailable — ignore.
  }
  return next;
}