import { join } from "@std/path";
import { designPlugin, extractStoryMeta } from "./mod.ts";

const FIXTURES_DIR = join(import.meta.dirname!, "fixtures");
const ctx = (root: string) => ({ root, env: {} as Record<string, string | undefined> });

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

/** Structural equality via JSON; `undefined` fields are dropped by design. */
function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${msg}: expected ${b}, got ${a}`);
}

/** Test-local narrowing for parsed nested record values. */
function recordOf(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown>
    : undefined;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("detect: false on empty dir, true once package.json exists", async () => {
  await withTempDir(async (dir) => {
    assert(await designPlugin.detect(ctx(dir)) === false, "empty dir must not detect");
    await Deno.writeTextFile(
      join(dir, "package.json"),
      await Deno.readTextFile(join(FIXTURES_DIR, "package.json")),
    );
    assert(await designPlugin.detect(ctx(dir)) === true, "package.json must detect");
  });
});

Deno.test("detect + load: design package inside frontend/ (Go-monorepo shape)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "frontend", "src", "stories"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "frontend", "package.json"),
      await Deno.readTextFile(join(FIXTURES_DIR, "package.json")),
    );
    await Deno.copyFile(
      join(FIXTURES_DIR, "button.story.svelte"),
      join(dir, "frontend", "src", "stories", "button.story.svelte"),
    );

    assert(await designPlugin.detect(ctx(dir)) === true, "frontend/package.json must detect");
    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.srcRoot, "frontend", "srcRoot points at the subdir");
    eq(snapshot.packageName, "@wisp-berry/ui", "meta reads the subdir package.json");
    eq(snapshot.stories.length, 1, "stories glob resolves under frontend/src");
    eq(
      snapshot.stories[0]?.file,
      "src/stories/button.story.svelte",
      "story file is design-root-relative",
    );
  });
});

Deno.test("load: stories plus package metadata", async () => {
  await withTempDir(async (dir) => {
    const storyRel = "src/stories/button.story.svelte";
    const storyPath = join(dir, storyRel);
    await Deno.mkdir(join(dir, "src", "stories"), { recursive: true });
    await Deno.copyFile(join(FIXTURES_DIR, "button.story.svelte"), storyPath);
    await Deno.writeTextFile(
      join(dir, "package.json"),
      await Deno.readTextFile(join(FIXTURES_DIR, "package.json")),
    );

    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.packageName, "@wisp-berry/ui", "packageName");
    eq(snapshot.version, "2.4.0", "version");
    // Fixture meta is JSON-parsable (quoted keys + double quotes) apart from
    // the unquoted `title:` key (matched by the TITLE_RE); props/schema/
    // scenarios extract fully.
    eq(snapshot.stories, [{
      file: storyRel,
      title: "Button",
      description: "Primary action trigger.",
      props: { label: "Click me", variant: "primary" },
      schema: {
        label: { type: "string" },
        variant: { type: "enum", options: ["primary", "secondary", "ghost"] },
      },
      code: '<Button variant="primary">Click me</Button>',
      scenarios: [{ name: "Empty", props: { label: "" } }],
    }], "stories");
  });
});

Deno.test("load: empty dir yields no stories and no throw", async () => {
  await withTempDir(async (dir) => {
    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.stories, [], "stories");
    assert(
      snapshot.packageName === undefined && snapshot.version === undefined,
      "no package metadata on empty dir",
    );
  });
});

Deno.test("load: src file (not dir) does not crash glob", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "src"), "plain file");
    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.stories, [], "stories");
  });
});

Deno.test(
  "load: story without title meta yields title undefined (HTML title not matched)",
  async () => {
    await withTempDir(async (dir) => {
      const storyRel = "src/plain.story.svelte";
      const storyPath = join(dir, storyRel);
      await Deno.mkdir(join(dir, "src"), { recursive: true });
      await Deno.writeTextFile(
        storyPath,
        "<html><head><title>Nested</title></head><body><button>plain</button></body></html>\n",
      );

      const snapshot = await designPlugin.load(ctx(dir));
      assert(snapshot.stories.length === 1, "one story found");
      const story = snapshot.stories[0]!;
      eq(story.file, storyRel, "story file");
      assert("title" in story && story.title === undefined, "title key present and undefined");
    });
  },
);

Deno.test("extractStoryMeta: returns all fields from a representative story", () => {
  const text = [
    "<script>",
    "  export const meta = {",
    "    title: 'Badge',",
    "    description: 'Status pills rendered from semantic tokens.',",
    '    props: { "variant": "success", "label": "Label" },',
    '    schema: { "variant": { "type": "enum", "options": ["neutral", "success",',
    '      "warning", "danger"] }, "label": { "type": "string" } },',
    "    code: `" + '<Badge variant="success">Label</Badge>' + "`,",
    "  };",
    "</script>",
  ].join("\n");
  const story = extractStoryMeta(text, "src/components/badge.story.svelte");

  assert(story.file === "src/components/badge.story.svelte", "file");
  assert(story.title === "Badge", "title");
  assert(
    story.description === "Status pills rendered from semantic tokens.",
    "description",
  );
  eq(story.props, { variant: "success", label: "Label" }, "props");

  // Nested schema parsed as real objects: options is a real array, not a string.
  eq(story.schema, {
    variant: { type: "enum", options: ["neutral", "success", "warning", "danger"] },
    label: { type: "string" },
  }, "schema");
  const options = recordOf(recordOf(story.schema)?.["variant"])?.["options"];
  assert(Array.isArray(options), "schema options is a real array");
  eq(options, ["neutral", "success", "warning", "danger"], "schema options values");

  eq(story.code, '<Badge variant="success">Label</Badge>', "code");
});

Deno.test("extractStoryMeta: malformed props stays undefined, rest intact", () => {
  const text = [
    "export const meta = {",
    "  title: 'Broken',",
    "  description: 'Kept.',",
    "  props: { x:",
    "  code: 'still here',",
    "};",
  ].join("\n");
  const story = extractStoryMeta(text, "src/broken.story.svelte");

  assert(story.title === "Broken", "title");
  assert(story.description === "Kept.", "description");
  assert(story.props === undefined, "unbalanced props scan yields undefined");
  eq(story.code, "still here", "code intact after malformed props");
});

Deno.test("extractStoryMeta: escaped backtick inside code template literal is scanned", () => {
  // `code:` value contains escaped backticks; the scanner emits them literally
  // (choice: scan handles `\`` rather than dropping the field).
  const text = "export const meta = { code: `<B>\\`tick\\`</B>` };";
  const story = extractStoryMeta(text, "src/ticks.story.svelte");
  eq(story.code, "<B>`tick`</B>", "code with escaped backticks");
});

Deno.test("extractStoryMeta: scenarios parsed with names and props (JSON array)", () => {
  const text = [
    "export const scenarios = [",
    '  { "name": "Empty", "props": { "label": "" } },',
    '  { "name": "Long", "props": { "label": "a b c" } },',
    "];",
  ].join("\n");
  const story = extractStoryMeta(text, "src/scenarios.story.svelte");

  eq(story.scenarios, [
    { name: "Empty", props: { label: "" } },
    { name: "Long", props: { label: "a b c" } },
  ], "scenario items");
});

Deno.test(
  "extractStoryMeta: scenarios fall back to per-item extraction for JS-literal arrays",
  () => {
    const text = "export const scenarios = [ { name: 'Empty', " +
      'props: { "label": "" } } ];';
    const story = extractStoryMeta(text, "src/js-literal.story.svelte");

    eq(story.scenarios, [{ name: "Empty", props: { label: "" } }], "per-item scenario");
  },
);

Deno.test("extractStoryMeta: scenario item with unparseable props is dropped", () => {
  const text = "export const scenarios = [ { name: 'Empty', props: { label: '' } } ];";
  const story = extractStoryMeta(text, "src/bad-props.story.svelte");

  eq(story.scenarios, [], "unparseable scenario props dropped (props required by shape)");
});
