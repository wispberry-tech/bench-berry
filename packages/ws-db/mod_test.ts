// packages/ws-db/mod_test.ts
// Unit tests for the db workspace plugin. No live database required: every
// scenario either runs without a connection string or fails before touching a
// real server.
import { assertEquals, assertMatch } from "jsr:@std/assert@^1";
import { dbPlugin } from "./mod.ts";

function ctx(env: Record<string, string | undefined>) {
  return { root: "/tmp/berry-bench-ws-db-fixture", env };
}

Deno.test("dbPlugin metadata", () => {
  assertEquals(dbPlugin.id, "db");
  assertEquals(dbPlugin.label, "Database");
  assertEquals(dbPlugin.icon, "i-db");
  assertEquals(dbPlugin.defaultEnabled, false);
  assertEquals(dbPlugin.requiredDeps, ["BERRYBENCH_DATABASE_URL"]);
});

Deno.test("detect is a cheap env check", async () => {
  assertEquals(await dbPlugin.detect(ctx({})), false);
  assertEquals(await dbPlugin.detect(ctx({ BERRYBENCH_DATABASE_URL: "" })), false);
  assertEquals(
    await dbPlugin.detect(ctx({ BERRYBENCH_DATABASE_URL: "postgres://localhost/bb" })),
    true,
  );
});

Deno.test("detect also fires on a repo-shaped db/ dir (migrations)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/db/migrations`, { recursive: true });
    assertEquals(await dbPlugin.detect({ root: dir, env: {} }), true);
    // No db/ dir -> false (not a db repo by shape).
    const bare = await Deno.makeTempDir();
    try {
      assertEquals(await dbPlugin.detect({ root: bare, env: {} }), false);
    } finally {
      await Deno.remove(bare, { recursive: true });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("load with unset BERRYBENCH_DATABASE_URL returns no-connection snapshot", async () => {
  const snapshot = await dbPlugin.load(ctx({}));
  assertEquals(snapshot.tables, []);
  assertEquals(
    snapshot.error,
    "no database connection configured (set BERRYBENCH_DATABASE_URL)",
  );
});

Deno.test("load with invalid URL resolves to failure snapshot instead of throwing", async () => {
  const snapshot = await dbPlugin.load(ctx({ BERRYBENCH_DATABASE_URL: "not-a-url" }));
  assertEquals(snapshot.tables, []);
  assertMatch(snapshot.error ?? "", /database connection failed/);
});
