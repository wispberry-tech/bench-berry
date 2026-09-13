# Changelog

## 0.1.2 — 2026-09-13

Feral-audit remediation (11 proven bugs + 6 risky findings):

- Config round-trip fidelity: unknown top-level keys in `berrybench.config.ts` survive any write-back, and ui-managed toggles re-emit `enabledBy: 'ui'` so provenance survives re-resolution. The write-back endpoint rejects an all-disabled delta (HTTP 400, same message as the CLI) without touching the file, and caps request bodies at 1 MiB (413).
- Story meta extraction anchors on the `meta` literal: body `title:`/`props:` can no longer hijack the fields, and `subtitle:`/`scenarios2`-style keys no longer match; `scenarios` stays a whole-file scan (it is a sibling const, never a meta member). All key regexes gained leading-boundary + quote-backreference hardening; the audit repro (hijacked title + empty meta.props) now extracts correctly.
- Design cross-link chips deep-link by matched story `file` (the design id-space), not the raw comp name — the chip now actually opens the story.
- Preview lifecycle: renders are sequenced (last-continuation-wins; a slow story can no longer overwrite a fast one), `ready` posts after every commit so the shell's error banner clears after a fix, and error cleanup unmounts the active framework instance instead of wiping React's committed DOM or leaking svelte/vue instances.
- Dev servers use strict ports; an occupied port exits 1 with `port <p> is in use — set BERRYBENCH_PORT` / `BERRYBENCH_PREVIEW_PORT` instead of silently binding elsewhere. The preview vite root is overridable (`BERRYBENCH_SHELL_DIR` sibling) so `dev`/`build` work from the compiled binary.
- Static preview build inlines the bundle into `dist/preview/index.html` (eager story glob + single-chunk output + inline step): the opaque-origin sandboxed frame boots on any stock static host with no cross-origin fetches.
- CLI ordering: `dev`/`build` probe the shell dir before writing any `.berrybench/` artifacts, so a failing command leaves no side effects.
- API op ids are deduplicated (`-2`, `-3`, … suffixes) so colliding slugs can't break shell routing.
- DB introspection excludes `pg_toast` (Supabase-style duplicate table names).
- Dev watch loop ignores `node_modules`/`.git`/`dist` noise, keeps per-batch failures as warnings, and exits 1 when the watcher itself dies.
- Workspace ids have a single source of truth (`core/workspace.ts` `WORKSPACE_IDS`); the registry, config schema, snapshot writer, and vite plugin all derive from it.
- README corrected: `scenarios` are parsed and typed but not yet rendered as UI.
- CLI loads the project root's `.env` at startup (real env vars win), so `BERRYBENCH_DATABASE_URL` and friends work from `.env` without exporting.

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