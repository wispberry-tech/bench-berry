// packages/shell/src/lib/markup.ts
// Small pure string helpers shared across workspace components. The former
// HTML-string pane/chip builders (apiOpPane, dbTablePane, errorPanel,
// statusChip, crossLinkChip, copy/icon literals, badge class sets) were
// replaced by real Svelte markup composed from ui/* registry components
// directly in the workspaces; only non-HTML helpers remain.

/** Last path segment of a file path, used as a fallback story label. */
export function basename(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? file : file.slice(i + 1);
}
