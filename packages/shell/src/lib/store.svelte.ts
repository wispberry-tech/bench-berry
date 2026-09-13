// packages/shell/src/lib/store.svelte.ts
// Reactive store for the BerryBench shell. Loads the virtual modules
// (resolved config, aggregate snapshots, preview env) once at module init and
// re-applies them on HMR updates of either module. Exposes $state `config`,
// `snapshots` and `env`, plus the Contract types re-exported for consumers.
//
// NOTE: this file is `.svelte.ts` so the Svelte compiler transforms the
// runes — a plain `.ts` file is not compiled (runes would be undefined at
// runtime). The `// @ts-ignore` comments keep `deno check` green on the
// virtual-module imports, which vite resolves at dev/build time.
import type { Component } from 'svelte';
import type { ResolvedConfig, WorkspaceId } from './types.ts';
import { WORKSPACE_IDS } from './types.ts';

// @ts-ignore — resolved by the berrybench vite plugin
import configModule from 'virtual:berrybench-config';
// @ts-ignore — resolved by the berrybench vite plugin
import snapshotsModule from 'virtual:berrybench-snapshots';
// @ts-ignore — resolved by the berrybench vite plugin
import envModule from 'virtual:berrybench-env';

const CONFIG_MODULE = 'virtual:berrybench-config';
const SNAPSHOTS_MODULE = 'virtual:berrybench-snapshots';
const ENV_MODULE = 'virtual:berrybench-env';

/** Live preview environment: `dev` flag + the preview base URL (see §4.6). */
export interface PreviewEnv {
  dev: boolean;
  preview: { base: string };
}

/** Dev fallback for the preview server (BERRYBENCH_PREVIEW_PORT ?? 5174). */
const DEV_PREVIEW_BASE = 'http://localhost:5174/preview/';

interface ViteHot {
  accept(deps: string[], cb: (mods: unknown[]) => void): void;
}

/** Degraded boot state: everything disabled until the config module loads. */
function initialWorkspaces(): ResolvedConfig['workspaces'] {
  return {
    design: { enabled: false, enabledBy: 'default' },
    api: { enabled: false, enabledBy: 'default' },
    db: { enabled: false, enabledBy: 'default' },
  };
}

export const config = $state<ResolvedConfig>({ workspaces: initialWorkspaces() });
export const snapshots = $state<Record<WorkspaceId, unknown>>({} as Record<WorkspaceId, unknown>);

/**
 * Live preview environment. The virtual module default-exports
 * `{ dev, preview: { base } }`; falls back to the dev preview server URL when
 * the module cannot be loaded, so the shell still works before P4Wire wiring.
 */
export const env = $state<PreviewEnv>({ dev: true, preview: { base: DEV_PREVIEW_BASE } });

/** Replace per-workspace entries from the config module (missing -> disabled). */
function applyConfig(raw: unknown): void {
  const next = (raw ?? {}) as Partial<ResolvedConfig>;
  const workspaces = next.workspaces ?? {};
  for (const id of WORKSPACE_IDS) {
    const w = (workspaces as Record<string, unknown>)[id];
    config.workspaces[id] =
      (w && typeof w === 'object' ? w : { enabled: false, enabledBy: 'default' }) as ResolvedConfig['workspaces'][WorkspaceId];
  }
  config.theme = next.theme;
}

/** Sync snapshot values; disabled workspaces (absent keys) are removed. */
function applySnapshots(raw: unknown): void {
  const next = (raw ?? {}) as Record<string, unknown>;
  for (const id of WORKSPACE_IDS) {
    if (id in next) {
      snapshots[id] = next[id];
    } else {
      delete snapshots[id];
    }
  }
}

/** Sync the preview env from the virtual module (keeps the dev/build defaults). */
function applyEnv(raw: unknown): void {
  const r = raw as Partial<PreviewEnv> | undefined;
  if (typeof r?.dev === 'boolean') env.dev = r.dev;
  if (typeof r?.preview?.base === 'string') env.preview.base = r.preview.base;
}

applyConfig(configModule);
applySnapshots(snapshotsModule);
applyEnv(envModule);

const hot = (import.meta as ImportMeta & { hot?: ViteHot }).hot;
if (hot) {
  hot.accept([CONFIG_MODULE, SNAPSHOTS_MODULE, ENV_MODULE], (mods) => {
    const list = mods as { default?: unknown }[];
    applyConfig(list[0]?.default);
    applySnapshots(list[1]?.default);
    applyEnv(list[2]?.default);
  });
}

export type {
  ApiSnapshot,
  DbSnapshot,
  DesignSnapshot,
  ResolvedConfig,
  SnapshotError,
  ThemeConfig,
  WorkspaceId,
} from './types.ts';