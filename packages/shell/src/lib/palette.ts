// packages/shell/src/lib/palette.ts
// Command-palette item model: 'Navigate' lists the enabled workspaces (setting
// the route). Filtering is a case-insensitive substring match on the label.
// Pure TS, deno-checkable.
import type { ResolvedConfig } from "./types.ts";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "./types.ts";

export interface PaletteItem {
  group: string;
  label: string;
  icon: string;
  /** Target hash for navigate actions. */
  hash: string;
}

const NAV_ICON: Record<string, string> = {
  design: "i-cube",
  api: "i-plug",
  db: "i-db",
};

/** Build the full palette item list from the resolved config. */
export function paletteItems(config: ResolvedConfig): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const id of WORKSPACE_IDS) {
    if (!config.workspaces[id]?.enabled) continue;
    items.push({
      group: "Navigate",
      label: WORKSPACE_LABELS[id],
      icon: NAV_ICON[id],
      hash: `#/${id}`,
    });
  }
  return items;
}