// packages/preview/host_test.ts
// Unit tests for host-project preview integration: tailwind detection, host
// global-css scan/resolution, framework runtime aliases, the preview config
// surface (previewOptions + previewViteConfig's host css virtual module).
import { join } from "@std/path";
import { assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@^1";
import { ConfigError, previewOptions } from "../core/mod.ts";
import type { ResolvedConfig } from "../core/mod.ts";
import { detectHostPreviewEnv } from "./host.ts";
import { previewViteConfig } from "./config.ts";
import type { Plugin } from "vite";

async function makePackageJson(base: string, json: Record<string, unknown>): Promise<string> {
  const path = join(base, "package.json");
  await Deno.writeTextFile(path, JSON.stringify(json, null, 2));
  return path;
}

function resolvedWith(preview: unknown): ResolvedConfig {
  return { workspaces: {}, extra: { preview } } as unknown as ResolvedConfig;
}

// --- previewOptions: config surface ---

Deno.test("previewOptions: absent + valid shapes", () => {
  assertEquals(previewOptions(resolvedWith(undefined)), { css: [] });
  assertEquals(previewOptions(resolvedWith({ css: "a.css" })), { css: ["a.css"] });
  assertEquals(previewOptions(resolvedWith({ css: ["a.css"] })), { css: ["a.css"] });
  assertEquals(
    previewOptions(resolvedWith({ css: ["a.css", "b.css"], viteConfig: "v.ts" })),
    { css: ["a.css", "b.css"], viteConfig: "v.ts" },
  );
});

Deno.test("previewOptions: malformed shapes throw ConfigError", () => {
  assertThrows(() => previewOptions(resolvedWith({ css: 5 })), ConfigError);
  assertThrows(() => previewOptions(resolvedWith({ css: [""] })), ConfigError);
  assertThrows(() => previewOptions(resolvedWith({ css: ["ok", 3] })), ConfigError);
  assertThrows(() => previewOptions(resolvedWith({ viteConfig: "" })), ConfigError);
  assertThrows(() => previewOptions(resolvedWith({ viteConfig: ["a.ts"] })), ConfigError);
  assertThrows(() => previewOptions(resolvedWith("nope")), ConfigError);
  assertThrows(() => previewOptions(resolvedWith([1])), ConfigError);
});

// --- detectHostPreviewEnv: tailwind + host css ---

Deno.test("detect: tailwind v4 plugin dep -> useTailwind + scanned css", async () => {
  const base = await Deno.makeTempDir({ prefix: "bb-host-v4-" });
  try {
    await Deno.mkdir(join(base, "src"), { recursive: true });
    const appCss = join(base, "src/app.css");
    await Deno.writeTextFile(appCss, "@import 'tailwindcss';\n");
    const pkg = await makePackageJson(base, { dependencies: { "@tailwindcss/vite": "^4.1" } });
    const env = await detectHostPreviewEnv(base, pkg, {});
    assertEquals(env.useTailwind, true);
    assertEquals(env.cssPostcss, undefined);
    assertEquals(env.tailwindBase, base);
    assertEquals(env.cssFiles, [appCss]);
    assertEquals(env.warnings, []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("detect: tailwind v3 dep + postcss config -> cssPostcss, no useTailwind", async () => {
  const base = await Deno.makeTempDir({ prefix: "bb-host-v3-" });
  try {
    await Deno.writeTextFile(join(base, "postcss.config.js"), "export default {};\n");
    // A plain css without the tailwind import must NOT be picked up.
    await Deno.mkdir(join(base, "src"), { recursive: true });
    await Deno.writeTextFile(join(base, "src/plain.css"), "body { margin: 0 }\n");
    const pkg = await makePackageJson(base, {
      dependencies: { tailwindcss: "^3.4", svelte: "^5" },
    });
    const env = await detectHostPreviewEnv(base, pkg, {});
    assertEquals(env.useTailwind, false);
    assertEquals(env.cssPostcss, join(base, "postcss.config.js"));
    assertEquals(env.cssFiles, []);
    assertEquals(env.warnings, []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("detect: multiple tailwind css -> none + warning hinting preview.css", async () => {
  const base = await Deno.makeTempDir({ prefix: "bb-host-multi-" });
  try {
    await Deno.writeTextFile(join(base, "a.css"), '@import "tailwindcss";\n');
    await Deno.writeTextFile(join(base, "b.css"), '@import "tailwindcss";\n');
    const pkg = await makePackageJson(base, {
      dependencies: { "@tailwindcss/vite": "^4.1" },
    });
    const env = await detectHostPreviewEnv(base, pkg, {});
    assertEquals(env.cssFiles, []);
    assertEquals(env.warnings.length, 1);
    assertMatch(env.warnings[0], /preview\.css/);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("detect: explicit preview.css entries win and skip the scan", async () => {
  const base = await Deno.makeTempDir({ prefix: "bb-host-explicit-" });
  try {
    // This would be the single auto-detected candidate without preview.css.
    await Deno.mkdir(join(base, "src"), { recursive: true });
    await Deno.writeTextFile(join(base, "src/app.css"), "@import 'tailwindcss';\n");
    const pkg = await makePackageJson(base, {
      dependencies: { "@tailwindcss/vite": "^4.1" },
    });
    const env = await detectHostPreviewEnv(base, pkg, { css: ["styles/x.css", "/abs/y.css"] });
    assertEquals(env.cssFiles, [join(base, "styles/x.css"), "/abs/y.css"]);
    assertEquals(env.cssFiles.includes(join(base, "src/app.css")), false);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

// --- previewViteConfig: host css virtual module ---

Deno.test("previewViteConfig: host css module, plugin order, postcss", async () => {
  const cfg = previewViteConfig("/proj", "/tmp/out", {
    hostCss: ["/tmp/x.css"],
    hostCssBase: "/tmp/pkg",
    hostPlugins: [{ name: "fake-host-plugin", enforce: "pre" } as Plugin],
    cssPostcss: "/tmp/postcss.config.js",
  });

  const nameOf = (p: unknown): string =>
    p && typeof p === "object" && !Array.isArray(p) ? String((p as { name?: unknown }).name) : "";
  // Plugin factories (svelte/react) may return nested arrays; flatten like vite.
  const names = (cfg.plugins as unknown[]).flat(Infinity).map(nameOf).filter(Boolean);
  // Built-in framework runtimes lead (names incidental: svelte/react factories
  // emit several internal plugins); the order contract is the tail: cors ->
  // host plugins -> host css -> inline.
  assertEquals(names.length >= 6, true);
  assertEquals(names.slice(-4), [
    "berrybench-preview-cors",
    "fake-host-plugin",
    "berrybench-host-css",
    "berrybench-preview-inline",
  ]);

  const cssPlugin = cfg.plugins!.find((p) =>
    p && typeof p === "object" && !Array.isArray(p) && (p as Plugin).name === "berrybench-host-css"
  ) as Plugin;
  const resolveId = cssPlugin.resolveId as (id: string) => unknown;
  assertEquals(resolveId("virtual:berrybench-host-css"), "\0virtual:berrybench-host-css.css");
  const load = cssPlugin.load as (id: string) => unknown;
  assertEquals(
    await load("\0virtual:berrybench-host-css.css"),
    '@source "/tmp/pkg";\n@import "/tmp/x.css";',
  );

  assertEquals(cfg.css?.postcss, "/tmp/postcss.config.js");
  const aliasArr = cfg.resolve?.alias as Array<{ find: string | RegExp; replacement: string }>;
  assertEquals(aliasArr.length, 3);
  assertEquals(aliasArr[0].find, "@stories");
  assertEquals(aliasArr[1].find, "@pkg");
  // The canvas resolves shadcn-style `$lib` story imports to the host design
  // package's src/lib — same convention as the app shell (libRoot unset here,
  // so the fallback is <root>/src/lib).
  assertEquals(aliasArr[2].find, "$lib");
  assertEquals(aliasArr[2].replacement, "/proj/src/lib");

  // Empty hostCss -> the module still resolves to an empty string.
  const cfg2 = previewViteConfig("/proj", "/tmp/out2", {});
  const p2 = cfg2.plugins!.find((p) =>
    p && typeof p === "object" && !Array.isArray(p) && (p as Plugin).name === "berrybench-host-css"
  ) as Plugin;
  assertEquals(await (p2.load as (id: string) => unknown)("\0virtual:berrybench-host-css.css"), "");
  assertEquals(cfg2.css, undefined);
});
