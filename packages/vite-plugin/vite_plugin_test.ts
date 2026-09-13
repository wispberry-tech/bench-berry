// packages/vite-plugin/vite_plugin_test.ts
// Integration: the plugin must serve the resolved config + workspace snapshots
// as virtual modules that survive a real Vite production build. The project
// under test mirrors what `berrybench build` writes to `.berrybench/`.
import { join } from '@std/path';
import { assert, assertMatch } from 'jsr:@std/assert@^1';
import { build } from 'vite';
import { createRegistry, resolveConfig } from '../core/mod.ts';
import type { ResolvedConfig } from '../core/mod.ts';
import { designPlugin } from '../ws-design/mod.ts';
import { apiPlugin } from '../ws-api/mod.ts';
import { dbPlugin } from '../ws-db/mod.ts';
import { writeSnapshots } from '../snapshot/mod.ts';
import { berrybench } from './mod.ts';

const PLUGINS = [designPlugin, apiPlugin, dbPlugin];

/** Scratch project root with the ws-* fixtures copied in. */
async function makeProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'berrybench-vite-' });
  await Deno.copyFile(
    join(import.meta.dirname!, 'fixtures/proj/openapi.yaml'),
    join(root, 'openapi.yaml'),
  );
  await Deno.copyFile(
    join(import.meta.dirname!, 'fixtures/proj/package.json'),
    join(root, 'package.json'),
  );
  return root;
}

/** Replicate what `berrybench build` leaves on disk: snapshots + resolved-config.json. */
async function materializeBuildOutput(root: string): Promise<{ resolved: ResolvedConfig }> {
  const ctx = { root, env: {} as Record<string, string | undefined> };
  const resolved = await resolveConfig(ctx, PLUGINS);
  await Deno.mkdir(join(root, '.berrybench/snapshots'), { recursive: true });
  await writeSnapshots({ root, plugins: PLUGINS, resolved });
  await Deno.writeTextFile(
    join(root, '.berrybench/resolved-config.json'),
    JSON.stringify(resolved, null, 2),
  );
  return { resolved };
}

/** Join every emitted chunk (write: false) into one string for assertions. */
function chunkCode(result: unknown): string {
  const bundles = Array.isArray(result) ? result : [result];
  const code: string[] = [];
  for (const bundle of bundles) {
    if (typeof bundle !== 'object' || bundle === null) continue;
    const entries = (bundle as { output?: Array<{ code?: string }> }).output ?? [];
    for (const entry of entries) {
      if (typeof entry.code === 'string') code.push(entry.code);
    }
  }
  return code.join('\n');
}

Deno.test('serves resolved config + api snapshot as bundleable virtual modules', async () => {
  const root = await makeProject();
  try {
    const { resolved } = await materializeBuildOutput(root);
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [berrybench({ root })],
      build: {
        write: false,
        // Keep literals un-minified so bundle assertions read the module text
        // (the plugin contract, not esbuild's output mangling).
        minify: false,
        rollupOptions: {
          input: join(import.meta.dirname!, 'fixtures/entry.ts'),
          output: { format: 'es' },
        },
      },
    });
    const code = chunkCode(result);
    // api snapshot module: `export default {"endpointCount":3,"title":"Fixture API"}`
    // (rollup reprints module literals, so match whitespace-tolerantly).
    assert(code.includes('Fixture API'), 'bundle missing api title');
    assertMatch(code, /"endpointCount"\s*:\s*3/, 'bundle missing api endpointCount 3');
    // The resolved-config module carries the api enablement from the resolution.
    assertMatch(
      code,
      new RegExp(`"?enabled"?\\s*:\\s*${resolved.workspaces.api.enabled}`),
      'bundle missing resolved api enablement',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('missing snapshot module degrades to an error object', async () => {
  const root = await makeProject();
  try {
    await materializeBuildOutput(root); // db is disabled: no db.json is written
    try {
      await Deno.remove(join(root, '.berrybench/snapshots/db.json'));
    } catch {
      // Already absent as expected (disabled workspace never gets a file).
    }
    const entry = join(root, 'entry-db.ts');
    await Deno.writeTextFile(
      entry,
      "import db from 'virtual:berrybench-snapshots/db';\nconsole.log(JSON.stringify(db));\n",
    );
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [berrybench({ root })],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: entry, output: { format: 'es' } },
      },
    });
    const code = chunkCode(result);
    // The missing snapshot module: `export default { error: 'no snapshot for db' };`
    assert(code.includes('no snapshot for db'), 'bundle missing no-snapshot error');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});