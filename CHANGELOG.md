# Changelog

## 0.1.1 — 2026-09-12

- Story default location: `berrybench init` scaffolds the story pair into `src/stories/` (the DEFAULT stories root) instead of `src/components/`. Colocated stories beside components anywhere under `src/` remain fully supported — discovery is a single `src/**/*.story.{svelte,tsx}` glob covering both.

## 0.1.0 — 2026-09-12

Initial release.

### Phase 1 — snapshot pipeline

- Plugin contract (`core/workspace.ts`) and fixed registry of the `design` / `api` / `db` workspaces.
- Zod-validated snapshots written to `.berrybench/snapshots/<id>.json`; failed loads degrade to an `{ error }` state instead of crashing (unreachable database, missing spec file).

### Phase 2 — config writer

- Deterministic `berrybench.config.ts` generation; the CLI merges back hand edits instead of overwriting them.
- Enablement resolves by precedence: plugin defaults → auto-detection → config file → `BERRYBENCH_WORKSPACES` env override.

### Phase 3 — CLI

- Commands: `init`, `config --print [--json]`, `config enable|disable`, `detect`, `snapshot [--strict]`, `dev`, `build`, plus `--version` and `--help`.
- Writes `.berrybench/resolved-config.json` (dev) and `.berrybench/manifest.json` (build).

### Phase 4 — shell, preview, write-back

- Vite virtual modules: `virtual:berrybench-config`, `virtual:berrybench-snapshots` (aggregate, one key per enabled workspace), `virtual:berrybench-snapshots/<id>`, `virtual:berrybench-env`; missing input degrades to safe modules (warnings, never build errors).
- Svelte 5 shell: workspace views, command palette, keyboard navigation, themes.
- Settings write-back: the shell POSTs a validated delta to `/__berrybench/config`; the plugin merges it and rewrites the config file, stamping ui-managed toggles.
- Preview canvas: sandboxed iframe app bundling all three runtimes, driven by a `postMessage` protocol (`setStory` / `setProps` out, `ready` / `error` back).
- Story meta extraction from `*.story.svelte` / `*.story.tsx`: unquoted `title` anchor, JSON-parseable `meta` (props, schema, description, code), and `scenarios` overrides.

### Phase 5 — closure

- Static build: `berrybench build` emits the shell to `dist/` and the preview canvas to `dist/preview/` (html-relative assets).
- Cross-links: `x-berrybench: { table?, comp? }` OpenAPI op annotations surface as guarded chips (enabled target workspace + existing id in its snapshot).
- Single binary: `deno compile -A`; `init` / `config` / `detect` / `snapshot` run standalone; `dev` / `build` require `BERRYBENCH_SHELL_DIR` pointing at a checkout.
- README and this changelog.