// packages/vite-plugin/mod.ts
// Vite plugin exposing BerryBench build output as virtual modules:
//   virtual:berrybench-config              -> .berrybench/resolved-config.json
//   virtual:berrybench-snapshots/<id>      -> .berrybench/snapshots/<id>.json
// Missing or unparseable files degrade to a safe module instead of failing the
// build (load failures are warnings, never build errors — see §5 of the plan).
import type { Plugin } from 'vite';
import { isAbsolute, join, relative } from '@std/path';

export const CONFIG_MODULE = 'virtual:berrybench-config';
export const SNAPSHOTS_PREFIX = 'virtual:berrybench-snapshots/';
/** Project-relative snapshot directory; mirrors packages/snapshot/mod.ts. */
export const SNAPSHOT_DIR = '.berrybench/snapshots';

const CONFIG_FILE = '.berrybench/resolved-config.json';
const BERRYBENCH_DIR = '.berrybench';
const SNAPSHOT_IDS = ['design', 'api', 'db'] as const;

/** Return the workspace id when `id` is a known snapshot module, else undefined. */
function snapshotIdOf(id: string): string | undefined {
  if (!id.startsWith(SNAPSHOTS_PREFIX)) return undefined;
  const name = id.slice(SNAPSHOTS_PREFIX.length);
  return (SNAPSHOT_IDS as readonly string[]).includes(name) ? name : undefined;
}

export function berrybench(opts: { root: string }): Plugin {
  const configPath = join(opts.root, CONFIG_FILE);
  const snapshotsPath = join(opts.root, SNAPSHOT_DIR);
  const watchRoot = join(opts.root, BERRYBENCH_DIR);

  return {
    name: 'berrybench',

    resolveId(source) {
      if (source === CONFIG_MODULE) return CONFIG_MODULE;
      const id = snapshotIdOf(source);
      return id !== undefined ? source : null;
    },

    async load(id) {
      if (id === CONFIG_MODULE) {
        try {
          const text = await Deno.readTextFile(configPath);
          return `export default ${JSON.stringify(JSON.parse(text))};`;
        } catch {
          // Missing or unparseable resolved config: boot with an empty object.
          return 'export default {};';
        }
      }
      const snapshot = snapshotIdOf(id);
      if (snapshot !== undefined) {
        try {
          const text = await Deno.readTextFile(join(snapshotsPath, `${snapshot}.json`));
          return `export default ${JSON.stringify(JSON.parse(text))};`;
        } catch {
          return `export default { error: 'no snapshot for ${snapshot}' };`;
        }
      }
      return null;
    },

    // rollup 4 types model watchChange as `(id, { event }) => void`, but the
    // BerryBench contract returns the virtual modules to refresh; cast keeps
    // the richer runtime behavior while satisfying vite's Plugin type.
    watchChange: ((id: string) => {
      const rel = relative(watchRoot, id);
      const underBerrybench = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      if (!underBerrybench) return;
      // Any change under .berrybench may affect every virtual module; reload
      // all of them (harmless when a snapshot does not exist yet).
      return [CONFIG_MODULE, ...SNAPSHOT_IDS.map((name) => SNAPSHOTS_PREFIX + name)];
    }) as unknown as Plugin['watchChange'],
  };
}