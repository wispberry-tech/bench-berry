// packages/preview/config.ts
// Vite config for the live component preview iframe app — the Canvas (§4.6).
// The frame always bundles all three runtimes (svelte/react/vue): framework
// detection happens at runtime inside the frame from the project's
// package.json, so every plugin is registered unconditionally here.
import { join } from "@std/path";
import { type Plugin, type PluginOption, transformWithEsbuild, type UserConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";

/**
 * The preview app's own directory (its index.html + src/main.ts). This is the
 * vite root: the dev server must serve the PREVIEW app at '/preview/', not the
 * project's (often absent) index.html. The passed-in `root` — the BerryBench
 * project root — only feeds the @stories/@pkg aliases below. Compiled
 * binaries override this via opts.root (import.meta.dirname resolves to the
 * binary's extract dir, not a checkout).
 */
const APP_ROOT = import.meta.dirname!;

/**
 * Inline the emitted entry script + stylesheet into index.html so the static
 * preview page is fully self-contained: the sandboxed iframe has an opaque
 * origin, so module fetches on a stock static host are cross-origin requests
 * with no ACAO headers — a blank canvas. Emits no external script/css tags.
 */
function inlinePreviewBundlePlugin(outDir: string): Plugin {
  return {
    name: "berrybench-preview-inline",
    apply: "build",
    async writeBundle(_output, bundle) {
      const htmlInfo = bundle["index.html"];
      if (typeof htmlInfo !== "object" || htmlInfo === null || !("source" in htmlInfo)) return;
      // Vite emits assets as Node Buffers or strings; decode either.
      const decode = (src: unknown): string =>
        typeof src === "string" ? src : new TextDecoder().decode(src as Uint8Array);
      let html = decode(htmlInfo.source);
      const removed: string[] = [];
      // Content of the emitted file a src/href tag points at (chunk -> code,
      // asset -> source), or undefined when it is not part of this bundle.
      const inlineFile = (href: string): string | undefined => {
        const file = href.replace(/^\.\//, "");
        const entry = bundle[file];
        if (typeof entry !== "object" || entry === null) return undefined;
        let content: string;
        if ("code" in entry && typeof entry.code === "string") {
          content = entry.code;
        } else if ("source" in entry) {
          content = decode(entry.source);
        } else {
          return undefined;
        }
        removed.push(file);
        return content;
      };
      html = html.replace(
        /<script[^>]*src="([^"]+)"[^>]*><\/script>/g,
        (all, href: string) => {
          const content = inlineFile(href);
          return content === undefined ? all : `<script type="module">${content}</script>`;
        },
      );
      html = html.replace(
        /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
        (all, href: string) => {
          const content = inlineFile(href);
          return content === undefined ? all : `<style>${content}</style>`;
        },
      );
      // The dev-mode storage shim rides as a classic script (runs before the
      // module graph, which vite's eager-glob hoisting makes impossible via
      // imports). The build inlines that same source here: a classic script
      // executes during HTML parsing, before the deferred module script, so
      // sandboxed hosts never evaluate a story module before the shims exist.
      // transformWithEsbuild strips the TS annotations (the file stays the
      // single source of truth — dev serves it via the src tag, build embeds
      // the compiled form).
      const shimHtml = await (async () => {
        try {
          const source = await Deno.readTextFile(join(APP_ROOT, "src", "dom-shims.ts"));
          const { code } = await transformWithEsbuild(source, "dom-shims.ts", {
            loader: "ts",
            minify: true,
          });
          return `<script>${code}</script>`;
        } catch {
          // Source unavailable (compiled CLI without the checkout): fall back
          // to dropping the tag. The preview then needs a non-sandboxed frame
          // for localStorage, same as before the shim existed.
          return "";
        }
      })();
      html = html.replace(
        /<script[^>]*src="\.\/src\/dom-shims\.ts"[^>]*><\/script>/,
        shimHtml,
      );
      await Deno.writeTextFile(join(outDir, "index.html"), html);
      for (const file of removed) {
        try {
          await Deno.remove(join(outDir, file));
        } catch {
          // Already absent (write:false scenarios): nothing to clean.
        }
      }
    },
  };
}

/**
 * Expose the host's global stylesheets to the canvas bundle as a virtual CSS
 * module (src/main.ts imports `virtual:berrybench-host-css`). The generated
 * module references each host stylesheet by absolute path, so vite's css
 * pipeline inlines and compiles them (postcss/tailwind). When the design
 * package uses tailwind v4, an `@source` directive points the scanner at the
 * design package dir — the preview app's own root would otherwise contain no
 * components and leave the generated stylesheet with zero utility classes.
 * No `apply` restriction: the module must exist in dev AND build; with an
 * empty css list it resolves to an empty module.
 */
function hostCssPlugin(hostCss: string[], hostCssBase?: string): Plugin {
  const ID = "\0virtual:berrybench-host-css.css";
  return {
    name: "berrybench-host-css",
    resolveId(id) {
      if (id === "virtual:berrybench-host-css") return ID;
    },
    load(id) {
      if (id !== ID) return;
      const source = hostCssBase !== undefined ? `@source ${JSON.stringify(hostCssBase)};\n` : "";
      return source + hostCss.map((file) => `@import ${JSON.stringify(file)};`).join("\n");
    },
  };
}

/**
 * Vite config for the second (preview) server/bundle. `root` is the project
 * root; story discovery and framework detection resolve against it:
 *   @stories -> <root>/src          (story files for the import.meta.glob)
 *   @pkg     -> <root>/package.json (framework detection: vue/react/svelte)
 * Callers may override `base` (dev: '/preview/', build: './preview/'),
 * `emptyOutDir`, `root` (the preview app dir — compiled binaries), and — when
 * the design package lives in a subdir (monorepos) —
 * `storiesRoot`/`packageJsonPath` so the glob root and framework detection
 * resolve against the true component package, not the project root.
 */
export function previewViteConfig(
  root: string,
  outDir: string,
  opts: {
    base?: string;
    emptyOutDir?: boolean;
    storiesRoot?: string;
    packageJsonPath?: string;
    /** Host design package's src/lib — the `$lib` alias target (shadcn-style imports). */
    libRoot?: string;
    root?: string;
    /** Absolute paths of host global stylesheets (detected or preview.css). */
    hostCss?: string[];
    /** Host-authored tooling plugins, applied after the built-in runtime plugins. */
    hostPlugins?: PluginOption[];
    /** tailwind v3: host postcss config file to force. */
    cssPostcss?: string;
    /** tailwind v4 scan base for @source: the design package dir. */
    hostCssBase?: string;
  } = {},
): UserConfig {
  return {
    root: opts.root ?? APP_ROOT,
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
      // Host tooling (tailwind, preprocessors) after the built-in runtimes, so
      // host plugins see already-registered framework plugins while berry-bench
      // keeps ownership of the runtime lifecycle.
      ...(opts.hostPlugins ?? []),
      hostCssPlugin(opts.hostCss ?? [], opts.hostCssBase),
      inlinePreviewBundlePlugin(outDir),
    ],
    resolve: {
      alias: [
        { find: "@stories", replacement: opts.storiesRoot ?? join(root, "src") },
        { find: "@pkg", replacement: opts.packageJsonPath ?? join(root, "package.json") },
        { find: "$lib", replacement: opts.libRoot ?? join(root, "src/lib") },
      ],
    },
    css: opts.cssPostcss !== undefined ? { postcss: opts.cssPostcss } : undefined,
    build: {
      outDir,
      emptyOutDir: opts.emptyOutDir ?? true,
      // Single-chunk output so the inline step produces exactly one script
      // tag's content (no code-split dynamic imports in the static bundle).
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
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
