// packages/shell/src/lib/palette.ts
// Command-palette item model: 'Navigate' lists the enabled workspaces (setting
// the route), 'Actions' holds commands like theme toggle. Filtering is a
// case-insensitive substring match on the label. Pure TS, deno-checkable.
import type { ResolvedConfig } from './types.ts';
import { WORKSPACE_IDS, WORKSPACE_LABELS } from './types.ts';

export type PaletteAction = 'navigate' | 'toggle-theme';

export interface PaletteItem {
  group: string;
  label: string;
  icon: string;
  action: PaletteAction;
  /** Target hash for navigate actions. */
  hash?: string;
  hint?: string;
}

const NAV_ICON: Record<string, string> = {
  design: 'i-cube',
  api: 'i-plug',
  db: 'i-db',
};

/** Build the full palette item list from the resolved config. */
export function paletteItems(config: ResolvedConfig): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const id of WORKSPACE_IDS) {
    if (!config.workspaces[id]?.enabled) continue;
    items.push({
      group: 'Navigate',
      label: WORKSPACE_LABELS[id],
      icon: NAV_ICON[id],
      action: 'navigate',
      hash: `#/${id}`,
    });
  }
  items.push({
    group: 'Actions',
    label: 'Toggle theme',
    icon: 'i-sun',
    action: 'toggle-theme',
  });
  return items;
}

/** Keep items whose label matches the filter (empty filter keeps everything). */
export function filterPaletteItems(items: PaletteItem[], filter: string): PaletteItem[] {
  const q = filter.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((item) => item.label.toLowerCase().includes(q));
}