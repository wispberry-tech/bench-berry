import { ConfigError, resolveConfig } from "../../core/mod.ts";
import type { ProjectContext, ResolvedConfig, WorkspaceId } from "../../core/mod.ts";
import type { CliContext } from "../main.ts";
import { detectAll, type Out, plugins, registry, usage } from "./shared.ts";

export async function cmdDetect(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  if (rest.length > 0) {
    err(`unknown command: ${rest[0]}`);
    err(usage());
    return 1;
  }

  let detected: Map<string, boolean>;
  let resolved: ResolvedConfig;
  try {
    const projectCtx: ProjectContext = { root: ctx.cwd, env: ctx.env };
    detected = await detectAll(plugins, projectCtx);
    resolved = await resolveConfig(projectCtx, plugins);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  const header = ["id", "label", "defaultEnabled", "detected", "enabled", "enabledBy"];
  const rows = registry.workspaceIds().map((id) => {
    const plugin = registry.byId(id as WorkspaceId)!;
    const r = resolved.workspaces[id as WorkspaceId];
    return [
      id,
      plugin.label,
      String(plugin.defaultEnabled),
      String(detected.get(id) ?? false),
      r.enabled ? "on" : "off",
      r.enabledBy,
    ];
  });
  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...rows.map((row) => row[col].length))
  );
  const formatRow = (cells: readonly string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join("  ").replace(/\s+$/, "");

  out(formatRow(header));
  for (const row of rows) out(formatRow(row));
  return 0;
}
