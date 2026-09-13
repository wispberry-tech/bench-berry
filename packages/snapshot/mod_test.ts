import { assert, assertEquals } from "jsr:@std/assert@^1";
import { join } from "@std/path";
import type {
  ResolvedConfig,
  WorkspaceId,
  WorkspacePlugin,
  WorkspaceResolution,
} from "../core/mod.ts";
import { listSnapshots, readSnapshot, SNAPSHOT_DIR, snapshotPath, writeSnapshots } from "./mod.ts";

function fakePlugin(id: WorkspaceId, load: () => unknown): WorkspacePlugin {
  return {
    id,
    label: id,
    icon: `i-${id}`,
    defaultEnabled: true,
    requiredDeps: [],
    detect: async () => true,
    load: async () => load(),
  };
}

function resolvedWith(enabled: Partial<Record<WorkspaceId, boolean>>): ResolvedConfig {
  const workspaces = {} as Record<WorkspaceId, WorkspaceResolution>;
  for (const id of ["design", "api", "db"] as const) {
    workspaces[id] = { enabled: enabled[id] ?? false, enabledBy: "default" };
  }
  return { workspaces, extra: {} };
}

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("writeSnapshots writes a valid enabled workspace snapshot", async () => {
  await withTempDir(async (root) => {
    const plugins = [fakePlugin("api", () => ({
      server: "https://api.example.test/v1",
      endpointCount: 1,
      ops: [{
        id: "pets-get",
        method: "GET",
        path: "/pets",
        parameters: [{ name: "limit", in: "query", type: "integer", example: 10 }],
        requestExample: { limit: 10 },
        responses: [{ status: "200", description: "OK", example: { limit: 10 } }],
      }],
    }))];
    const results = await writeSnapshots({ root, plugins, resolved: resolvedWith({ api: true }) });

    assertEquals(
      results.api,
      { ok: true, file: join(SNAPSHOT_DIR, "api.json") },
    );
    const snap = await readSnapshot<{ endpointCount: number }>(root, "api");
    assertEquals(snap?.endpointCount, 1);

    // Deterministic content: pretty-printed JSON + trailing newline. The exact
    // echo proves the new optional fields (server / param type+example /
    // requestExample / response example) pass through the zod schema intact.
    const raw = await Deno.readTextFile(snapshotPath(root, "api"));
    assertEquals(raw.endsWith("\n"), true);
    assertEquals(JSON.parse(raw), {
      server: "https://api.example.test/v1",
      endpointCount: 1,
      ops: [{
        id: "pets-get",
        method: "GET",
        path: "/pets",
        parameters: [{ name: "limit", in: "query", type: "integer", example: 10 }],
        requestExample: { limit: 10 },
        responses: [{ status: "200", description: "OK", example: { limit: 10 } }],
      }],
    });
  });
});

Deno.test("disabled workspace deletes a stale snapshot and writes none", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, SNAPSHOT_DIR), { recursive: true });
    const stalePath = snapshotPath(root, "api");
    await Deno.writeTextFile(stalePath, '{"stale":true}\n');

    const results = await writeSnapshots({ root, plugins: [], resolved: resolvedWith({}) });

    assertEquals(results.api, { ok: true, file: undefined });
    // Stale file removed, nothing written for any workspace.
    assertEquals(await readSnapshot(root, "api"), undefined);
    assertEquals(await listSnapshots(root), []);
  });
});

Deno.test("load throwing writes an error snapshot", async () => {
  await withTempDir(async (root) => {
    const plugins = [fakePlugin("api", () => {
      throw new Error("boom");
    })];
    const results = await writeSnapshots({ root, plugins, resolved: resolvedWith({ api: true }) });

    assert(results.api.ok);
    assertEquals(results.api.error, "load failed: boom");
    const snap = await readSnapshot<{ error?: string }>(root, "api");
    assertEquals(snap?.error, "load failed: boom");
  });
});

Deno.test("invalid snapshot data writes a validation error snapshot", async () => {
  await withTempDir(async (root) => {
    const plugins = [fakePlugin("api", () => ({ endpointCount: "x" }))];
    const results = await writeSnapshots({ root, plugins, resolved: resolvedWith({ api: true }) });

    assert(results.api.ok);
    assert(results.api.error?.startsWith("snapshot validation failed"));
    const snap = await readSnapshot<{ error?: string }>(root, "api");
    assert(snap?.error?.startsWith("snapshot validation failed"));
  });
});

Deno.test("readSnapshot and listSnapshots reflect disk state", async () => {
  await withTempDir(async (root) => {
    // Missing snapshot -> undefined, no snapshot dir -> empty list.
    assertEquals(await readSnapshot(root, "api"), undefined);
    assertEquals(await listSnapshots(root), []);

    const plugins = [
      fakePlugin("design", () => ({ packageName: "ui", stories: [{ file: "a.story.svelte" }] })),
      fakePlugin(
        "api",
        () => ({ endpointCount: 1, ops: [{ id: "o", method: "GET", path: "/x" }] }),
      ),
      fakePlugin("db", () => ({
        tables: [{
          name: "t",
          schema: "public",
          columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }],
          foreignKeys: [],
        }],
      })),
    ];
    await writeSnapshots({
      root,
      plugins,
      resolved: resolvedWith({ design: true, api: true, db: true }),
    });

    // Round-trips valid JSON unchanged.
    assertEquals(
      await readSnapshot(root, "api"),
      { endpointCount: 1, ops: [{ id: "o", method: "GET", path: "/x" }] },
    );
    // All three present, fixed design -> api -> db order.
    assertEquals(await listSnapshots(root), ["design", "api", "db"]);

    // Removed file is no longer listed.
    await Deno.remove(snapshotPath(root, "db"));
    assertEquals(await listSnapshots(root), ["design", "api"]);
  });
});

Deno.test("writeSnapshots passes env through to plugin.load", async () => {
  await withTempDir(async (root) => {
    let seen: Record<string, string | undefined> | undefined;
    const plugins = [
      {
        id: "db" as const,
        label: "Database",
        icon: "i-db",
        defaultEnabled: false,
        requiredDeps: ["BERRYBENCH_DATABASE_URL"],
        detect: async () => true,
        load: async (ctx: { env: Record<string, string | undefined> }) => {
          seen = ctx.env;
          return { tables: [], error: undefined };
        },
      } satisfies WorkspacePlugin,
    ];

    await writeSnapshots({
      root,
      plugins,
      resolved: resolvedWith({ db: true }),
      env: { BERRYBENCH_DATABASE_URL: "postgres://x" },
    });
    assertEquals(seen, { BERRYBENCH_DATABASE_URL: "postgres://x" });
  });
});
