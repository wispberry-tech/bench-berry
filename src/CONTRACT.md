# Prism — mockup build contract (read this first)

You are building ONE view fragment for **Prism**, a single-page HTML mockup of a developer "swiss army knife" tool that combines:
1. a **design system documentation** browser (Storybook-like),
2. an **OpenAPI client / API explorer** (like a hosted API console),
3. a **database schema viewer** (columns, indexes, ERD).

Design language: **Linear-style chrome** (icon rail + sidebar + topbar, dense, neutral, hairline borders, low-chroma) with **ReUI/shadcn-style components** (indigo-violet accent, soft radii, clean tables). Light + dark themes. Everything must look like a real, shipping product — realistic data, tight density, tasteful restraint. No gradients everywhere, no emoji, no lorem ipsum.

## Files
- `src/00-shell.html` — shared tokens, ALL base component CSS, icon rail, sidebar, topbar, command palette. **Read it first. Do NOT edit it.**
- `src/99-footer.html` — shared JS (router, theme, accent, env, palette, copy). **Do NOT edit it.**
- `src/CONTRACT.md` — this file.
- **YOUR file**: one of the following, which you CREATE from scratch:
  - `src/01-overview.html` → section `id="view-overview"` (Overview view)
  - `src/02-design.html` → section `id="view-design"` (Design System view)
  - `src/03-api.html` → section `id="view-api"` (API Explorer view)
  - `src/04-db.html` → section `id="view-db"` (Database view)

The final `index.html` is produced by concatenating `src/00-shell.html` + `src/01-overview.html` + `src/02-design.html` + `src/03-api.html` + `src/04-db.html` + `src/99-footer.html` in that order. Your fragment is a **complete `<section>` element** (plus optional `<style>` block at its top and optional `<script>` block at its end, both inside the section or right before/after it — keep them adjacent to your section). It must be valid standalone HTML that renders correctly when concatenated.

## View structure (mandatory)
Your section: `<section class="view" id="view-overview" data-view="overview"> … </section>` (id/data-view per your view).
Inside: standard view scaffold:

```html
<section class="view" id="view-design" data-view="design">
  <div class="view-body">
    <aside class="rail"> …rail items… </aside>
    <div class="view-content">
      <div class="view-head">
        <div>
          <div class="vh-title">Design System</div>
          <div class="vh-sub">…one-line description…</div>
        </div>
        <div class="vh-actions">…buttons/chips…</div>
      </div>
      …view body…
    </div>
  </div>
</section>
```

## Hard rules
1. **Class names**: use ONLY shell-provided classes (list below) plus your own prefixed with your view prefix (`v-ov-`, `v-ds-`, `v-api-`, `v-db-`). NEVER redefine a shell class; NEVER use `!important`; NEVER add `position:fixed` overlays (the shell owns popovers/dialogs styling — but you MAY render `.dialog-backdrop` demos inside your view).
2. **Do NOT include `<html>`, `<head>`, `<body>` tags, `<style>` for shell classes, external fonts, CDNs, or images.** All icons via `<svg class="icon"><use href="#i-…"/></svg>` (full symbol list in shell; common ones: i-search i-code i-cube i-plug i-db i-layers i-send i-copy i-check i-plus i-x i-refresh i-filter i-key i-link i-arrow-right i-pencil i-trash i-clock i-users i-star i-spark i-home i-doc i-settings i-warn i-info i-external i-table i-schema i-branch i-comment i-list i-dot-grid i-chevron-down i-chevron-right i-command i-gauge). You may also inline raw `<svg>` for charts/ERD.
3. **IDs must be unique** across the whole page: prefix them `v-ds-comp-button` etc.
4. **Scripts**: allowed, but wrap in `if (document.getElementById('view-…')) { … }` and only attach listeners to elements inside your view. You MAY read the hash deep-link: `new URLSearchParams((location.hash.split('?')[1] || '')).get('comp')` / `get('op')` / `get('table')` and pre-select that item on load.
5. **Theme-aware**: use only CSS variables (`var(--text)`, `var(--surface)`, …). Test mentally in dark mode: never hardcode grays.
6. **Referencing other views**: display a small cross-reference card linking to other views (e.g. API view shows "DB table: issues", DB view shows "API: GET /issues"). Use `<button class="btn …" data-nav="api">` or `<a href="#api">` — the router handles it.
7. **Tone**: realistic, professional, dense but breathable. Every listed sidebar item must have a real rendered detail view — no "coming soon"/empty stubs. Numbers should be plausible and consistent with the shared data model below.
8. No build tools, no frameworks, vanilla HTML/CSS/JS only.

## Shared data model (single source of truth — all views must agree)

Product: **Helix** — an issue-tracking SaaS. API base `https://api.helix.dev/v1`. Postgres DB `helix_postgres`.

Tables (8):
| table | purpose | row count |
|---|---|---|
| users | people | 1,284 |
| teams | workspaces | 36 |
| memberships | user↔team links | 2,410 |
| projects | work containers | 142 |
| issues | tracked work | 38,954 |
| comments | discussion on issues | 102,312 |
| labels | issue tags | 18 |
| api_keys | machine auth | 47 |

Key columns (use these exact names in DB + API views):
- `users`: id (pk, uuid), email (unique), name (text), avatar_url (text), role (enum: admin|editor|viewer), created_at (timestamptz)
- `teams`: id (pk, uuid), slug (unique), name (text), created_at
- `memberships`: id (pk), user_id (fk→users), team_id (fk→teams), role (enum), joined_at
- `projects`: id (pk), slug (unique), name, team_id (fk→teams), status (enum: active|archived|on_hold), color (text), created_at
- `issues`: id (pk, uuid), title (text), description (text), status (enum: backlog|todo|in_progress|in_review|done), priority (enum: urgent|high|medium|low|none), project_id (fk→projects), assignee_id (fk→users, null), labels (text[]), due_at (timestamptz, null), created_at, updated_at
- `comments`: id (pk), body (text), issue_id (fk→issues), author_id (fk→users), created_at
- `labels`: id (pk), name (unique), color (text)

API surface (23 endpoints; explorer lists all, at least these must appear with full param + response data):
- `GET /issues` · `POST /issues` · `GET /issues/{id}` · `PATCH /issues/{id}` · `DELETE /issues/{id}` · `POST /issues/{id}/comments`
- `GET /users` · `GET /users/{id}` · `PATCH /users/{id}`
- `GET /teams` · `GET /teams/{slug}` · `GET /teams/{slug}/projects`
- `GET /comments` · `GET /comments/{id}` · `DELETE /comments/{id}`
- `GET /labels` · `POST /labels` · `PATCH /labels/{id}` · `DELETE /labels/{id}`
- `GET /projects` · `GET /projects/{id}` · `PATCH /projects/{id}` · `POST /projects/{id}/archive`

Sample issue JSON (share shapes between API responses and DB row previews):
```json
{
  "id": "iss_9f2c1a",
  "title": "Redesign empty state for issue list",
  "status": "in_progress",
  "priority": "high",
  "project_id": "prj_42",
  "assignee_id": "usr_1173",
  "labels": ["ui", "p0"],
  "created_at": "2026-09-02T09:41:00Z",
  "updated_at": "2026-09-11T16:03:00Z"
}
```
Status → badge colors (use in ALL views): backlog=neutral, todo=info, in_progress=accent, in_review=warning, done=success.
Priority colors: urgent=danger, high=warning, medium=info, low=neutral, none=neutral.

Representative users: "Aiko Tanaka" (aiko@helix.dev), "Marcus Webb" (marcus@helix.dev), "Priya Nair" (priya@helix.dev), "Theo Meyer" (theo@helix.dev). Avatar colors: distinct pastel gradients.

## Shell class inventory (abridged — read the shell CSS for full details)
Layout: `.app .iconrail .sidebar .main .topbar .content .view .view.active .view-body .rail .rail-head .rail-title .rail-sub .rail-search .rail-group .rail-item .rail-item.active .rail-count .view-content .view-head .vh-title .vh-sub .vh-actions`
Buttons: `.btn` + `.btn-primary .btn-soft .btn-ghost .btn-outline .btn-danger .btn-danger-soft .btn-success-soft .btn-sm .btn-lg .btn-icon` (`.btn-icon` for icon-only, `.btn-sm` smaller). Icons inside buttons: `<svg class="icon"><use href="#i-x"/></svg>`.
Badges: `.badge .badge-success .badge-warning .badge-danger .badge-info .badge-neutral .badge-accent .badge-outline`; dots `.dot .dot-success .dot-warning .dot-danger .dot-info .dot-neutral .dot-accent`.
Forms: `.field .field-label .field-hint .field-error .input .select textarea.input .checkbox .radio .switch(.on)`.
Panels: `.panel .panel-head .panel-title .panel-sub .panel-body .card .card-pad .card.clickable .card.hoverable`.
Tables: `.table-wrap table.tbl .tbl th/td .mono .num .muted .strong`.
Code: `.code-block .code-head .code-body` with `.tok-k .tok-s .tok-c .tok-n .tok-f .tok-p` token colors (hand-<span> the syntax highlight — do NOT write a highlighter).
Tabs/segments: `.tabs .tab .tab.active .seg .seg button.active`.
Avatars: `.avatar .avatar-sm .avatar-lg .avatar-stack` (set inline `background:` per user).
Misc: `.divider .divider-v .spacer .hint .skeleton .progress(.ok/.warn) .empty .tooltip-demo .tip .kbd .mono .muted .strong .pulse .menu-item .menu-label .menu-sep .popover .dialog-backdrop .dialog .dialog-head .dialog-title .dialog-sub .dialog-body .dialog-foot`

## Per-view specs

### 01-overview.html — Overview (`#view-overview`)
Dashboard landing. Content:
- View head: "Overview" + sub "Everything you need to ship Helix — components, API, and schema in one tool." Actions: "Add source" (soft), "Sync all" (primary with i-refresh).
- 4 stat cards (`.card.card-pad`, hoverable): Components **142** · subs: "3 changed this week"; Endpoints **23** · "v3.1 · 2 new"; Tables **8** · "38.9k issues"; Sources **3** · "2 synced, 1 drift". Each with icon + small inline-SVG sparkline (raw `<svg>`, 2 colors: line accent + area fill using `var(--accent)` with opacity).
- "Sources" section: 3 cards (`.card.clickable` with `data-nav` jumping to design/api/db): **@helix/ui** (design tokens + 142 components, status dot ok, "synced 2m ago", button "Open →" to design view); **openapi.yaml** (v3.1 · 23 endpoints, ok, "synced 5m ago"); **helix_postgres** (Postgres 16 · 8 tables · 2.3M rows, **amber drift warning** — "column `labels` type changed" with a "View" button to db view).
- "Recent activity" (`.table-wrap`-like but panel list): rows icon + text + relative time: "Schema drift detected — `issues.labels` now `text[]`" (warn); "Pushed 4 commits to `@helix/ui`" ; "Generated Go client from `openapi.yaml`"; "Published components **v2.4.0**"; "Added endpoint `PATCH /labels/{id}`". Each row: small icon, mono bits, muted relative time (3m/12m/2h/1d ago).
- Optional small "Quick actions" row of ghost buttons: New component, Explore API, Inspect table.
Keep it compact — no big charts, this is a landing page.

### 02-design.html — Design System (`#view-design`)
Structure: `.rail` with groups **Foundations** (Colors, Typography, Spacing, Radii, Elevation, Icons) and **Components** (Button, Badge, Avatar, Card, Input, Select, Tabs, Switch, Dialog, Toast, Tooltip, Table, Skeleton, EmptyState). Rail head: "@helix/ui" + "v2.4.0" chip; rail search box (filter rail items by typing — small script).
Content pane shows ONE selected item at a time (default "Button"; support deep-link `?comp=button`).
- Foundations: render real token specs:
  - **Colors**: swatch grids (name, hex, usage) for neutral scale (bg/surface/surface-2/text/text-2/text-3/border/…), accent scale (50→700), semantic (success/warning/danger/info with their bg/border). Also "Status colors" row mapping the 5 issue statuses with badges. Accent note: "Switch accent in the top bar — tokens update live."
  - **Typography**: type ramp 11/12/13/15/18/22/28px with weight + use (Caption/Secondary/Body/Body Large/Heading H3/H2/H1 samples shown in `var(--text)`).
  - **Spacing**: 2/4/8/12/16/24/32/48 bars. **Radii**: s/m/l/full samples. **Elevation**: three shadow swatches. **Icons**: grid of ~24 icon symbols (use `<use href="#i-…">`).
- Components: each has (a) **Preview panel** — live rendered demo(s) using shell classes, where feasible interactive (tabs switch, switch toggles, dialog opens via your script, toast appears, button shows loading state); (b) **Props table** (`.table-wrap table.tbl`: prop, type, default, description — realistic props like `variant: 'primary' | 'soft' | 'ghost' | 'outline'`); (c) **Usage snippet** (`.code-block` with hand-highlighted spans, e.g. `<Button variant="primary" size="md" loading />`). For **Badge**, include the status-mapping story (badge-success→done etc.) and note "Used by: IssueCard · API view".
- Tabs within a component: Preview / Code / Props (`.tabs` + panels toggled by a small script). Keep 3–4 components fully fleshed (Button, Badge, Dialog, Tabs showed first-class interactivity); the rest can be slightly lighter but MUST still have preview + props + code.

### 03-api.html — API Explorer (`#view-api`)
Structure: `.rail` grouped by resource — **Issues** (GET /issues, POST /issues, GET /issues/{id}, PATCH /issues/{id}, DELETE /issues/{id}, POST /issues/{id}/comments), **Users** (GET /users, GET /users/{id}, PATCH /users/{id}), **Teams** (GET /teams, GET /teams/{slug}, GET /teams/{slug}/projects), **Projects** (GET /projects, GET /projects/{id}, PATCH /projects/{id}, POST /projects/{id}/archive), **Comments** (GET /comments, GET /comments/{id}, DELETE /comments/{id}), **Labels** (GET /labels, POST /labels, PATCH /labels/{id}, DELETE /labels/{id}) — 23 items total, each `.rail-item` with a tiny method chip (GET blue/info, POST green/success, PATCH amber/warning, DELETE red/danger) + mono path suffix + rail count for "200 OK" etc. Rail head: "openapi.yaml" + "v3.1.0" chip; search box filters endpoints.
Content pane (one endpoint at a time, default `GET /issues`, deep-link `?op=issues`):
- Endpoint header: method chip (`.badge`), mono path, short description; actions: "Try it" (primary, i-send), Copy URL (ghost, `data-copy`), "Export snippet" (ghost).
- **Try-it console** (`.panel`): base URL `https://api.helix.dev/v1` + path (mono), auth line "Authorization: Bearer ●●●●●●" (or per endpoint), optional params inputs (only for list endpoints: `status`, `project`, `assignee` selects; `limit` number) — Send button: onClick simulate latency (setTimeout 400–900ms, button shows spinner + "Sending…"), then render response panel: status line ("200 OK · 385ms" colored dot), pretty JSON in `.code-body` using tok spans. Use `POST /issues/{id}/comments` returning 201, DELETE returning 204 (empty body + "204 No Content"), invalid path 404 example for one endpoint. Keep one script handling all endpoints with a response table keyed by op id.
- Below: two-column region: **Params** (.table-wrap: name, in, type, required, description — include query params for lists: cursor, limit, status, assignee_id, project_id, labels; path params {id} etc.; body params for POST/PATCH with request JSON in a `.code-block`) and **Responses** (rows: 200 definition → code-block JSON sample; make the issue JSON match the shared model; include realistic fields + a `_request_id` header note).
- Endpoint cards must show realistic error/schema info, e.g. "Rate limit: 500 req/min · token auth".
- Cross-ref card at bottom of detail: "Backed by table `issues`" with link to db view; "Rendered by `IssueCard`" link to design view.

### 04-db.html — Database (`#view-db`)
Structure: `.rail` with **Tables** group (8 tables, each item: table icon + name mono + `.rail-count` row count, formatted 1.2k/2.4k/38.9k/102.3k) and **Relations** group: "Schema map" (i-schema). Rail head: "helix_postgres" + "Postgres 16" chip; search filters tables.
Content pane: default `issues` table (deep-link `?table=issues`; `?table=erd` → schema map).
- Table detail (for each of the 8 tables — yes, all 8 must have real data; 4 light ones (teams, projects, comments, labels) can be a bit leaner but still complete):
  - Table header: mono table name, badge (e.g. "38,954 rows" neutral), actions: "Read API docs" (data-nav api), "Copy CREATE TABLE" (data-copy).
  - **Columns** `.table-wrap`: name (mono strong, PK/FK badges), type (mono muted), nullable (✓/muted —), default (mono muted or —), description (one-liner). Wrap: table name with hover → hint "Opens issues in API view"? Keep chips: PK badge-accent, FK badge-outline.
  - **Indexes** list (mono rows): `issues_pkey (id)`, `issues_project_idx (project_id)`, `issues_assignee_idx (assignee_id)`, `issues_labels_gin (labels)`, `issues_updated_at_idx (updated_at)` + counts.
  - **Sample row** (`.code-block`): JSON preview of 1–2 rows matching the API sample shape (the cross-view "one source of truth" moment).
  - **API surface** card: chips of endpoints touching this table (GET/POST /issues etc.) with links into the API view.
- Schema map (`.view` second pane or same pane): an inline-SVG ERD (raw `<svg>`, ~900×520 viewBox): 7 table boxes (users, teams, memberships, projects, issues, comments, labels) with title bar + 2–4 key columns, bezier connectors users—memberships—teams, teams—projects—issues, users—issues (assignee), issues—comments, issues—labels (M:N), with crow-foot-ish labels (`1—N`, `N—M`). Hover a table box → its connected lines + partner boxes highlight (CSS `:hover` on `<g>` with opacity transitions). Small legend (PK/FK). Clicking a box selects the table detail (script).

## Quality bar
- Everything renders in light AND dark (variables only), no horizontal overflow at 1440×900, crisp alignment (use the vertical rhythm: 8px grid).
- Typography hierarchy is deliberate; text is realistic and specific (no filler).
- The three views cross-reference each other so the "one tool" story is obvious.
- Total per-view HTML target: 600–1100 lines. Don't pad; don't cut corners on the interactions listed.

## Acceptance
1. `read src/00-shell.html` — confirm class inventory before writing.
2. Write ONLY your fragment file (01/02/03/04). Do not run builds, linters, or tests.
3. Self-check: grep your file for `!important`, unprefixed classes not in the inventory, `<html`, `<head`, `<img`, `http://`, `https://` (should be none — base URL strings in code blocks are fine as text).
4. Report: file path, item count, interactions implemented, any contract deviations.