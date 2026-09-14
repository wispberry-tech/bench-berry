// packages/shell/src/lib/markup.ts
// Pure HTML-string builders for workspace panes. Every interpolated value is
// escaped (esc); the strings are rendered via {@html} in the workspace
// components. Panes carry data-ws/data-id attributes for Phase 4 cross-links.
//
// Class cutover (Tailwind): every class below is a full literal — either
// inline in the map or assembled from fully-literal string parts, so the
// Tailwind v4 scanner sees every utility verbatim in this file. Strings
// cannot render Svelte components, so the badge/button/card/table anatomy is
// replicated as literal utility sets that mirror ui/*.svelte.
import type { ApiSnapshot, DbSnapshot } from "./types.ts";
import { highlightBash, highlightJson } from "./highlight.ts";

/** Escape a value for safe interpolation into HTML text/attribute context. */
function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Last path segment of a file path, used as a fallback story label. */
export function basename(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? file : file.slice(i + 1);
}

// ---------- literal class sets (mirror ui/badge.svelte + ui/table.svelte) ----------

/** Badge base, shared by every variant (mirrors badge.svelte's tv base). */
const BADGE_BASE =
  "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none";

/** Badge variant class sets — full literals, identical to badge.svelte's tv variants. */
const BADGE_VARIANT = {
  default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
  secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
  destructive:
    "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
  outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
  ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
  link: "text-primary underline-offset-4 hover:underline",
  success: "border-success-border bg-success-bg text-success",
  warning: "border-warning-border bg-warning-bg text-warning",
  info: "border-info-border bg-info-bg text-info",
} as const;

/** Badge tones used by the Api method chips. */
export type BadgeTone = keyof typeof BADGE_VARIANT;

/**
 * HTTP verb -> badge tone (the Api.svelte rail uses this as the Badge
 * component's `variant`; markup.ts chips use BADGE_VARIANT[tone]).
 */
const METHOD_TONE: Record<string, BadgeTone> = {
  GET: "success",
  POST: "info",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "destructive",
};

/** Method chip tone; unknown methods fall back to neutral. */
export function methodTone(method: string): BadgeTone {
  return METHOD_TONE[method.toUpperCase()] ?? "secondary";
}

/** Extra classes for mono status/method chips (min-width + mono). */
const CHIP =
  "min-w-[52px] justify-center font-mono text-[10px] tracking-[0.03em]";

/** Table anatomy (mirrors ui/table.svelte): rounded bordered container. */
const TABLE_TH =
  "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0";
const TABLE_TD = "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0";

/** Wrap `headers`/`rows` (pre-escaped cell content) in a Table-shaped block. */
function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th class="${TABLE_TH}">${h}</th>`).join("");
  const body = rows
    .map(
      (cells) =>
        `<tr class="border-b border-border">${cells
          .map((c) => `<td class="${TABLE_TD}">${c}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return (
    `<div class="w-full overflow-hidden rounded-lg border border-border bg-card">` +
    `<table class="w-full border-collapse text-xs">` +
    `<thead class="bg-muted/50"><tr class="border-b border-border">${head}</tr></thead>` +
    `<tbody class="[&_tr:last-child]:border-0">${body}</tbody></table></div>`
  );
}

// ---------- shared chips / buttons ----------

/**
 * Small accent cross-link chip (§5): an anchor deep-linking into another
 * enabled workspace (`#/db?table=…` / `#/design?comp=…`). Icon glyph is one
 * of the shell sprite ids (`i-db`, `i-cube`, …); the router resolves unknown
 * deep-link ids to the target workspace home.
 */
export function crossLinkChip(label: string, href: string, icon = "i-plug"): string {
  return (
    `<a class="${BADGE_BASE} border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:no-underline [&_svg]:size-[11px]" ` +
    `href="${esc(href)}"><svg ><use href="#${esc(icon)}"/></svg>${esc(label)}</a>`
  );
}

/** `<span>` method chip, uniform min-width so op paths align in the rail. */
function methodChip(method: string): string {
  const m = method.toUpperCase();
  return `<span class="${BADGE_BASE} ${BADGE_VARIANT[methodTone(m)]} ${CHIP}">${esc(m)}</span>`;
}

/** `<span>` status chip for a response. */
function statusChip(status: string): string {
  return `<span class="${BADGE_BASE} ${BADGE_VARIANT.outline} ${CHIP}">${esc(status)}</span>`;
}

const COPY_ICON = '<svg ><use href="#i-copy"/></svg>';
/** Icon markup shown during a copy button's transient 'copied' state. */
export const CHECK_ICON = '<svg ><use href="#i-check"/></svg>';

/** Ghost sm button (mirrors button.svelte sm+ghost) wired to [data-copy]. */
function copyButton(text: string, label?: string): string {
  return (
    `<button class="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 hover:bg-accent hover:text-accent-foreground h-8" ` +
    `data-copy data-copy-text="${esc(text)}" type="button">${COPY_ICON}${esc(label ?? "Copy")}</button>`
  );
}

/** Error panel shown when a snapshot is missing/unparseable. */
export function errorPanel(message: string): string {
  return (
    `<div class="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 shadow-sm" data-ws="error">` +
    `<span class="${BADGE_BASE} ${BADGE_VARIANT.destructive}">${esc(message)}</span>` +
    `<p class="text-[11px] leading-snug text-muted-foreground">No snapshot data is available for this workspace.</p></div>`
  );
}

// ---------- panes ----------

/**
 * curl command for an op; always returns a command (deterministic, multi-line
 * with `\` continuations). Path params substitute their example values;
 * unsubstituted `{name}` segments stay verbatim; query params append only
 * when they carry an example value.
 */
function curlFor(snap: ApiSnapshot, op: ApiSnapshot["ops"][number]): string {
  const base = (snap.server ?? "").replace(/\/+$/, "");
  let path = op.path;
  const query: string[] = [];
  for (const p of op.parameters ?? []) {
    if (p.in === "path" && p.example !== undefined) {
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.example)));
    } else if (p.in === "query" && p.example !== undefined) {
      query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(p.example))}`);
    }
  }
  const url = `${base}${path}${query.length > 0 ? `?${query.join("&")}` : ""}`;
  const lines = [`curl -X ${op.method.toUpperCase()} '${url}'`];
  if (op.requestExample !== undefined || op.requestSchema !== undefined) {
    lines.push("  -H 'Content-Type: application/json'");
  }
  if (op.requestExample !== undefined) {
    lines.push(`  -d '${JSON.stringify(op.requestExample)}'`);
  }
  return lines.join(" \\\n");
}

/** Section label row (mirrors components/Section.svelte). */
function sectionHeader(title: string): string {
  return `<div class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">${esc(
    title,
  )}</div>`;
}

export function apiOpPane(snap: ApiSnapshot, id: string, links = ""): string {
  const op = snap.ops.find((o) => o.id === id);
  if (!op) {
    return `<div data-ws="api" data-id="${esc(id)}">${
      errorPanel(`no op '${id}' in snapshot`)
    }</div>`;
  }
  const sections: string[] = [];
  const summary = op.summary
    ? `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Summary")}</div>` +
      `<p class="max-w-[720px] text-[12.5px] leading-snug text-muted-foreground">${esc(op.summary)}</p></section>`
    : "";
  if (summary) sections.push(summary);

  if (op.parameters?.length) {
    const rows = op.parameters.map((p) => {
      const example = p.example !== undefined
        ? ` <span class="text-muted-foreground">e.g. ${esc(JSON.stringify(p.example))}</span>`
        : "";
      const desc = p.description ? esc(p.description) : "";
      const inType = [p.in, p.type].filter(Boolean).join(" · ");
      return [
        `<code class="font-mono text-xs">${esc(p.name)}</code>`,
        inType ? `<span class="font-mono text-muted-foreground">${esc(inType)}</span>` : "—",
        p.required
          ? `<span class="font-medium">required</span>`
          : `<span class="text-muted-foreground">optional</span>`,
        `${desc}${example}` || "—",
      ];
    });
    sections.push(
      `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Parameters")}</div>` +
        `${table(["Name", "Type", "Required", "Description"], rows)}</section>`,
    );
  }
  if (op.requestSchema !== undefined) {
    sections.push(
      `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Request body")}</div>` +
        `<pre class="codeblock font-mono">${highlightJson(op.requestSchema)}</pre></section>`,
    );
  }
  if (op.responses?.length) {
    const responses = op.responses
      .map((r) => {
        const schema = r.schema !== undefined
          ? `<pre class="codeblock font-mono">${highlightJson(r.schema)}</pre>`
          : "";
        return `<div class="flex flex-col items-start gap-1.5">${statusChip(r.status)}` +
          (r.description ? `<p class="text-[12.5px] text-muted-foreground">${esc(r.description)}</p>` : "") +
          schema +
          `</div>`;
      })
      .join("\n  ");
    sections.push(
      `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Responses")}</div>\n  ${responses}\n</section>`,
    );
  }

  // Right column: example request (curl is always available) + one example
  // response block per response that carries an example payload.
  const curl = curlFor(snap, op);
  const exampleRequests =
    `<div class="flex items-center justify-between gap-2">` +
    `<div>${sectionHeader("Example request")}</div>` +
    copyButton(curl, "Copy") +
    `</div><pre class="codeblock font-mono">${highlightBash(curl)}</pre>`;
  const exampleResponses = (op.responses ?? []).filter((r) => r.example !== undefined);
  let rightColumn = `<div class="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">${exampleRequests}</div>`;
  if (exampleResponses.length > 0) {
    const blocks = exampleResponses
      .map(
        (r) =>
          `<div class="flex flex-col gap-1.5">${statusChip(r.status)}` +
          `<pre class="codeblock font-mono">${highlightJson(r.example)}</pre></div>`,
      )
      .join("\n  ");
    rightColumn +=
      `<div class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">` +
      `<div>${sectionHeader("Example responses")}</div>${blocks}</div>`;
  }

  return `<div data-ws="api" data-id="${esc(op.id)}">
  <div class="${links
    ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
    : "grid items-start gap-6"}">
  <div class="min-w-0 flex flex-col gap-[18px]">
    <div class="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-5 shadow-sm">
      ${methodChip(op.method)}
      <h2 class="min-w-0 flex-1 break-all font-mono text-[17px] font-semibold tracking-[-0.01em] text-foreground">${
    esc(op.path)
  }</h2>
      <div class="ml-auto flex flex-none flex-wrap items-center gap-2">${links}${copyButton(
    op.path,
    "Copy path",
  )}</div>
    </div>
    ${sections.join("\n  ")}
  </div>
  ${rightColumn}
  </div>
</div>`;
}

export function dbTablePane(snap: DbSnapshot, name: string): string {
  const table_ = snap.tables.find((t) => t.name === name);
  if (!table_) {
    return `<div data-ws="db" data-id="${esc(name)}">${
      errorPanel(`no table '${name}' in snapshot`)
    }</div>`;
  }
  const conn = snap.connection;
  const connLine = conn && (conn.host || conn.database)
    ? `<div class="mt-3 font-mono text-[11px] text-muted-foreground">${
      esc([conn.host, conn.database].filter(Boolean).join(" / "))
    }</div>`
    : "";
  const rowCountBadge = table_.rowCount !== undefined
    ? `<span class="${BADGE_BASE} ${BADGE_VARIANT.outline}">~${table_.rowCount} rows</span>`
    : "";
  const columnRows = table_.columns.map((c) => [
    `<code class="font-mono text-xs">${esc(c.name)}</code>` +
      (c.primaryKey
        ? ` <span class="${BADGE_BASE} border-primary/20 bg-primary/10 text-primary">PK</span>`
        : ""),
    `<span class="font-mono text-muted-foreground">${esc(c.type)}</span>`,
    c.nullable ? "yes" : `<span class="text-muted-foreground">no</span>`,
    c.default !== undefined
      ? `<code class="font-mono text-xs text-secondary-foreground">${esc(c.default)}</code>`
      : "—",
  ]);
  const columnsSection =
    `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Columns")}</div>` +
    `${table(["Name", "Type", "Nullable", "Default"], columnRows)}</section>`;
  const fkRows = table_.foreignKeys.map((fk) => [
    `<code class="font-mono text-xs">${esc(fk.column)}</code>`,
    `<code class="font-mono text-xs"><span class="text-muted-foreground">${esc(fk.referencesTable)}</span>.<span class="text-foreground">${esc(fk.referencesColumn)}</span></code>`,
  ]);
  const relationsSection = table_.foreignKeys.length > 0
    ? `<section class="flex flex-col gap-2.5"><div>${sectionHeader("Foreign keys")}</div>` +
      `${table(["Column", "References"], fkRows)}</section>`
    : "";
  return `<div data-ws="db" data-id="${esc(table_.name)}">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
    <h2 class="font-mono text-[19px] font-semibold tracking-[-0.02em] text-foreground">${
    esc(table_.name)
  }</h2>
    <span class="${BADGE_BASE} ${BADGE_VARIANT.secondary}">${table_.columns.length} columns</span>${rowCountBadge}
    <div class="ml-auto flex flex-none items-center gap-2">${copyButton(table_.name, "Copy name")}</div>
  </div>
  <div style="height:18px"></div>
  ${columnsSection}
  ${relationsSection}
  ${connLine}
</div>`;
}