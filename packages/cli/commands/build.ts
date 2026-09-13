import { dirname, join } from "@std/path";
import { build as viteBuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { ConfigError } from "../../core/mod.ts";
import { berrybench } from "../../vite-plugin/mod.ts";
import { previewViteConfig } from "../../preview/config.ts";
import type { CliContext } from "../main.ts";
import {
  designPreviewAliases,
  missingShellDir,
  type Out,
  printSnapshotLines,
  projectDir,
  RESOLVED_CONFIG_FILE,
  type SnapshotWrite,
  usage,
  VERSION,
  writeProjectSnapshots,
} from "./shared.ts";

export async function cmdBuild(
  rest: string[],
  ctx: CliContext,
  out: Out,
  err: Out,
): Promise<number> {
  const [dirArg, ...extra] = rest;
  if (extra.length > 0) {
    err(`unknown command: ${extra[0]}`);
    err(usage());
    return 1;
  }

  const root = projectDir(ctx, dirArg);
  // Probe before writing any .berrybench artifacts: a failing command must
  // leave no side effects behind. Compiled binaries cannot reach the
  // repo-relative default (import.meta.dirname is the executable's extract
  // dir); fail with a clear hint instead of a vite error deep in the build.
  const shellDir = Deno.env.get("BERRYBENCH_SHELL_DIR") ??
    join(import.meta.dirname!, "../../shell");
  if (await missingShellDir(shellDir)) {
    err(
      `Shell app not found at ${shellDir}; run from a berry-bench checkout or set BERRYBENCH_SHELL_DIR to a berry-bench checkout/packages/shell`,
    );
    return 1;
  }

  let written: SnapshotWrite;
  try {
    written = await writeProjectSnapshots(root, ctx.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(error.message);
      return 1;
    }
    throw error;
  }

  // writeProjectSnapshots already refreshed .berrybench/resolved-config.json;
  // this command additionally writes the manifest and the shell bundle.
  const resolvedConfigPath = join(root, RESOLVED_CONFIG_FILE);
  const manifestPath = join(root, ".berrybench/manifest.json");
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    workspaces: written.results,
  };
  await Deno.mkdir(join(root, ".berrybench"), { recursive: true });
  await Deno.writeTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  out(resolvedConfigPath);
  out(manifestPath);
  printSnapshotLines(out, written.resolved, written.results);

  const outDir = join(root, "dist");
  try {
    await viteBuild({
      root: shellDir,
      base: "./",
      build: {
        outDir,
        emptyOutDir: true,
      },
      plugins: [tailwindcss(), svelte(), berrybench({ root })],
    });
  } catch (error) {
    err(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  out(`built ${outDir}`);
  // Preview bundle: the isolated iframe app (all three runtimes) the shell
  // embeds for the live canvas; emitted to <dist>/preview. vite 7 rejects
  // './preview/' as a base (coerces it to root-absolute asset URLs, breaking
  // the page at <dist>/preview/), so './' is used: html-relative asset URLs
  // serve the page from any static host, and the shell still iframes it as
  // './preview/' (env.preview.base).
  const previewOutDir = join(root, "dist", "preview");
  // Compiled binaries: import.meta.dirname resolves to the executable's
  // extract dir, so the preview app must come from a sibling of the
  // user-supplied shell checkout instead of the build machine's checkout.
  const previewAppRoot = Deno.env.get("BERRYBENCH_SHELL_DIR") !== undefined
    ? join(dirname(shellDir), "preview")
    : undefined;
  try {
    await viteBuild(
      previewViteConfig(root, previewOutDir, {
        base: "./",
        emptyOutDir: true,
        ...designPreviewAliases(root),
        ...(previewAppRoot !== undefined ? { root: previewAppRoot } : {}),
      }),
    );
  } catch (error) {
    err(`preview build failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  out(`built ${previewOutDir}`);
  return 0;
}
