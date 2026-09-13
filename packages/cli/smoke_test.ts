// packages/cli/smoke_test.ts
// §6 closure verification, no browser required: real end-to-end CLI runs
// (init → snapshot → build) against disposable fixture projects, plus a
// compiled-binary check (`deno compile`) proving config --print works without
// a checkout and dev exits 1 with an actionable missing-shell error.
//
// Run via: deno task smoke   (deno test -A packages/cli/smoke_test.ts)
//
// Env hygiene: the compiled-binary dev error only triggers when
// BERRYBENCH_SHELL_DIR is unset; clear it for this file's whole process so
// in-process builds use the repo shell and child commands are deterministic.
Deno.env.delete('BERRYBENCH_SHELL_DIR');

import { join } from '@std/path';
import { run } from './main.ts';
import type { CliContext } from './main.ts';
import { readSnapshot } from '../snapshot/mod.ts';

/** The deno binary for `deno compile` (task env provides DENO, else the known path). */
const DENO = Deno.env.get('DENO') ?? '/home/theo/.deno/bin/deno';

/** Repo root: smoke_test.ts lives at packages/cli/. */
const REPO_ROOT = join(import.meta.dirname!, '../..');

const FIXTURE_OPENAPI = await Deno.readTextFile(
  new URL('../ws-api/fixtures/openapi.yaml', import.meta.url),
);

interface DesignSnapshotLike {
  stories: Array<{ file: string; title?: string; schema?: Record<string, unknown> }>;
}
interface ApiSnapshotLike {
  endpointCount: number;
  ops: Array<{ id: string; method: string }>;
}

function capturingCtx(cwd: string): {
  ctx: CliContext;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    ctx: {
      cwd,
      env: {},
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
    stdout,
    stderr,
  };
}

/** A design source (package.json) plus an optional api source (openapi.yaml). */
async function fixtureProject(root: string, withOpenapi: boolean): Promise<void> {
  await Deno.writeTextFile(join(root, 'package.json'), '{"name":"smoke-fixture","version":"0.0.0"}\n');
  if (withOpenapi) {
    await Deno.writeTextFile(join(root, 'openapi.yaml'), FIXTURE_OPENAPI);
  }
}

/** Concatenated text of every file under `dir` (dist output; all text assets). */
async function readAllText(dir: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(path: string): Promise<void> {
    for await (const entry of Deno.readDir(path)) {
      const full = join(path, entry.name);
      if (entry.isDirectory) {
        await walk(full);
      } else if (entry.isFile) {
        // Mirrors vite build output: html/js/css only; skip anything unreadable.
        chunks.push(await Deno.readTextFile(full));
      }
    }
  }
  await walk(dir);
  return chunks.join('\n');
}

/** Process env without BERRYBENCH_SHELL_DIR, so child commands hit the default path. */
function envWithoutShellDir(): Record<string, string> {
  const env = Deno.env.toObject();
  delete env.BERRYBENCH_SHELL_DIR;
  return env;
}

Deno.test(
  'smoke: design+api fixture init → snapshot → build end to end',
  { timeout: 180_000 },
  async (t) => {
    const tmp = await Deno.makeTempDir();
    try {
      await fixtureProject(tmp, true);

      await t.step('init writes the config and scaffolds the story convention', async () => {
        const cap = capturingCtx(tmp);
        const code = await run(['init', '.'], cap.ctx);
        if (code !== 0) throw new Error(`init exited ${code}: ${cap.stderr.join('\n')}`);
        await Deno.stat(join(tmp, 'berrybench.config.ts'));
        await Deno.stat(join(tmp, 'src/components/button.svelte'));
        await Deno.stat(join(tmp, 'src/components/button.story.svelte'));
        if (
          cap.stdout.join('\n').includes(
            'scaffolded src/components/button.story.svelte (story convention)',
          ) !== true
        ) {
          throw new Error(`scaffold line missing: ${cap.stdout.join('\n')}`);
        }
      });

      await t.step('snapshot writes design story meta with schema + api ops', async () => {
        const cap = capturingCtx(tmp);
        const code = await run(['snapshot', '.'], cap.ctx);
        if (code !== 0) throw new Error(`snapshot exited ${code}: ${cap.stderr.join('\n')}`);
        const design = await readSnapshot<DesignSnapshotLike>(tmp, 'design');
        if (design?.stories.length !== 1) {
          throw new Error(`design stories: ${JSON.stringify(design)}`);
        }
        const story = design.stories[0]!;
        if (story.file !== 'src/components/button.story.svelte') {
          throw new Error(`story file: ${story.file}`);
        }
        if (story.title !== 'Button') throw new Error(`story title: ${String(story.title)}`);
        if (story.schema === undefined) {
          throw new Error('design story meta missing schema key');
        }
        const api = await readSnapshot<ApiSnapshotLike>(tmp, 'api');
        if (api?.endpointCount !== 3 || api.ops.some((op) => op.id === 'issues-get') !== true) {
          throw new Error(`api ops: ${JSON.stringify(api)}`);
        }
      });

      await t.step('build emits dist, preview and .berrybench artifacts', async () => {
        const cap = capturingCtx(tmp);
        const code = await run(['build', '.'], cap.ctx);
        if (code !== 0) throw new Error(`build exited ${code}: ${cap.stderr.join('\n')}`);
        await Deno.stat(join(tmp, 'dist/index.html'));
        await Deno.stat(join(tmp, 'dist/preview/index.html'));
        const resolved = JSON.parse(
          await Deno.readTextFile(join(tmp, '.berrybench/resolved-config.json')),
        ) as { workspaces?: Record<string, { enabled?: boolean }> };
        if (resolved.workspaces?.design?.enabled !== true) {
          throw new Error(`resolved config: ${JSON.stringify(resolved)}`);
        }
        const manifest = JSON.parse(
          await Deno.readTextFile(join(tmp, '.berrybench/manifest.json')),
        ) as { workspaces?: Record<string, { ok?: boolean }> };
        if (manifest.workspaces?.design?.ok !== true) {
          throw new Error(`manifest: ${JSON.stringify(manifest)}`);
        }
      });
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  'smoke: design-only build excludes api op ids from dist',
  { timeout: 180_000 },
  async (t) => {
    const tmp = await Deno.makeTempDir();
    try {
      await fixtureProject(tmp, false);
      let cap = capturingCtx(tmp);
      let code = await run(['init', '.'], cap.ctx);
      if (code !== 0) throw new Error(`init exited ${code}: ${cap.stderr.join('\n')}`);
      // init enables api by default; fixture B is design-only, so switch it off.
      cap = capturingCtx(tmp);
      code = await run(['config', 'disable', 'api', '.'], cap.ctx);
      if (code !== 0) throw new Error(`config disable exited ${code}: ${cap.stderr.join('\n')}`);

      await t.step('build succeeds with api disabled', async () => {
        cap = capturingCtx(tmp);
        code = await run(['build', '.'], cap.ctx);
        if (code !== 0) throw new Error(`build exited ${code}: ${cap.stderr.join('\n')}`);
        await Deno.stat(join(tmp, 'dist/index.html'));
      });

      await t.step('dist JS has the design story id but no api op id', async () => {
        const text = await readAllText(join(tmp, 'dist'));
        if (text.includes('button.story') !== true) {
          throw new Error('built assets missing design story id (button.story)');
        }
        if (text.includes('issues-get') === true) {
          throw new Error('built assets contain api op id (issues-get) with api disabled');
        }
      });
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  'smoke: compiled binary resolves config standalone and dev fails with the missing-shell error',
  { timeout: 600_000 },
  async (t) => {
    const tmp = await Deno.makeTempDir();
    const binPath = join(tmp, 'berrybench');
    try {
      await fixtureProject(tmp, true);
      const initCap = capturingCtx(tmp);
      const initCode = await run(['init', '.'], initCap.ctx);
      if (initCode !== 0) {
        throw new Error(`init exited ${initCode}: ${initCap.stderr.join('\n')}`);
      }

      await t.step('deno compile produces the binary', async () => {
        const res = await new Deno.Command(DENO, {
          args: ['compile', '-A', '--output', binPath, join(REPO_ROOT, 'packages/cli/main.ts')],
          cwd: REPO_ROOT,
          stdout: 'piped',
          stderr: 'piped',
        }).output();
        if (res.code !== 0) {
          const stderr = new TextDecoder().decode(res.stderr);
          throw new Error(`deno compile exited ${res.code}: ${stderr}`);
        }
        await Deno.stat(binPath);
      });

      await t.step('config --print --json from the binary resolves the project', async () => {
        const res = await new Deno.Command(binPath, {
          args: ['config', '--print', '--json'],
          cwd: tmp,
          env: envWithoutShellDir(),
          stdout: 'piped',
          stderr: 'piped',
        }).output();
        if (res.code !== 0) {
          throw new Error(
            `binary config exited ${res.code}: ${new TextDecoder().decode(res.stderr)}`,
          );
        }
        const parsed = JSON.parse(new TextDecoder().decode(res.stdout)) as {
          workspaces?: Record<string, { enabled?: boolean }>;
        };
        if (parsed.workspaces?.design?.enabled !== true) {
          throw new Error(`binary config lacks enabled design: ${JSON.stringify(parsed)}`);
        }
      });

      await t.step('dev from the binary exits 1 with the actionable missing-shell error', async () => {
        const res = await new Deno.Command(binPath, {
          args: ['dev', '.'],
          cwd: tmp,
          env: envWithoutShellDir(),
          stdout: 'piped',
          stderr: 'piped',
        }).output();
        if (res.code !== 1) {
          throw new Error(`expected dev exit 1, got ${res.code}`);
        }
        const stderr = new TextDecoder().decode(res.stderr);
        if (stderr.includes('Shell app not found at') !== true) {
          throw new Error(`dev stderr missing shell path: ${stderr}`);
        }
        if (
          stderr.includes('set BERRYBENCH_SHELL_DIR to a berry-bench checkout/packages/shell') !==
          true
        ) {
          throw new Error(`dev stderr missing shell hint: ${stderr}`);
        }
      });
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);