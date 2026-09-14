# BerryBench — Application Architecture

> Status: decision-complete design (ducky). No implementation yet.
> Repo of record: `berry-book` (prototype + this plan). Target repo: `berry-bench` — layout in §4.1.

## 1. Goal

BerryBench is a developer "swiss army knife" that replaces three separate tools with one
per-repo workspace app: a **Design System browser** (Storybook-style with LIVE component
previews), an **OpenAPI explorer**, and a **Database schema viewer**. Not every project
needs every workspace — a project that only ships components should only see the Design
workspace. Workspaces are **enabled and disabled by need**: administratively from inside
the tool, persisted to a checked-in TypeScript config file (like `sanity.config.ts` /
`keystone.ts`), so each project's `berrybench` install shows exactly the workspaces its data
sources support. The whole app is CLI-generated per repo (`berrybench init` / `berrybench dev` /
`berrybench build` → static `dist/`, Storybook-style). The CLI runs on **Deno 2** — native
TypeScript, zero build step for tooling, distributed as a single compiled binary installed
from GitHub only (no registry publishing for now) — and drives
a Svelte + Vite SPA whose visual language is already prototyped and verified in the `berry-book`
mockup.

## 2. Context

Grounding from the existing prototype (`berry-book/src/`, read this session):

- The mockup is a single `index.html` assembled from fragments; its look-and-feel is the
  design spec for the real app: CSS variable tokens for light/dark/accent themes
  (`src/00-shell.html` `:root`, `html[data-theme=dark]`, `html[data-accent=*]` blocks),
  the shell chrome (workspace dropdown `.tb-ws` + `#ws-select`, topbar search, command
  palette `#js-palette`, `.view`/`.rail`/`.rail-item` layout), and the per-view rails
  whose rows already carry machine-readable ids (`data-ds`, `data-op`, `data-table`).
- Deep linking is already a working contract: `#design?comp=badge`, `#api?op=issues`,
  `#db?table=issues`; the router lives in `src/99-footer.html` (`route()`, `VIEWS`,
  `[data-nav]` delegate, palette `NAV_ITEMS` + `openPalette`/`buildPalette`). Hash routing
  must be preserved so static hosts and `file://` work, and so mockup links stay valid.
- Data models already exist as inline arrays: API ops with `{id, m, p, n, c, d, params,
  resp, err, table, comp}` (`src/03-api.html` `OPS` + `renderOp()`), DB tables as panes
  `#v-db-pane-<table>` with cross-links (`src/04-db.html`), design stories as panes
  `[data-ds-pane]` with tabs and `*.story`-like content (`src/02-design.html`).
- Interaction patterns to port verbatim: rail keyboard navigation (Arrow/Home/End, in
  `src/99-footer.html`), `/` opens palette, active-rail autoscroll, copy buttons
  (`data-copy`), theme/accent via URL query + localStorage.

Reference architectures confirmed via web research: Storybook splits a **manager** (UI
shell) from a **preview** build rendered in an iframe (the Canvas), configures via a
checked-in `main.ts`, and statically builds per project; Sanity and Keystone configure
their tools via checked-in `*.config.ts` files, including workspace definitions.

## 3. Requirements

1. `berrybench init` scaffolds a project; `berrybench dev` serves it with HMR; `berrybench build`
   emits a static `dist/` that runs from any static host (hash routing, no rewrites).
2. Workspaces are registered as plugins (`design`, `api`, `db`). Each has a default
   enabled state, a data-source detector, a loader, and routes/UI.
3. A project's workspace set is decided by **config file + auto-detection + admin UI**,
   in that precedence (UI writes persist to the config file).
4. The admin UI (workspace toggles + accent/theme) lives at `#/settings` in dev and
   writes `berrybench.config.ts`; saved changes hot-apply without restarting the dev server
   and are reflected in the next `berrybench build`.
5. Disabled workspaces are excluded from the build (no dead code, no UI, no snapshots)
   **and** from the runtime (router redirects deep links to the first enabled one).
6. Cross-workspace links (design↔api↔db) render only between enabled workspaces.
7. The Design workspace renders LIVE component previews in a sandboxed iframe with a
   props-controls panel, isolated from the shell's DOM/CSS. Docs/Code tabs remain.
8. The API workspace renders from an OpenAPI source; the DB workspace from a Postgres
   introspection source. Both become build-time snapshots (point-in-time docs).
9. Theme tokens, rails, palette, keyboard nav, `/`-search, URL theme/accent deep links,
   and all mockup deep-link ids (`?comp=`/`?op=`/`?table=`) behave as in the prototype.

## 4. Design

### 4.1 Repository layout

```
berry-bench/                         (Deno workspace — `deno.json`)
  packages/
    cli/                      — bin `berrybench` (single binary via `deno compile`)
    core/                     — registry, config, router, shell UI
    snapshot/                 — snapshot JSON schema + loaders
    ws-design/                — Design System workspace plugin
    ws-api/                   — OpenAPI workspace plugin
    ws-db/                    — Postgres workspace plugin
    preview/                  — preview iframe harness + protocol
  templates/                  project scaffolds (svelte + react preview variants)
```

`core` is shell-only (workspace-agnostic chrome). Each workspace is a plugin package
that registers itself with the CLI. `preview` is framework-agnostic: the preview bundle
builds with whichever framework the target project's component library uses (detected
from `package.json`), so the Svelte shell can preview React/Vue/Svelte components alike.
Distribution is **GitHub-only** for now: workspace packages import each other by relative
path (Deno workspaces), and users install the CLI from `github.com/wisp-berry/berry-bench`
via `deno install` or a clone. Svelte, Vite, and driver deps come via `npm:` through
Deno's npm compatibility.

### 4.2 Config system

Single file, checked in per project. The default export is a **plain object**, evaluated
in-process by the CLI — the config never imports from a registry, so a GitHub-only install
works with zero setup. The optional `defineConfig` type helper ships inside the CLI binary
for editor type-checking:

```ts
// berrybench.config.ts
export default {
  workspaces: {
    design: { enabled: true,  source: { package: '@wisp-berry/ui', stories: 'src/**/*.story' } },
    api:    { enabled: true,  source: { openapi: 'openapi.yaml' } },
    db:     { enabled: false, source: { connectionString: Deno.env.get('BERRYBENCH_DATABASE_URL') } },
  },
  theme: { accent: 'violet', defaultTheme: 'light' },
};
```

Schema (zod, in `core/config.ts`):

```ts
const WorkspaceConfig = z.object({
  enabled: z.boolean().optional(),            // absent → auto-detect decides
  enabledBy: z.enum(['config', 'ui', 'auto']).optional(), // who last decided (informational)
  source: z.record(z.string(), z.unknown()).optional(),   // opaque per-plugin
});
const BerryBenchConfig = z.object({
  workspaces: z.record(WorkspaceId, WorkspaceConfig).optional(),
  theme: z.object({ accent: AccentId, defaultTheme: z.enum(['light', 'dark']) }).optional(),
}).passthrough();                             // unknown keys preserved on rewrite
```

Resolution order (highest wins): **config file** > **admin UI writes** (persisted to the
same file) > **auto-detection** (plugin `detect()`) > **defaults** (plugin
`defaultEnabled`). UI writes are just config-file writes; `enabledBy` records provenance
so future auto-detection never overrides an explicit admin choice.

`berrybench config --print` prints the fully resolved config (all sources merged) for
debugging; CI can assert `BERRYBENCH_WORKSPACES=design,api` via `resolveConfig()` override.

**Admin UI → file.** `#/settings` (dev only; built sites have no writable FS) renders
toggles from `resolveConfig()`; Save serializes the whole managed subset back to
`berrybench.config.ts` (deterministic, sorted, single writer, header comment
`// Managed by BerryBench settings. Hand-edits in the managed subset are preserved until the
// next Save; unknown top-level keys are preserved.`). The writer only writes keys the
UI can produce; anything outside the zod schema (custom user code) is preserved verbatim
by regenerating the file from the parsed object with `enabledBy:'ui'` provenance.
Config changes trigger `resolveConfig()` re-run + invalidate affected snapshots + HMR.

### 4.3 Workspace plugin contract

```ts
// core/workspace.ts
export type WorkspaceId = 'design' | 'api' | 'db';

export interface WorkspacePlugin<S = unknown> {
  id: WorkspaceId;
  label: string;                 // 'Design System' | 'API Explorer' | 'Database'
  icon: string;                  // symbol id, e.g. 'i-cube'
  defaultEnabled: boolean;
  requiredDeps: readonly string[];       // e.g. ['@wisp-berry/ui'] | ['openapi.yaml'] | ['pg']
  detect(ctx: ProjectContext): Promise<boolean>;   // source present?
  load(ctx: ProjectContext): Promise<S>;           // → snapshot data
  watch(ctx: ProjectContext): AsyncIterable<void>; // optional: source change stream
  routes: WorkspaceRoute[];      // rail groups + panes, see §4.5
  preview?: PreviewSpec;         // design only, §4.6
}
```

CLI lifecycle (`cli/src/dev.ts`, mirrored by `build.ts`):

1. `resolveConfig()` (merge defaults ← detect ← file ← overrides; validates ≥1 enabled).
2. For each enabled plugin: `load()` in parallel → typed JSON to `.berrybench/snapshots/<id>.json`.
3. Register virtual modules `virtual:berrybench-snapshots/<id>` + `virtual:berrybench-config` in
   the Vite config; enable `watch()` re-loads with HMR invalidation (`Deno.watchFs` on the
   declared `source` paths; config file changes re-run steps 1–2).
4. Dev: single Vite server (shell + enabled plugin components + preview bundle).
   Build: emit `dist/` with enabled plugins only (tree-shaken) + `dist/preview/`.

Disabled plugins are never imported by the build → per-repo size = active workspaces only.

### 4.4 Routing (core `router.ts`)

Hash router, format `#/<workspace>?<key>=<id>` — identical semantics to the mockup,
with workspace validation:

```ts
parseHash(): { ws: WorkspaceId, key?: string, id?: string } | null
resolve(route): string   // null/unknown ws or disabled ws → '#/' + firstEnabledWorkspace()
```

- `#/settings` — admin UI (dev). In built output it 404s to the first workspace.
- Deep-link ids (`?comp=`/`?op=`/`?table=`) are validated against the live snapshot; an
  unknown id resolves to the workspace home (mockup behavior was "stale content" — fixed
  here by validating against the snapshot, never rendering stale panes).
- Keyboard/palette/rail behaviors from the mockup (`src/99-footer.html`) port 1:1; the
  palette's "Navigate" section lists only enabled workspaces.

### 4.5 Shell + workspace UI

Svelte 5 components in `core/shell/`:

- `App.svelte` — topbar (workspace dropdown `WorkspaceSelect`, search, theme+accent
  from config/localStorage), `Palette.svelte`, `keyboard.ts` (arrows, `/`, Esc, copy).
- The topbar dropdown is DATA-DRIVEN from `resolveConfig()` — the mockup's static
  `#ws-select` options become `{workspaces.map(enabled → option)}` (this is the visible
  enable/disable story: toggle off in settings, option disappears from the dropdown).
- Per workspace, `routes: WorkspaceRoute[]` describes its rail and panes, mirroring the
  existing fragment structure:

```ts
type WorkspaceRoute =
  | { kind: 'group'; label?: string }
  | { kind: 'item'; id: string;                    // comp/op/table id (deep-link key)
      label: string; icon?: string; badge?: string; // e.g. method chip 'GET'
      pane: { title: string; render: (data: SnapshotData) => string } }; // SSR-able HTML
```

Each workspace ships ONE `Rail.svelte` + pane renderers; `core` provides shared
components (Panel, Table, CodeBlock, Badge, Tabs) that reproduce the mockup's visual
spec (tokens from `src/00-shell.html`; styles moved to `core/styles/tokens.css`).

Cross-workspace links: snapshots carry the existing `table`/`comp`/op ref ids
(`src/03-api.html` `OPS[].table/comp`, `src/04-db.html` pane cross-links). The shell
renders a cross-link only when its target workspace is enabled and the referenced id
exists in that snapshot (guards replace the mockup's unguarded `#api?op=` hrefs).

### 4.6 Live preview (Design workspace) — the Canvas

Storybook-style manager/preview split, scaled down:

- Preview spec (`ws-design/plugin.ts`):

```ts
interface PreviewSpec {
  entry: string;             // '<rootDir>/preview/src/main.ts' (generated prompt)
  framework?: 'svelte' | 'react' | 'vue';  // auto-detected from package.json
  basePath: string;          // '/preview' in dev, relative './preview/' in dist
}
```

- The preview bundle is a second Vite multi-config build. In dev it serves at
  `/preview/`; `berrybench build` emits `dist/preview/index.html` + assets. The shell embeds
  `<iframe src="/preview/index.html?story=<id>" sandbox="allow-scripts" />` (isolated
  DOM + styles; only the shell's `data-copy`/theme channels cross the boundary).
- Component source convention (scaffolded by `berrybench init`, documented per framework):

```ts
// src/components/badge.story.svelte   (react: badge.story.tsx)
import Badge from './badge.svelte';
export default Badge;
export const meta = {
  title: 'Badge',
  description: 'Status pills rendered from semantic tokens.',
  props: { variant: 'success', label: 'Label' },   // default render props
  schema: {                                          // drives the controls panel
    variant: { type: 'enum', options: ['neutral','success','warning','danger'] },
    label:   { type: 'string' },
  },
  code: `<Badge variant="success">Label</Badge>`,
};
export const scenarios = [ { name: 'Empty', props: { label: '' } } ];
```

- Protocol (`preview/protocol.ts`) over `postMessage`:

```ts
type PreviewMessage =
  | { type: 'ready' }                       // iframe → shell (bundle loaded)
  | { type: 'error'; message: string }      // iframe → shell (render/import failure)
  | { type: 'setProps'; props: Record<string, unknown> }  // shell → iframe (controls)
  | { type: 'setStory'; storyId: string };  // shell → iframe (deep link / rail select)
```

- The controls panel in the shell is generated from `meta.schema` (enum → select,
  string → input, number → stepper) and sends `setProps`; the iframe re-renders its
  story. `meta.code` feeds the Code tab (verbatim mockup `<pre>` mockup style).
- If the component library is React/Vue, the preview bundle uses the corresponding
  Vite plugin — the shell and protocol stay identical (this is why the shell language
  does not constrain the component library's language).

### 4.7 Workspace data sources (build-time snapshots)

- **ws-design**: scans `source.stories` glob + reads `package.json` for the library
  package; `load()` walks story files' `meta` exports (title, props, schema, code,
  scenarios) + tokens via the library's exported token object → `design.snapshot.json`
  (`{ stories: StoryMeta[], tokens: TokenRecord }`).
- **ws-api**: parses `openapi.yaml` (`@std/yaml` + a small OAS3 walker) into the existing
  `OPS` shape (`src/03-api.html`): op id, method, path, description, params, resp codes,
  error envelope, plus `x-berrybench` extensions for `table`/`comp` cross-links.
- **ws-db**: `npm:pg` introspection at load time (Deno node-compat — identical driver
  API; `deno-postgres` is the native drop-in) (connection string from
  `source.connectionString` or env) → tables/columns/PK/FK/indexes/sample rows — the
  mockup's 8-table model generalized (the ERD view was cut from the mockup; an optional
  SVG ERD can regenerate from the same snapshot FK edges later).

DB snapshot freshness is point-in-time at `berrybench dev`/`build` (docs tool, not live
ops). `watch()` re-loads on source change; a future `--live` mode can poll/WS without
schema changes.

### 4.8 Admin/settings UI

`#/settings` (dev only): workspace cards (toggle, source summary, detect result,
missing-source warning badge), theme (accent dots + default theme), and "Open
berrybench.config.ts" (reveals the file). Save → `writeConfig()` (§4.2) → dev server
re-resolves config, drops/restores workspace routes and snapshots, HMR. Built `dist/`
has no settings route (no writable FS); config is compiled in.

## 5. Edge cases

| Case | Behavior |
|---|---|
| All workspaces disabled (or none detected at build) | Hard error at `berrybench dev/build`: "enable at least one workspace" with a fix command (`berrybench config --enable design`). Runtime fallback route shows the same message if config becomes invalid mid-session. |
| Enabled in config but source missing (e.g. `openapi.yaml` absent) | Dev: workspace hidden from dropdown, `#/settings` badge "missing source", warning line on boot. Build: excluded with one summary warning (never fails the build; Storybook's missing-stories behavior). |
| DB unreachable at load time | Snapshot written with `{ error: string }`; DB workspace renders an error panel with the message; build proceeds. `requiredDeps` present but load fails is a warning, not a failure (except `berrybench build --strict`). |
| Deep link to disabled/unknown workspace | Redirect `#/<first-enabled>` (§4.4). Deep link to unknown `?key=` id → workspace home (validated against snapshot). |
| Cross-link to disabled workspace | Link not rendered (§4.5 guards). |
| UI Save over a hand-edited config with custom code | The managed subset is regenerated; unknown top-level keys and non-managed content are preserved (zod passthrough) — with a build-time warning listing what the UI cannot represent. |
| Config file deleted | `berrybench dev` regenerates from auto-detection and explains; `berrybench init` re-creates the file. |
| Component library not Svelte | Preview builds with detected framework (`svelte|react|vue`) — shell/protocol unchanged (§4.6). |
| Preview iframe errors (missing story, import failure) | iframe posts `{type:'error'}`; shell shows an inline error panel with the message, story rail stays navigable. |
| Theme/accent mismatch with config | `localStorage` overrides config at runtime (per-user preference wins); config sets only the defaults. |

## 6. Verification

1. **Fixture repo A** (design+api): `openapi.yaml` + `@wisp-berry/ui` dep, no DATABASE_URL.
   `berrybench init` → generated config has `design:on (auto) api:on (auto) db:off (default)`.
   `berrybench dev` → dropdown shows Design System + API Explorer only; `#/db` redirects to
   `#/design`; `#/api?op=issues` renders the issues op; cross-link cards show only
   design↔api pairs.
2. **Settings flow**: `#/settings` → disable API → Save → `berrybench.config.ts` now has
   `api: { enabled: false, enabledBy: 'ui' }`; dev server hot-applies: dropdown loses
   API Explorer, `#/api` redirects, API snapshots are dropped (openapi.yaml changes do
   not re-trigger loads).
3. **Fixture repo B** (design only): `berrybench build` → `dist/` contains design routes +
   preview bundle, no `api`/`db` chunks (grep dist for a known API op id → absent;
   bundle size assertion: core+design only).
4. **Preview**: `berrybench dev` in repo A → `#/design?comp=badge` shows `Badge` story in
   iframe; changing the Variant control re-renders the iframe (postMessage round-trip
   observed); Code tab shows the `meta.code` snippet; `sandbox="allow-scripts"` present.
5. **Deep-link compatibility**: every id list from the mockup (`?comp=`, `?op=`,
   `?table=`) resolves in the real app with the same hash format.
6. **Regression harness**: port the mockup's smoke checks (`smoke.js`: palette, `/`, rail
   arrows, theme/accent URL params, copy buttons, keyboard nav) to a Playwright spec run
   against `berrybench build` output on a static server.
7. **Deno distribution**: from a clone of `wisp-berry/berry-bench`,
   `deno compile --output berrybench` produces a working single
   binary (`berrybench config --print` on fixture repo A succeeds with no runtime
   installed); `deno task dev` starts the same server as `berrybench dev`.

## 7. Assumptions

### Override me

1. **Component library language is unconstrained** — the Svelte shell previews whatever
   the library is built in (React/Vue/Svelte) via the isolated preview bundle (§4.6). If
   you'd rather the shell itself be React (closer to Storybook's own stack), that's a
   core-level swap; the protocol/snapshot contracts don't change.
2. **Data is docs-fresh, not live** — DB/API snapshots are point-in-time at dev/build
   (§4.7). If database/API browsing must be live (runtime server, auth, read replicas),
   the plugin `load()`/`watch()` seam is the extension point, but scope grows by a server.
3. **Settings are admin/dev-only, persisted to the checked-in config file** (§4.2/§4.8),
   shipped sites are static snapshots of that config. If a hosted multi-project instance
   with per-user settings is the real target, replace the file-writer with a server; the
   config schema and workspace registry stay.

### Defaults (implementation-level, chosen silently)

- Svelte 5 runes; Vite (current, Deno-supported); Deno 2 workspaces (`deno.json` +
  `deno task`); zod via `npm:`; `@std/yaml` for OpenAPI; `Deno.watchFs` for watch;
  `npm:pg` for DB introspection (node-compat, `deno-postgres` is the native swap-in);
  CLI ships as a `deno compile` single binary, installed from GitHub only (no registry
  publishing yet); hash router (no server
  rewrites); `.berrybench/` cache dir for
  snapshots (gitignored); `virtual:berrybench-*` modules for HMR data; numbered deep-link ids
  preserved from the mockup; tokens/theming CSS ported verbatim.