// packages/preview/config.ts
// Vite config for the live component preview iframe app — the Canvas (§4.6).
// The frame always bundles all three runtimes (svelte/react/vue): framework
// detection happens at runtime inside the frame from the project's
// package.json, so every plugin is registered unconditionally here.
import { join } from "@std/path";
import type { UserConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";

/**
 * The preview app's own directory (its index.html + src/main.ts). This is the
 * vite root: the dev server must serve the PREVIEW app at '/preview/', not the
 * project's (often absent) index.html. The passed-in `root` — the BerryBench
 * project root — only feeds the @stories/@pkg aliases below.
 */
const APP_ROOT = import.meta.dirname!;

/**
 * Vite config for the second (preview) server/bundle. `root` is the project
 * root; story discovery and framework detection resolve against it:
 *   @stories -> <root>/src          (story files for the import.meta.glob)
 *   @pkg     -> <root>/package.json (framework detection: vue/react/svelte)
 * Callers may override `base` (dev: '/preview/', build: './preview/'),
 * `emptyOutDir`, and — when the design package lives in a subdir (monorepos)
 * — `storiesRoot`/`packageJsonPath` so the glob root and framework detection
 * resolve against the true component package, not the project root.
 */
export function previewViteConfig(
  root: string,
  outDir: string,
  opts: { base?: string; emptyOutDir?: boolean; storiesRoot?: string; packageJsonPath?: string } =
    {},
): UserConfig {
  return {
    root: APP_ROOT,
    base: opts.base ?? "/preview/",
    plugins: [
      svelte(),
      react(),
      vue(),
      // The shell embeds the preview in a sandboxed iframe
      // (sandbox="allow-scripts", no same-origin) whose document has an
      // opaque origin — every module fetch is a cross-origin request. Some
      // internal vite middlewares (e.g. the react plugin's /@react-refresh)
      // omit CORS headers, which blocks the whole module graph there, so
      // stamp ACAO on every response ahead of all other middleware.
      {
        name: "berrybench-preview-cors",
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@stories": opts.storiesRoot ?? join(root, "src"),
        "@pkg": opts.packageJsonPath ?? join(root, "package.json"),
      },
    },
    build: {
      outDir,
      emptyOutDir: opts.emptyOutDir ?? true,
    },
  };
}

/**
 * The preview iframe's base URL: an absolute localhost URL in dev (the
 * shell's iframe src) and a static-relative base inside dist/ in build.
 */
export function resolvePreviewBase(dev: boolean): string {
  return dev
    ? `http://localhost:${Deno.env.get("BERRYBENCH_PREVIEW_PORT") ?? 5174}/preview/`
    : "./preview/";
}
