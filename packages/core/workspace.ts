/** Canonical workspace ids, in fixed display order. Single source of truth:
 * the registry, config schema, snapshot writer, vite plugin, and shell types
 * all derive from this const — a 4th workspace is one const + plugin wiring. */
export const WORKSPACE_IDS = ["design", "api", "db"] as const;

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export interface ProjectContext {
  /** Absolute path to the project root — never Deno.cwd() inside core/plugins. */
  root: string;
  env: Record<string, string | undefined>;
}

/**
 * A workspace plugin: static metadata plus the detection/loading hooks the core
 * uses to decide enablement and produce snapshot data.
 */
export interface WorkspacePlugin<S = unknown> {
  id: WorkspaceId;
  label: string;
  icon: string;
  defaultEnabled: boolean;
  requiredDeps: readonly string[];
  detect(ctx: ProjectContext): Promise<boolean>;
  load(ctx: ProjectContext): Promise<S>;
}
