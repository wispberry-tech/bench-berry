import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert@^1";
import { createRegistry } from "./registry.ts";
import type { WorkspaceId, WorkspacePlugin } from "./workspace.ts";

function fakePlugin(id: WorkspaceId, overrides: Partial<WorkspacePlugin> = {}): WorkspacePlugin {
  return {
    id,
    label: id,
    icon: `i-${id}`,
    defaultEnabled: true,
    requiredDeps: [],
    detect: async () => true,
    load: async () => ({}),
    ...overrides,
  };
}

Deno.test("createRegistry exposes plugins, workspaceIds, and byId", () => {
  const design = fakePlugin("design");
  const db = fakePlugin("db");
  const registry = createRegistry([design, db]);
  assertEquals(registry.plugins(), [design, db]);
  assertEquals(registry.workspaceIds(), ["design", "db"]);
  assertStrictEquals(registry.byId("design"), design);
  assertStrictEquals(registry.byId("db"), db);
  assertEquals(registry.byId("api"), undefined);
});

Deno.test("createRegistry throws on duplicate id", () => {
  assertThrows(
    () => createRegistry([fakePlugin("design"), fakePlugin("design")]),
    Error,
    "duplicate workspace plugin: design",
  );
});

Deno.test("createRegistry throws on unknown id", () => {
  const unknown = { ...fakePlugin("design"), id: "bogus" } as unknown as WorkspacePlugin;
  assertThrows(
    () => createRegistry([unknown]),
    Error,
    "unknown workspace id: bogus",
  );
});
