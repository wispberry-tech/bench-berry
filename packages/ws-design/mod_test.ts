import { join } from '@std/path';
import { designPlugin } from './mod.ts';

const FIXTURES_DIR = join(import.meta.dirname!, 'fixtures');
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

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test('detect: false on empty dir, true once package.json exists', async () => {
  await withTempDir(async (dir) => {
    assert(await designPlugin.detect(ctx(dir)) === false, 'empty dir must not detect');
    await Deno.writeTextFile(
      join(dir, 'package.json'),
      await Deno.readTextFile(join(FIXTURES_DIR, 'package.json')),
    );
    assert(await designPlugin.detect(ctx(dir)) === true, 'package.json must detect');
  });
});

Deno.test('load: stories plus package metadata', async () => {
  await withTempDir(async (dir) => {
    const storyRel = 'src/components/button.story.svelte';
    const storyPath = join(dir, storyRel);
    await Deno.mkdir(join(dir, 'src', 'components'), { recursive: true });
    await Deno.copyFile(join(FIXTURES_DIR, 'button.story.svelte'), storyPath);
    await Deno.writeTextFile(
      join(dir, 'package.json'),
      await Deno.readTextFile(join(FIXTURES_DIR, 'package.json')),
    );

    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.packageName, '@wisp-berry/ui', 'packageName');
    eq(snapshot.version, '2.4.0', 'version');
    eq(snapshot.stories, [{ file: storyRel, title: 'Button' }], 'stories');
  });
});

Deno.test('load: empty dir yields no stories and no throw', async () => {
  await withTempDir(async (dir) => {
    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.stories, [], 'stories');
    assert(
      snapshot.packageName === undefined && snapshot.version === undefined,
      'no package metadata on empty dir',
    );
  });
});

Deno.test('load: src file (not dir) does not crash glob', async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, 'src'), 'plain file');
    const snapshot = await designPlugin.load(ctx(dir));
    eq(snapshot.stories, [], 'stories');
  });
});

Deno.test('load: story without title meta yields title undefined (HTML title not matched)', async () => {
  await withTempDir(async (dir) => {
    const storyRel = 'src/plain.story.svelte';
    const storyPath = join(dir, storyRel);
    await Deno.mkdir(join(dir, 'src'), { recursive: true });
    await Deno.writeTextFile(
      storyPath,
      '<html><head><title>Nested</title></head><body><button>plain</button></body></html>\n',
    );

    const snapshot = await designPlugin.load(ctx(dir));
    assert(snapshot.stories.length === 1, 'one story found');
    const story = snapshot.stories[0]!;
    eq(story.file, storyRel, 'story file');
    assert('title' in story && story.title === undefined, 'title key present and undefined');
  });
});