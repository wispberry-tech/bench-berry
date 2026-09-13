// packages/ws-db/mod_test.ts
// Unit tests for the db workspace plugin. No live database required: every
// scenario either runs without a connection string or fails before touching a
// real server.
import { assertEquals, assertMatch } from "jsr:@std/assert@^1";
import type { ColRow, CountRow, FkRow, PkRow, TableRow } from "./mod.ts";
import { assembleTables, dbPlugin } from "./mod.ts";

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

Deno.test("assembleTables builds DbTables from raw introspection rows", () => {
  const tables: TableRow[] = [
    { schema: "public", name: "users" },
    { schema: "public", name: "posts" },
    { schema: "public", name: "empty" }, // base table with zero columns survives
  ];
  const columns: ColRow[] = [
    { schema: "public", table: "users", name: "id", type: "integer", nullable: false, default: null },
    { schema: "public", table: "users", name: "email", type: "citext", nullable: false, default: null },
    { schema: "public", table: "users", name: "created_at", type: "timestamp with time zone", nullable: false, default: "now()" },
    { schema: "public", table: "posts", name: "id", type: "integer", nullable: false, default: null },
    // Column whose table is not in the tables list: dropped, no table created.
    { schema: "public", table: "orphan", name: "x", type: "integer", nullable: true, default: null },
  ];
  const pks: PkRow[] = [
    { schema: "public", table: "users", column: "id" },
    { schema: "public", table: "posts", column: "id" },
  ];
  const fks: FkRow[] = [
    { schema: "public", table: "posts", column: "user_id", refTable: "users", refColumn: "id" },
  ];
  const counts: CountRow[] = [
    { schema: "public", name: "users", est: 42 },
    { schema: "public", name: "posts", est: -1 }, // never analyzed -> rowCount omitted
    { schema: "public", name: "empty", est: 0 }, // 0 is a valid estimate -> included
  ];

  const result = assembleTables({ tables, columns, pks, fks, counts });
  const byName = new Map(result.map((t) => [t.name, t]));

  // One DbTable per listed BASE TABLE, in first-seen order; the orphan column
  // created no table.
  assertEquals(result.map((t) => t.name), ["users", "posts", "empty"]);

  // (a) columns assembled in row order with type/nullable/default; (b) PK
  // flagging comes from pk rows, unpk'd columns stay false.
  const users = byName.get("users")!;
  assertEquals(users.schema, "public");
  assertEquals(
    users.columns.map((c) => [c.name, c.type, c.nullable, c.primaryKey, c.default]),
    [
      ["id", "integer", false, true, undefined],
      ["email", "citext", false, false, undefined],
      ["created_at", "timestamp with time zone", false, false, "now()"],
    ],
  );

  // (c) FK attachment with resolved referenced table/column.
  const posts = byName.get("posts")!;
  assertEquals(posts.columns[0].primaryKey, true);
  assertEquals(posts.foreignKeys, [
    { column: "user_id", referencesTable: "users", referencesColumn: "id" },
  ]);
  assertEquals(users.foreignKeys, []);

  // (d) rowCount present when est >= 0, absent when negative.
  assertEquals(users.rowCount, 42);
  assertEquals(byName.get("empty")!.rowCount, 0);
  assertEquals("rowCount" in posts, false);

  // (e) a table with zero columns survives with empty collections.
  const empty = byName.get("empty")!;
  assertEquals(empty.columns, []);
  assertEquals(empty.foreignKeys, []);
});
