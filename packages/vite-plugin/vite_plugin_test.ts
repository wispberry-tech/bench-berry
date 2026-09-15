// packages/vite-plugin/vite_plugin_test.ts
// Integration: the plugin must serve the resolved config + workspace snapshots
// as virtual modules that survive a real Vite production build. The project
// under test mirrors what `berrybench build` writes to `.berrybench/`.
import { join } from "@std/path";
import { assert, assertMatch } from "jsr:@std/assert@^1";
import { build, createServer } from "vite";
import { createRegistry, resolveConfig } from "../core/mod.ts";
import type { ResolvedConfig } from "../core/mod.ts";
import { designPlugin } from "../ws-design/mod.ts";
import { apiPlugin } from "../ws-api/mod.ts";
import { dbPlugin } from "../ws-db/mod.ts";
import { writeSnapshots } from "../snapshot/mod.ts";
import { berrybench, ENV_MODULE } from "./mod.ts";

const PLUGINS = [designPlugin, apiPlugin, dbPlugin];

/** Scratch project root with the ws-* fixtures copied in. */
async function makeProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "berrybench-vite-" });
  await Deno.copyFile(
    join(import.meta.dirname!, "fixtures/proj/openapi.yaml"),
    join(root, "openapi.yaml"),
  );
  await Deno.copyFile(
    join(import.meta.dirname!, "fixtures/proj/package.json"),
    join(root, "package.json"),
  );
  return root;
}

/** Replicate what `berrybench build` leaves on disk: snapshots + resolved-config.json. */
async function materializeBuildOutput(root: string): Promise<{ resolved: ResolvedConfig }> {
  const ctx = { root, env: {} as Record<string, string | undefined> };
  const resolved = await resolveConfig(ctx, PLUGINS);
  await Deno.mkdir(join(root, ".berrybench/snapshots"), { recursive: true });
  await writeSnapshots({ root, plugins: PLUGINS, resolved });
  await Deno.writeTextFile(
    join(root, ".berrybench/resolved-config.json"),
    JSON.stringify(resolved, null, 2),
  );
  return { resolved };
}

/** Join every emitted chunk (write: false) into one string for assertions. */
function chunkCode(result: unknown): string {
  const bundles = Array.isArray(result) ? result : [result];
  const code: string[] = [];
  for (const bundle of bundles) {
    if (typeof bundle !== "object" || bundle === null) continue;
    const entries = (bundle as { output?: Array<{ code?: string }> }).output ?? [];
    for (const entry of entries) {
      if (typeof entry.code === "string") code.push(entry.code);
    }
  }
  return code.join("\n");
}

Deno.test("serves resolved config + api snapshot as bundleable virtual modules", async () => {
  const root = await makeProject();
  try {
    const { resolved } = await materializeBuildOutput(root);
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [berrybench({ root })],
      build: {
        write: false,
        // Keep literals un-minified so bundle assertions read the module text
        // (the plugin contract, not esbuild's output mangling).
        minify: false,
        rollupOptions: {
          input: join(import.meta.dirname!, "fixtures/entry.ts"),
          output: { format: "es" },
        },
      },
    });
    const code = chunkCode(result);
    // api snapshot module: `export default {"endpointCount":3,"title":"Fixture API"}`
    // (rollup reprints module literals, so match whitespace-tolerantly).
    assert(code.includes("Fixture API"), "bundle missing api title");
    assertMatch(code, /"endpointCount"\s*:\s*3/, "bundle missing api endpointCount 3");
    // The resolved-config module carries the api enablement from the resolution.
    assertMatch(
      code,
      new RegExp(`"?enabled"?\\s*:\\s*${resolved.workspaces.api.enabled}`),
      "bundle missing resolved api enablement",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("missing snapshot module degrades to an error object", async () => {
  const root = await makeProject();
  try {
    await materializeBuildOutput(root); // db is disabled: no db.json is written
    try {
      await Deno.remove(join(root, ".berrybench/snapshots/db.json"));
    } catch {
      // Already absent as expected (disabled workspace never gets a file).
    }
    const entry = join(root, "entry-db.ts");
    await Deno.writeTextFile(
      entry,
      "import db from 'virtual:berrybench-snapshots/db';\nconsole.log(JSON.stringify(db));\n",
    );
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [berrybench({ root })],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: entry, output: { format: "es" } },
      },
    });
    const code = chunkCode(result);
    // The missing snapshot module: `export default { error: 'no snapshot for db' };`
    assert(code.includes("no snapshot for db"), "bundle missing no-snapshot error");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** Boot the plugin in dev-server mode (middleware, no public port) for module-load assertions. */
async function devServer(root: string) {
  return createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [berrybench({ root })],
    server: { middlewareMode: true },
  });
}

Deno.test("aggregate snapshot module serves one key per enabled workspace", async () => {
  const root = await makeProject();
  try {
    await Deno.mkdir(join(root, ".berrybench/snapshots"), { recursive: true });
    const resolved: ResolvedConfig = {
      workspaces: {
        design: { enabled: true, enabledBy: "config" },
        api: { enabled: true, enabledBy: "auto" },
        db: { enabled: false, enabledBy: "default" },
      },
      extra: {},
    };
    await Deno.writeTextFile(
      join(root, ".berrybench/resolved-config.json"),
      JSON.stringify(resolved, null, 2),
    );
    await Deno.writeTextFile(
      join(root, ".berrybench/snapshots/design.json"),
      JSON.stringify({ packageName: "@wisp/ui", stories: [{ file: "src/Tabs.svelte" }] }, null, 2),
    );
    await Deno.writeTextFile(
      join(root, ".berrybench/snapshots/api.json"),
      JSON.stringify({ endpointCount: 2, ops: [{ id: "a", method: "GET", path: "/a" }] }, null, 2),
    );

    const server = await devServer(root);
    try {
      const mod = await server.ssrLoadModule("virtual:berrybench-snapshots");
      const snapshots = mod.default as Record<string, unknown>;
      // Exactly the enabled workspaces: design + api; db stays out.
      assert(
        Object.keys(snapshots).sort().join(",") === "api,design",
        `aggregate keys: ${Object.keys(snapshots).join(",")}`,
      );
      assert(!("db" in snapshots), "disabled db must be absent from the aggregate");
      const design = snapshots.design as { packageName?: string };
      assert(design.packageName === "@wisp/ui", "design snapshot not served");
      const api = snapshots.api as { endpointCount?: number };
      assert(api.endpointCount === 2, "api snapshot not served");
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("aggregate reports a missing enabled snapshot as an error object", async () => {
  const root = await makeProject();
  try {
    await Deno.mkdir(join(root, ".berrybench/snapshots"), { recursive: true });
    const resolved: ResolvedConfig = {
      workspaces: {
        design: { enabled: false, enabledBy: "default" },
        api: { enabled: true, enabledBy: "config" },
        db: { enabled: false, enabledBy: "default" },
      },
      extra: {},
    };
    await Deno.writeTextFile(
      join(root, ".berrybench/resolved-config.json"),
      JSON.stringify(resolved, null, 2),
    );
    // No api.json on disk: the aggregate must degrade per key, never fail the load.

    const server = await devServer(root);
    try {
      const mod = await server.ssrLoadModule("virtual:berrybench-snapshots");
      const snapshots = mod.default as Record<string, unknown>;
      assert(
        Object.keys(snapshots).length === 1 && "api" in snapshots,
        `expected only api: ${Object.keys(snapshots).join(",")}`,
      );
      const api = snapshots.api as { error?: string };
      assert(api.error === "no snapshot for api", `unexpected api value: ${JSON.stringify(api)}`);
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ENV_MODULE emits the production env object in a build", async () => {
  const root = await makeProject();
  try {
    await materializeBuildOutput(root);
    const entry = join(root, "entry-env.ts");
    await Deno.writeTextFile(
      entry,
      "import env from 'virtual:berrybench-env';\nconsole.log(JSON.stringify(env));\n",
    );
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [berrybench({ root })],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: entry, output: { format: "es" } },
      },
    });
    const code = chunkCode(result);
    // Build mode: the static relative base + dev:false (rollup reprints
    // module literals, so match whitespace-tolerantly).
    assert(code.includes("./preview/"), `bundle missing relative preview base: ${code}`);
    assertMatch(code, /"dev"\s*:\s*false/, "bundle missing dev:false");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ENV_MODULE emits the dev env with the localhost preview base in a dev server", async () => {
  const root = await makeProject();
  const previousPort = Deno.env.get("BERRYBENCH_PREVIEW_PORT");
  Deno.env.set("BERRYBENCH_PREVIEW_PORT", "5999");
  try {
    const server = await devServer(root);
    try {
      const mod = await server.ssrLoadModule(ENV_MODULE);
      const env = mod.default as { dev?: boolean; preview?: { base?: string } };
      assert(env.dev === true, `expected dev:true, got ${JSON.stringify(env)}`);
      assert(
        env.preview?.base === "http://localhost:5999/preview/",
        `unexpected dev base: ${env.preview?.base}`,
      );
    } finally {
      await server.close();
    }
  } finally {
    if (previousPort === undefined) {
      Deno.env.delete("BERRYBENCH_PREVIEW_PORT");
    } else {
      Deno.env.set("BERRYBENCH_PREVIEW_PORT", previousPort);
    }
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("POST /__berrybench/config merges the delta and persists the config file", async () => {
  const root = await makeProject();
  try {
    await Deno.mkdir(join(root, ".berrybench"), { recursive: true });
    const current: ResolvedConfig = {
      workspaces: {
        design: { enabled: true, enabledBy: "config", source: { storyGlob: "src/**/*.svelte" } },
        api: { enabled: true, enabledBy: "auto" },
        db: { enabled: false, enabledBy: "default" },
      },
      extra: {},
    };
    await Deno.writeTextFile(
      join(root, ".berrybench/resolved-config.json"),
      JSON.stringify(current, null, 2),
    );

    // A real (non-middleware) dev server: vite 7 forbids listen() in
    // middleware mode, and /__berrybench/config is a genuine HTTP endpoint.
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [berrybench({ root })],
      server: { port: 0 }, // ephemeral port
    });
    try {
      await server.listen();
      const port = (server.httpServer!.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/__berrybench/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaces: { db: { enabled: true } },
        }),
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await res.json() as { ok?: boolean; file?: string };
      assert(
        body.ok === true && body.file === "berrybench.config.ts",
        `unexpected body: ${JSON.stringify(body)}`,
      );

      // The canonical writer (core formatConfigFile) persists enablement state
      // and source; tune the assertions to what the file actually serializes.
      const text = await Deno.readTextFile(join(root, "berrybench.config.ts"));
      assert(text.includes("db: { enabled: true"), `db toggle missing: ${text}`);
      assert(
        text.includes("source: { storyGlob: 'src/**/*.svelte' }"),
        `design source not preserved: ${text}`,
      );
      assert(!text.includes("defaultTheme"), `defaultTheme must not be written: ${text}`);
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("POST /__berrybench/config rejects an all-disabled delta without touching the file", async () => {
  const root = await makeProject();
  try {
    await Deno.mkdir(join(root, ".berrybench"), { recursive: true });
    const current: ResolvedConfig = {
      workspaces: {
        design: { enabled: true, enabledBy: "config" },
        api: { enabled: true, enabledBy: "auto" },
        db: { enabled: true, enabledBy: "config" },
      },
      extra: {},
    };
    await Deno.writeTextFile(
      join(root, ".berrybench/resolved-config.json"),
      JSON.stringify(current, null, 2),
    );
    const originalFile = "export default { workspaces: {} };\n";
    await Deno.writeTextFile(join(root, "berrybench.config.ts"), originalFile);

    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [berrybench({ root })],
      server: { port: 0 },
    });
    try {
      await server.listen();
      const port = (server.httpServer!.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/__berrybench/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaces: {
            design: { enabled: false },
            api: { enabled: false },
            db: { enabled: false },
          },
        }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
      const body = await res.json() as { ok?: boolean; error?: string };
      assert(
        body.ok === false && body.error!.startsWith("enable at least one workspace"),
        `unexpected body: ${JSON.stringify(body)}`,
      );
      // The canonical writer must never run for a broken resolution.
      assert(
        await Deno.readTextFile(join(root, "berrybench.config.ts")) === originalFile,
        "config file changed on rejected write-back",
      );
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
