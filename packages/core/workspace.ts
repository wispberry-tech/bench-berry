export type WorkspaceId = "design" | "api" | "db";

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
