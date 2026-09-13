import { assertEquals, assert, assertRejects } from 'jsr:@std/assert@^1';
import { join } from '@std/path';
import type { ProjectContext } from '../core/workspace.ts';
import { apiSnapshotSchema } from '../snapshot/mod.ts';
import { apiPlugin, type ApiSnapshot } from './mod.ts';

const FIXTURE = join(import.meta.dirname!, 'fixtures', 'openapi.yaml');

function makeCtx(root: string): ProjectContext {
  return { root, env: {} };
}

Deno.test('api plugin detect', async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await t.step('false when no spec file exists', async () => {
      assertEquals(await apiPlugin.detect(makeCtx(root)), false);
    });

    await t.step('true with openapi.yaml', async () => {
      await Deno.copyFile(FIXTURE, join(root, 'openapi.yaml'));
      assertEquals(await apiPlugin.detect(makeCtx(root)), true);
    });

    await t.step('true with openapi.yml', async () => {
      const ymlRoot = join(root, 'yml-only');
      await Deno.mkdir(ymlRoot);
      await Deno.copyFile(FIXTURE, join(ymlRoot, 'openapi.yml'));
      assertEquals(await apiPlugin.detect(makeCtx(ymlRoot)), true);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('api plugin load from fixture', async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.copyFile(FIXTURE, join(root, 'openapi.yaml'));

    let snapshot: ApiSnapshot;
    await t.step('loads snapshot from openapi.yaml', async () => {
      snapshot = await apiPlugin.load(makeCtx(root));
      assertEquals(snapshot.title, 'Fixture API');
      assertEquals(snapshot.version, '1.2.3');
      assertEquals(snapshot.endpointCount, 3);
      assertEquals(snapshot.ops.length, 3);
    });

    await t.step('first op is GET /issues', async () => {
      assertEquals(snapshot.ops[0].id, 'issues-get');
      assertEquals(snapshot.ops[0].method, 'GET');
      assertEquals(snapshot.ops[0].path, '/issues');
      assertEquals(snapshot.ops[0].summary, 'List issues');
    });

    await t.step('path-level parameters/tags/summary do not count as ops', async () => {
      const ids = snapshot.ops.map((op) => op.id);
      assertEquals(ids, ['issues-get', 'issues-post', 'issues-seg-get']);
      assertEquals(snapshot.ops[2].method, 'GET');
      assertEquals(snapshot.ops[2].path, '/issues/{id}');
      assertEquals(snapshot.ops[2].summary, 'Get issue');
    });

    await t.step('summary falls back to first line of description', async () => {
      assertEquals(snapshot.ops[1].summary, 'Create a new issue.');
    });

    await t.step('x-berrybench extension parses table + comp cross-links', async () => {
      assertEquals(snapshot.ops[0].table, 'issues');
      assertEquals(snapshot.ops[0].comp, 'badge');
    });

    await t.step('ops without x-berrybench keep the old shape (fields absent)', async () => {
      assertEquals('table' in snapshot.ops[1], false);
      assertEquals('comp' in snapshot.ops[1], false);
      assertEquals('table' in snapshot.ops[2], false);
      assertEquals('comp' in snapshot.ops[2], false);
    });

    await t.step('snapshot round-trips through apiSnapshotSchema (old ops unchanged)', async () => {
      const parsed = apiSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
      assertEquals(parsed.endpointCount, 3);
      assertEquals(parsed.ops[0].table, 'issues');
      assertEquals(parsed.ops[0].comp, 'badge');
      assertEquals(parsed.ops[1].table, undefined);
      assertEquals(parsed.ops[1].comp, undefined);
      assertEquals(parsed.ops[2].table, undefined);
      assertEquals(parsed.ops[2].comp, undefined);
    });

    await t.step('loads from openapi.yml too', async () => {
      const ymlRoot = join(root, 'yml-only');
      await Deno.mkdir(ymlRoot);
      await Deno.copyFile(FIXTURE, join(ymlRoot, 'openapi.yml'));
      const ymlSnapshot = await apiPlugin.load(makeCtx(ymlRoot));
      assertEquals(ymlSnapshot.endpointCount, 3);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('api plugin load edge cases', async (t) => {
  const root = await Deno.makeTempDir();
  try {
    await t.step('root path slug is just the method', async () => {
      await Deno.writeTextFile(
        join(root, 'openapi.yaml'),
        [
          'openapi: 3.0.3',
          'info:',
          '  title: Edge API',
          "  version: '1'",
          'paths:',
          '  /:',
          '    parameters:',
          '      - name: x',
          '        in: header',
          '        schema:',
          '          type: string',
          '    get:',
          '      summary: Root',
          '      responses:',
          '        "200":',
          '          description: OK',
          '',
        ].join('\n'),
      );
      const snapshot = await apiPlugin.load(makeCtx(root));
      assertEquals(snapshot.endpointCount, 1);
      assertEquals(snapshot.ops[0].id, 'get');
      assertEquals(snapshot.ops[0].method, 'GET');
    });

    await t.step('no paths yields endpointCount 0', async () => {
      const emptyPaths = join(root, 'no-paths');
      await Deno.mkdir(emptyPaths);
      await Deno.writeTextFile(
        join(emptyPaths, 'openapi.yaml'),
        ['openapi: 3.0.3', 'info:', '  title: Bare', "  version: '1'", 'paths: {}', ''].join('\n'),
      );
      const snapshot = await apiPlugin.load(makeCtx(emptyPaths));
      assertEquals(snapshot.endpointCount, 0);
      assertEquals(snapshot.ops, []);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('api plugin load rejects corrupt yaml', async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, 'openapi.yaml'), 'openapi: [unclosed\n');
    await assertRejects(
      () => apiPlugin.load(makeCtx(root)),
      Error,
      'unable to parse openapi.yaml in',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('api plugin load fails when no spec file', async () => {
  const root = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => apiPlugin.load(makeCtx(root)),
      Error,
      'unable to parse openapi.yaml in',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});