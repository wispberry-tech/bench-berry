// packages/preview/host.ts
// Host-project integration for the preview canvas: detects tailwind usage and
// global stylesheets from the design package, and loads a host-authored vite
// config's plugins. Everything here is read-only (berry-bench fs + host
// package.json / css files); it never imports host packages, so it is
// unit-testable.
import { dirname, isAbsolute, join } from "@std/path";
import { loadConfigFromFile, type Plugin } from "vite";

export interface HostPreviewEnv {
  /** true -> register berry-bench's built-in tailwindcss() plugin in the preview server. */
  useTailwind: boolean;
  /** tailwind v3 path: the host's postcss config file (none under v4). */
  cssPostcss?: string;
  /** tailwind v4: design package dir, used as the @source scan base. */
  tailwindBase?: string;
  /** absolute paths of the design package's global stylesheets to load into the canvas. */
  cssFiles: string[];
  /** lines for the CLI to print via err(); never fatal. */
  warnings: string[];
}

const POSTCSS_CANDIDATES = [
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
] as const;
const TAILWIND_IMPORT = /@import\s+["']tailwindcss/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SCAN_MAX_DEPTH = 4;

/**
 * Detect the design package's preview environment. All anchors derive from
 * `packageJsonPath` (the same anchor designPreviewAliases produces): deps for
 * tailwind detection, its dir for the css scan.
 * `root` is the bean-bench project root (reserved; the host vite-config probe
 * and fs allow use it in the CLI callers).
 */
export async function detectHostPreviewEnv(
  root: string,
  packageJsonPath: string,
  opts: { css?: string[]; viteConfig?: string } = {},
): Promise<HostPreviewEnv> {
  const base = dirname(packageJsonPath);
  const warnings: string[] = [];
  const pkg = await readPackageJson(packageJsonPath, warnings);
  const deps = new Set(
    Object.keys(pkg?.dependencies ?? {}).concat(Object.keys(pkg?.devDependencies ?? {})),
  );

  // Tailwind v4: the @tailwindcss/vite plugin does the whole job (no postcss).
  // The plugin instance must come from berry-bench's own node_modules —
  // importing the host's plugin file under Deno loses npm package identity and
  // breaks its peer imports (vite, @tailwindcss/oxide). The v4 plugin only
  // drives the transform; the `@import 'tailwindcss'` inside the host css
  // still resolves to the HOST's tailwindcss engine via vite's importer-based
  // resolution.
  const useTailwind = deps.has("@tailwindcss/vite");
  // Tailwind v3 fallback: postcss-based; needs the host's postcss config.
  const cssPostcss = !useTailwind && deps.has("tailwindcss")
    ? await findPostcssConfig(base, warnings)
    : undefined;

  // Explicit preview.css entries win; otherwise scan for a single tailwind
  // stylesheet. Multiple candidates -> none + a warning (never guess); the
  // host disambiguates via preview.css.
  const cssFiles = opts.css !== undefined && opts.css.length > 0
    ? opts.css.map((entry) => isAbsolute(entry) ? entry : join(base, entry))
    : await scanTailwindCss(base, warnings);

  return {
    useTailwind,
    ...(cssPostcss !== undefined ? { cssPostcss } : {}),
    ...(useTailwind ? { tailwindBase: base } : {}),
    cssFiles,
    warnings,
  };
}

/**
 * Load a host-authored vite config's plugins (e.g. berrybench.vite.config.ts in
 * the design package). Loaded via vite's loadConfigFromFile so bare imports
 * inside the file resolve to the HOST's node_modules — which is why the file
 * must live under the design package dir. Hosts MUST NOT put svelte()/react()/
 * vue() in this file (double-transform with the built-ins); use it for tooling
 * plugins (tailwind, mdsvex-style preprocessors). Missing file -> no plugins;
 * any load failure degrades to `{ plugins: [], warnings: [...] }` — a bad host
 * config must never block dev/build.
 */
export async function loadHostVitePlugins(
  path: string,
  root: string,
  command: "serve" | "build",
): Promise<{ plugins: Plugin[]; warnings: string[] }> {
  if (!(await isFile(path))) return { plugins: [], warnings: [] };
  try {
    const loaded = await loadConfigFromFile({ command, mode: "development" }, path, root);
    return { plugins: flattenPlugins(loaded?.config.plugins), warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      plugins: [],
      warnings: [`preview host vite config ${path} failed to load: ${message}`],
    };
  }
}

// PluginOption is a recursive union (arrays/falsy allowed); keep only real Plugins.
function flattenPlugins(value: unknown): Plugin[] {
  if (!Array.isArray(value)) return [];
  const out: Plugin[] = [];
  const walk = (items: unknown[]): void => {
    for (const item of items) {
      if (!item) continue;
      if (Array.isArray(item)) walk(item);
      else out.push(item as Plugin);
    }
  };
  walk(value);
  return out;
}

async function readPackageJson(
  path: string,
  warnings: string[],
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`preview host: cannot read ${path}: ${message}`);
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

// tailwind v3 needs the postcss config the plugin would otherwise autodetect;
// vite only looks in its own root, so pass the host's config file explicitly.
async function findPostcssConfig(
  base: string,
  warnings: string[],
): Promise<string | undefined> {
  for (const name of POSTCSS_CANDIDATES) {
    const path = join(base, name);
    if (await isFile(path)) return path;
  }
  warnings.push(
    `preview host: found tailwindcss in ${base} but no postcss.config.{js,cjs,mjs,ts} — v3 styles won't compile; add one or upgrade to @tailwindcss/vite`,
  );
  return undefined;
}

/** Walk the design package dir (skip node_modules/dist/.git, max depth 4) for tailwind stylesheets. */
async function scanTailwindCss(base: string, warnings: string[]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SCAN_MAX_DEPTH || found.length > 1) return;
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(dir)) entries.push(entry);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length > 1) return;
      if (entry.isSymlink || SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory) {
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile && entry.name.endsWith(".css")) {
        let content: string;
        try {
          content = await Deno.readTextFile(join(dir, entry.name));
        } catch {
          continue;
        }
        if (TAILWIND_IMPORT.test(content)) found.push(join(dir, entry.name));
      }
    }
  };
  await walk(base, 0);
  if (found.length > 1) {
    warnings.push(
      `preview host: found ${found.length} tailwind stylesheets (${
        found.join(", ")
      }) — set preview.css in berrybench.config.ts to pick one`,
    );
    return [];
  }
  return found;
}
