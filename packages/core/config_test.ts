import { join } from "@std/path";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@^1";
import { ConfigError, formatConfigFile, readFileConfig, resolveConfig } from "./config.ts";
import type { ProjectContext, WorkspaceId, WorkspacePlugin } from "./workspace.ts";

// Shared empty root so resolveConfig's disk read finds no config file.
const ROOT = await Deno.makeTempDir();

function plugin(id: WorkspaceId, defaultEnabled: boolean, detect: boolean): WorkspacePlugin {
  return {
    id,
    label: id,
    icon: `i-${id}`,
    defaultEnabled,
    requiredDeps: [],
    detect: async () => detect,
    load: async () => ({}),
  };
}

function allPlugins(): WorkspacePlugin[] {
  return [
    plugin("design", true, true),
    plugin("api", true, true),
    plugin("db", false, false),
  ];
}

function ctx(env: Record<string, string | undefined> = {}): ProjectContext {
  return { root: ROOT, env };
}

Deno.test("defaults: no file, no env -> design/api on default, db off default", async () => {
  const resolved = await resolveConfig(ctx(), allPlugins());
  assertEquals(resolved.workspaces.design, { enabled: true, enabledBy: "default" });
  assertEquals(resolved.workspaces.api, { enabled: true, enabledBy: "default" });
  assertEquals(resolved.workspaces.db, { enabled: false, enabledBy: "default" });
  assertEquals(resolved.theme, undefined);
});

Deno.test("detect veto: defaultEnabled true but detect false -> off via auto", async () => {
  const plugins = [
    plugin("design", true, true),
    plugin("api", true, false),
    plugin("db", false, false),
  ];
  const resolved = await resolveConfig(ctx(), plugins);
  assertEquals(resolved.workspaces.api, { enabled: false, enabledBy: "auto" });
  assertEquals(resolved.workspaces.design, { enabled: true, enabledBy: "default" });
});

Deno.test("file overrides: enable + source -> config provenance", async () => {
  const fileConfig = {
    workspaces: {
      db: { enabled: true, source: { connectionString: "x" } },
    },
  };
  const resolved = await resolveConfig(ctx(), allPlugins(), fileConfig);
  assertEquals(resolved.workspaces.db, {
    enabled: true,
    enabledBy: "config",
    source: { connectionString: "x" },
  });
  assertEquals(resolved.workspaces.design, { enabled: true, enabledBy: "default" });
});

Deno.test("file enabledBy ui is preserved, auto collapses to config", async () => {
  const resolved = await resolveConfig(ctx(), allPlugins(), {
    workspaces: {
      api: { enabled: false, enabledBy: "ui" },
      db: { enabled: true, enabledBy: "auto" },
    },
  });
  assertEquals(resolved.workspaces.api, { enabled: false, enabledBy: "ui" });
  assertEquals(resolved.workspaces.db, { enabled: true, enabledBy: "config" });
});

Deno.test("env override beats file for every workspace", async () => {
  const fileConfig = { workspaces: { api: { enabled: false } } };
  const resolved = await resolveConfig(
    ctx({ BERRYBENCH_WORKSPACES: "design,db" }),
    allPlugins(),
    fileConfig,
  );
  assertEquals(resolved.workspaces.design, { enabled: true, enabledBy: "env" });
  assertEquals(resolved.workspaces.api, { enabled: false, enabledBy: "env" });
  assertEquals(resolved.workspaces.db, { enabled: true, enabledBy: "env" });
});

Deno.test("all disabled -> ConfigError with hint", async () => {
  const plugins = [
    plugin("design", true, false),
    plugin("api", true, false),
    plugin("db", false, false),
  ];
  await assertRejects(
    () => resolveConfig(ctx(), plugins),
    ConfigError,
    "enable at least one workspace",
  );
});

Deno.test("unknown workspace id in file -> ConfigError", async () => {
  const fileConfig = { workspaces: { foo: { enabled: true } } };
  await assertRejects(
    () => resolveConfig(ctx(), allPlugins(), fileConfig),
    ConfigError,
    "unknown workspace id: foo",
  );
});

Deno.test("unknown workspace id in env -> ConfigError", async () => {
  await assertRejects(
    () => resolveConfig(ctx({ BERRYBENCH_WORKSPACES: "design,nope" }), allPlugins()),
    ConfigError,
    "unknown workspace id: nope",
  );
});

Deno.test("file theme flows through to resolved config", async () => {
  const resolved = await resolveConfig(ctx(), allPlugins(), {
    theme: { accent: "violet" },
  });
  assertEquals(resolved.theme, { accent: "violet" });
});

Deno.test("unknown top-level keys survive resolve -> format -> re-read", async () => {
  const fileConfig = {
    mySetting: 123,
    nested: { deep: [1, 2, { three: "x" }] },
    workspaces: { db: { enabled: true } },
  };
  const resolved = await resolveConfig(ctx(), allPlugins(), fileConfig);
  assertEquals(resolved.extra, { mySetting: 123, nested: { deep: [1, 2, { three: "x" }] } });

  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(root, "berrybench.config.ts"),
    formatConfigFile(resolved, {}),
  );
  const reread = await readFileConfig(root);
  assertEquals(reread, {
    workspaces: {
      design: { enabled: true },
      api: { enabled: true },
      db: { enabled: true },
    },
    mySetting: 123,
    nested: { deep: [1, 2, { three: "x" }] },
  });
  const resolvedAgain = await resolveConfig(ctx(), allPlugins(), reread);
  assertEquals(resolvedAgain.extra.mySetting, 123);
  assertEquals(resolvedAgain.workspaces.db.enabled, true);

  // extra values are deep-cloned: mutating the resolution cannot alias the file.
  const nested = resolved.extra.nested;
  if (
    nested !== null && typeof nested === "object" && "deep" in nested && Array.isArray(nested.deep)
  ) {
    nested.deep.push(4);
  }
  assertEquals(fileConfig.nested.deep.length, 3);
});

Deno.test("ui toggle survives format + re-read with enabledBy intact", async () => {
  const resolved = await resolveConfig(ctx(), allPlugins(), {
    workspaces: {
      api: { enabled: false, enabledBy: "ui" },
      db: { enabled: true },
    },
  });
  assertEquals(resolved.workspaces.api, { enabled: false, enabledBy: "ui" });

  const out = formatConfigFile(resolved, {});
  assertStringIncludes(out, "api: { enabled: false, enabledBy: 'ui' },");

  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(join(root, "berrybench.config.ts"), out);
  const reread = await readFileConfig(root);
  const resolvedAgain = await resolveConfig(ctx(), allPlugins(), reread);
  // The ui provenance stamp must survive a write-back + re-read cycle.
  assertEquals(resolvedAgain.workspaces.api, { enabled: false, enabledBy: "ui" });
  assertEquals(resolvedAgain.workspaces.db, { enabled: true, enabledBy: "config" });
});

Deno.test("formatConfigFile: header, sorted keys, source block, notes", async () => {
  const resolved = await resolveConfig(ctx(), allPlugins(), {
    workspaces: {
      db: { enabled: true, source: { connectionString: "postgres://localhost/x" } },
    },
    theme: { accent: "violet" },
  });
  const out = formatConfigFile(resolved, { db: "DATABASE_URL present" });
  assertStringIncludes(
    out,
    "// Generated by BerryBench. Edit freely; the CLI merges your edits.",
  );
  const designIdx = out.indexOf("design: {");
  const apiIdx = out.indexOf("api: {");
  const dbIdx = out.indexOf("db: {");
  assert(designIdx >= 0 && designIdx < apiIdx && apiIdx < dbIdx);
  assertStringIncludes(out, "source: { connectionString: 'postgres://localhost/x' }");
  assertStringIncludes(out, "// db: DATABASE_URL present");
  assertStringIncludes(out, "theme: { accent: 'violet' }");
  const apiLine = out.split("\n").find((line) => line.includes("api: {"));
  assert(apiLine !== undefined && !apiLine.includes("source:"));
});

Deno.test("readFileConfig: missing file -> undefined", async () => {
  assertEquals(await readFileConfig(ROOT), undefined);
});

Deno.test("readFileConfig: imports a valid config file", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(root, "berrybench.config.ts"),
    "export default { workspaces: { design: { enabled: true } } };",
  );
  assertEquals(await readFileConfig(root), { workspaces: { design: { enabled: true } } });
});

Deno.test("readFileConfig: parse failure -> ConfigError naming the file", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(join(root, "berrybench.config.ts"), "export default {");
  await assertRejects(
    () => readFileConfig(root),
    ConfigError,
    join(root, "berrybench.config.ts"),
  );
});

Deno.test("readFileConfig: non-object default export -> ConfigError", async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(join(root, "berrybench.config.ts"), "export default 42;");
  await assertRejects(
    () => readFileConfig(root),
    ConfigError,
    "plain object",
  );
});
