import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { join } from "@std/path";
import type { ProjectContext } from "../core/workspace.ts";
import { apiSnapshotSchema } from "../snapshot/mod.ts";
import { apiPlugin, exampleFromSchema, type ApiSnapshot } from "./mod.ts";

const FIXTURE = join(import.meta.dirname!, "fixtures", "openapi.yaml");

function makeCtx(root: string): ProjectContext {
  return { root, env: {} };
}

Deno.test("api plugin detect", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await t.step("false when no spec file exists", async () => {
      assertEquals(await apiPlugin.detect(makeCtx(root)), false);
    });

    await t.step("true with openapi.yaml", async () => {
      await Deno.copyFile(FIXTURE, join(root, "openapi.yaml"));
      assertEquals(await apiPlugin.detect(makeCtx(root)), true);
    });

    await t.step("true with openapi.yml", async () => {
      const ymlRoot = join(root, "yml-variant");
      await Deno.mkdir(ymlRoot);
      await Deno.copyFile(FIXTURE, join(ymlRoot, "openapi.yml"));
      assertEquals(await apiPlugin.detect(makeCtx(ymlRoot)), true);
    });

    await t.step("true with docs/swagger.yaml", async () => {
      const swaggerRoot = join(root, "docs-variant");
      await Deno.mkdir(join(swaggerRoot, "docs"), { recursive: true });
      await Deno.copyFile(FIXTURE, join(swaggerRoot, "docs", "swagger.yaml"));
      assertEquals(await apiPlugin.detect(makeCtx(swaggerRoot)), true);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin load from fixture", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.copyFile(FIXTURE, join(root, "openapi.yaml"));

    let snapshot: ApiSnapshot;
    await t.step("loads snapshot from openapi.yaml", async () => {
      snapshot = await apiPlugin.load(makeCtx(root));
      assertEquals(snapshot.title, "Fixture API");
      assertEquals(snapshot.version, "1.2.3");
      assertEquals(snapshot.endpointCount, 3);
      assertEquals(snapshot.ops.length, 3);
    });

    await t.step("first op is GET /issues", async () => {
      assertEquals(snapshot.ops[0].id, "issues-get");
      assertEquals(snapshot.ops[0].method, "GET");
      assertEquals(snapshot.ops[0].path, "/issues");
      assertEquals(snapshot.ops[0].summary, "List issues");
    });

    await t.step("path-level parameters/tags/summary do not count as ops", async () => {
      const ids = snapshot.ops.map((op) => op.id);
      assertEquals(ids, ["issues-get", "issues-post", "issues-seg-get"]);
      assertEquals(snapshot.ops[2].method, "GET");
      assertEquals(snapshot.ops[2].path, "/issues/{id}");
      assertEquals(snapshot.ops[2].summary, "Get issue");
    });

    await t.step("summary falls back to first line of description", async () => {
      assertEquals(snapshot.ops[1].summary, "Create a new issue.");
    });

    await t.step("x-berrybench extension parses table + comp cross-links", async () => {
      assertEquals(snapshot.ops[0].table, "issues");
      assertEquals(snapshot.ops[0].comp, "badge");
    });

    await t.step("ops without x-berrybench keep the old shape (fields absent)", async () => {
      assertEquals("table" in snapshot.ops[1], false);
      assertEquals("comp" in snapshot.ops[1], false);
      assertEquals("table" in snapshot.ops[2], false);
      assertEquals("comp" in snapshot.ops[2], false);
    });

    await t.step("snapshot round-trips through apiSnapshotSchema (old ops unchanged)", async () => {
      const parsed = apiSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
      assertEquals(parsed.endpointCount, 3);
      assertEquals(parsed.ops[0].table, "issues");
      assertEquals(parsed.ops[0].comp, "badge");
      assertEquals(parsed.ops[1].table, undefined);
      assertEquals(parsed.ops[1].comp, undefined);
      assertEquals(parsed.ops[2].table, undefined);
      assertEquals(parsed.ops[2].comp, undefined);
    });

    await t.step("loads from openapi.yml too", async () => {
      const ymlRoot = join(root, "yml-only");
      await Deno.mkdir(ymlRoot);
      await Deno.copyFile(FIXTURE, join(ymlRoot, "openapi.yml"));
      const ymlSnapshot = await apiPlugin.load(makeCtx(ymlRoot));
      assertEquals(ymlSnapshot.endpointCount, 3);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin load edge cases", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await t.step("root path slug is just the method", async () => {
      await Deno.writeTextFile(
        join(root, "openapi.yaml"),
        [
          "openapi: 3.0.3",
          "info:",
          "  title: Edge API",
          "  version: '1'",
          "paths:",
          "  /:",
          "    parameters:",
          "      - name: x",
          "        in: header",
          "        schema:",
          "          type: string",
          "    get:",
          "      summary: Root",
          "      responses:",
          '        "200":',
          "          description: OK",
          "",
        ].join("\n"),
      );
      const snapshot = await apiPlugin.load(makeCtx(root));
      assertEquals(snapshot.endpointCount, 1);
      assertEquals(snapshot.ops[0].id, "get");
      assertEquals(snapshot.ops[0].method, "GET");
    });

    await t.step("no paths yields endpointCount 0", async () => {
      const emptyPaths = join(root, "no-paths");
      await Deno.mkdir(emptyPaths);
      await Deno.writeTextFile(
        join(emptyPaths, "openapi.yaml"),
        ["openapi: 3.0.3", "info:", "  title: Bare", "  version: '1'", "paths: {}", ""].join("\n"),
      );
      const snapshot = await apiPlugin.load(makeCtx(emptyPaths));
      assertEquals(snapshot.endpointCount, 0);
      assertEquals(snapshot.ops, []);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin dedupes colliding op slugs deterministically", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: Dup API",
        "  version: '1'",
        "paths:",
        "  /pets:",
        "    get:",
        "      summary: collect",
        "      responses:",
        '        "200":',
        "          description: OK",
        "  /pets/:",
        "    get:",
        "      summary: collect trailing",
        "      responses:",
        '        "200":',
        "          description: OK",
        "  /pets//:",
        "    get:",
        "      summary: collect double",
        "      responses:",
        '        "200":',
        "          description: OK",
        "",
      ].join("\n"),
    );
    await t.step("first occurrence keeps the bare slug, later ones get suffixes", async () => {
      const snapshot = await apiPlugin.load(makeCtx(root));
      const ids = snapshot.ops.map((op) => op.id);
      // /pets, /pets/ and /pets// all slug to `pets-get`; the op order from
      // the spec decides who keeps the bare id.
      assertEquals(ids, ["pets-get", "pets-get-2", "pets-get-3"]);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin load rejects corrupt yaml", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "openapi.yaml"), "openapi: [unclosed\n");
    await assertRejects(
      () => apiPlugin.load(makeCtx(root)),
      Error,
      "unable to parse openapi.yaml in",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin load fails when no spec file", async () => {
  const root = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => apiPlugin.load(makeCtx(root)),
      Error,
      "unable to parse openapi.yaml in",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin extracts tags, parameters, request body and responses", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: Rich API",
        "  version: '2.0'",
        "paths:",
        "  /pets:",
        "    get:",
        "      operationId: listPets",
        "      tags:",
        "        - Pets",
        "        - Read",
        "      parameters:",
        "        - name: limit",
        "          in: query",
        "          required: true",
        "          description: Max results",
        "          schema:",
        "            type: integer",
        "        - $ref: '#/components/parameters/Filter'",
        "      responses:",
        '        "200":',
        "          description: A list of pets",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/Pet'",
        '        "400":',
        "          description: Bad request",
        "    post:",
        "      tags:",
        "        - Pets",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              $ref: '#/components/schemas/NewPet'",
        "      responses:",
        '        "201":',
        "          description: Created",
        "  /admin/ops:",
        "    get:",
        "      tags:",
        "        - Admin",
        "      requestBody:",
        "        content:",
        "          text/plain:",
        "            schema:",
        "              type: string",
        "      responses:",
        '        "204":',
        "          description: No content",
        "  /bare:",
        "    get:",
        "      summary: Bare",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      properties:",
        "        id:",
        "          type: string",
        "        name:",
        "          type: string",
        "    NewPet:",
        "      type: object",
        "      properties:",
        "        name:",
        "          type: string",
        "  parameters:",
        "    Filter:",
        "      name: filter",
        "      in: query",
        "      schema:",
        "        type: string",
        "",
      ].join("\n"),
    );
    const snapshot = await apiPlugin.load(makeCtx(root));
    assertEquals(snapshot.endpointCount, 4);
    const [petsGet, petsPost, adminGet, bareGet] = snapshot.ops;

    await t.step("tags are present and ordered on declared ops, absent otherwise", async () => {
      assertEquals(petsGet.tags, ["Pets", "Read"]);
      assertEquals(petsPost.tags, ["Pets"]);
      assertEquals(adminGet.tags, ["Admin"]);
      assertEquals("tags" in bareGet, false);
    });

    await t.step("operationId extracted when declared", async () => {
      assertEquals(petsGet.operationId, "listPets");
      assertEquals("operationId" in bareGet, false);
    });

    await t.step("parameters carry name/in/required/description/type/example; $ref entries skipped", async () => {
      assertEquals(petsGet.parameters, [{
        name: "limit",
        in: "query",
        required: true,
        description: "Max results",
        type: "integer",
        example: 0,
      }]);
      assertEquals("parameters" in petsPost, false);
      assertEquals("parameters" in bareGet, false);
    });

    await t.step("requestSchema from application/json content, $ref resolved", async () => {
      assertEquals(petsPost.requestSchema, {
        type: "object",
        properties: { name: { type: "string" } },
      });
    });

    await t.step("requestSchema falls back to the first content entry", async () => {
      assertEquals(adminGet.requestSchema, { type: "string" });
    });

    await t.step("responses resolve $ref schemas to real objects + synthesized example", async () => {
      assertEquals(petsGet.responses, [
        {
          status: "200",
          description: "A list of pets",
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
          },
          example: { id: "string", name: "string" },
        },
        { status: "400", description: "Bad request" },
      ]);
      // Resolved schema is a real object, not a `$ref` wrapper.
      const resolved = petsGet.responses![0].schema as Record<string, unknown>;
      assertEquals("$ref" in resolved, false);
    });

    await t.step("description-only response entries carry status + description", async () => {
      assertEquals(petsPost.responses, [{ status: "201", description: "Created" }]);
      assertEquals(adminGet.responses, [{ status: "204", description: "No content" }]);
    });

    await t.step("op with none of the new fields keeps the old shape", async () => {
      assertEquals(bareGet.summary, "Bare");
      assertEquals("tags" in bareGet, false);
      assertEquals("parameters" in bareGet, false);
      assertEquals("requestSchema" in bareGet, false);
      assertEquals("responses" in bareGet, false);
      assertEquals("operationId" in bareGet, false);
    });

    await t.step("snapshot round-trips through apiSnapshotSchema", async () => {
      const parsed = apiSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
      assertEquals(parsed.ops.length, 4);
      assertEquals(parsed.ops[0].tags, ["Pets", "Read"]);
      assertEquals(parsed.ops[0].parameters![0].required, true);
      assertEquals(parsed.ops[1].requestSchema, {
        type: "object",
        properties: { name: { type: "string" } },
      });
      assertEquals(parsed.ops[0].responses![0].status, "200");
      assertEquals(parsed.ops[3].responses, undefined);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("api plugin extracts param types/examples, examples map, request/response examples and server", async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: Examples API",
        "  version: '1.0'",
        "servers:",
        "  - url: https://api.example.test/v1",
        "paths:",
        "  /pets:",
        "    get:",
        "      summary: List pets",
        "      parameters:",
        "        - name: limit",
        "          in: query",
        "          required: true",
        "          description: Max results",
        "          schema:",
        "            type: integer",
        "            default: 5",
        "          example: 10",
        "        - name: q",
        "          in: query",
        "          examples:",
        "            term:",
        "              value: rex",
        "          schema:",
        "            $ref: '#/components/schemas/Term'",
        "      responses:",
        '        "200":',
        "          description: A list of pets",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/Pet'",
        '        "404":',
        "          description: Not found",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/NotFound'",
        "    post:",
        "      summary: Create pet",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              $ref: '#/components/schemas/NewPet'",
        "            example:",
        "              name: Rex",
        "      responses:",
        '        "201":',
        "          description: Created",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/NewPet'",
        "              example:",
        "                name: Rex",
        "components:",
        "  schemas:",
        "    Term:",
        "      type: string",
        "    Pet:",
        "      type: object",
        "      properties:",
        "        id:",
        "          type: integer",
        "        name:",
        "          type: string",
        "    NewPet:",
        "      type: object",
        "      properties:",
        "        name:",
        "          type: string",
        "    NotFound:",
        "      type: object",
        "      properties:",
        "        message:",
        "          type: string",
        "",
      ].join("\n"),
    );
    const snapshot = await apiPlugin.load(makeCtx(root));

    await t.step("server comes from servers[0].url", async () => {
      assertEquals(snapshot.server, "https://api.example.test/v1");
    });

    await t.step("param type from schema; explicit example beats schema default/synthesis", async () => {
      const limit = snapshot.ops[0].parameters![0];
      assertEquals(limit.type, "integer");
      assertEquals(limit.example, 10);
    });

    await t.step("examples map form resolves type through $ref", async () => {
      const q = snapshot.ops[0].parameters![1];
      assertEquals(q.type, "string");
      assertEquals(q.example, "rex");
    });

    await t.step("response example synthesized from resolved response schema", async () => {
      assertEquals(snapshot.ops[0].responses![0].example, { id: 0, name: "string" });
    });

    await t.step("schema-only responses also get a synthesized example", async () => {
      assertEquals(snapshot.ops[0].responses![1].example, { message: "string" });
    });

    await t.step("requestExample from requestBody content example", async () => {
      assertEquals(snapshot.ops[1].requestExample, { name: "Rex" });
    });

    await t.step("explicit response content example wins", async () => {
      assertEquals(snapshot.ops[1].responses![0].example, { name: "Rex" });
    });

    await t.step("snapshot round-trips new fields through apiSnapshotSchema", async () => {
      const parsed = apiSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
      assertEquals(parsed.server, "https://api.example.test/v1");
      assertEquals(parsed.ops[0].parameters![0].type, "integer");
      assertEquals(parsed.ops[0].parameters![0].example, 10);
      assertEquals(parsed.ops[0].responses![0].example, { id: 0, name: "string" });
      assertEquals(parsed.ops[0].responses![1].example, { message: "string" });
      assertEquals(parsed.ops[1].requestExample, { name: "Rex" });
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("exampleFromSchema synthesizes bounded deterministic examples", () => {
  const spec = {};
  assertEquals(exampleFromSchema(spec, {
    type: "object",
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
    },
  }), { id: 0, name: "string" });
  assertEquals(exampleFromSchema(spec, { type: "array", items: { type: "string" } }), ["string"]);
  assertEquals(exampleFromSchema(spec, { type: "array" }), []);
  assertEquals(exampleFromSchema(spec, { type: "string", enum: ["open", "closed"] }), "open");
  assertEquals(exampleFromSchema(spec, { type: "integer", default: 5 }), 5);
  assertEquals(exampleFromSchema(spec, { type: "integer", default: 5, example: 9 }), 9);
  assertEquals(exampleFromSchema(spec, { type: "boolean", const: true }), true);
  assertEquals(exampleFromSchema(spec, { oneOf: [{ type: "boolean" }, { type: "string" }] }), false);
  assertEquals(exampleFromSchema(spec, {
    allOf: [
      { type: "object", properties: { id: { type: "integer" } } },
      { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
    ],
  }), { id: 0, name: "string" });

  // Depth cap: a property nested five levels deep yields null (bounded output).
  const deep = {
    type: "object",
    properties: {
      l1: {
        type: "object",
        properties: {
          l2: {
            type: "object",
            properties: {
              l3: {
                type: "object",
                properties: {
                  l4: {
                    type: "object",
                    properties: { leaf: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const out = exampleFromSchema(spec, deep) as { l1: { l2: { l3: { l4: { leaf: unknown } } } } };
  assertEquals(out.l1.l2.l3.l4.leaf, null);
});

Deno.test("api plugin omits server when the spec declares none", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.3",
        "info:",
        "  title: Bare",
        "  version: '1'",
        "paths:",
        "  /x:",
        "    get:",
        "      responses:",
        '        "200":',
        "          description: OK",
        "",
      ].join("\n"),
    );
    const snapshot = await apiPlugin.load(makeCtx(root));
    assertEquals("server" in snapshot, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
