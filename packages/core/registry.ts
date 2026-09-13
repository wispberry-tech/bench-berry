import type { WorkspaceId, WorkspacePlugin } from "./workspace.ts";

export interface WorkspaceRegistry {
  plugins(): readonly WorkspacePlugin[];
  byId(id: WorkspaceId): WorkspacePlugin | undefined;
  workspaceIds(): readonly WorkspaceId[];
}

const KNOWN_IDS: Record<string, true> = {
  design: true,
  api: true,
  db: true,
};

/** Build a registry from a plugin list; throws on unknown or duplicate workspace ids. */
export function createRegistry(plugins: readonly WorkspacePlugin[]): WorkspaceRegistry {
  const seen = new Set<WorkspaceId>();
  for (const plugin of plugins) {
    if (!KNOWN_IDS[plugin.id]) {
      throw new Error(`unknown workspace id: ${plugin.id}`);
    }
    if (seen.has(plugin.id)) {
      throw new Error(`duplicate workspace plugin: ${plugin.id}`);
    }
    seen.add(plugin.id);
  }
  const byId = new Map<WorkspaceId, WorkspacePlugin>(plugins.map((p) => [p.id, p]));
  return {
    plugins: () => plugins,
    byId: (id) => byId.get(id),
    workspaceIds: () => [...byId.keys()],
  };
}
