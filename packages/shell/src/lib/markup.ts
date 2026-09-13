// packages/shell/src/lib/markup.ts
// Pure HTML-string builders for workspace panes. Every interpolated value is
// escaped (esc); the strings are rendered via {@html} in the workspace
// components. Panes carry data-ws/data-id attributes for Phase 4 cross-links.
import type { ApiSnapshot, DbSnapshot } from './types.ts';

/** Escape a value for safe interpolation into HTML text/attribute context. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Last path segment of a file path, used as a fallback story label. */
export function basename(file: string): string {
  const i = file.lastIndexOf('/');
  return i === -1 ? file : file.slice(i + 1);
}

const METHOD_TONE: Record<string, string> = {
  GET: 'badge-info',
  POST: 'badge-success',
  PUT: 'badge-warning',
  PATCH: 'badge-warning',
  DELETE: 'badge-danger',
};

/** Method chip badge class; unknown methods fall back to neutral. */
export function methodTone(method: string): string {
  return METHOD_TONE[method.toUpperCase()] ?? 'badge-neutral';
}

/** `<span>` method chip, uniform min-width so op paths align in the rail. */
export function methodChip(method: string): string {
  const m = method.toUpperCase();
  return `<span class="badge ${methodTone(m)} v-api-method v-api-chip">${esc(m)}</span>`;
}

const COPY_ICON = '<svg class="icon"><use href="#i-copy"/></svg>';
/** Icon markup shown during a copy button's transient 'copied' state. */
export const CHECK_ICON = '<svg class="icon"><use href="#i-check"/></svg>';

function copyButton(text: string, label?: string): string {
  return `<button class="btn btn-ghost" data-copy data-copy-text="${esc(text)}" type="button">${COPY_ICON}${esc(label ?? 'Copy')}</button>`;
}

/** Error panel shown when a snapshot is missing/unparseable. */
export function errorPanel(message: string): string {
  return `<div class="error-panel" data-ws="error"><span class="badge badge-danger">${esc(message)}</span><p class="hint">No snapshot data is available for this workspace.</p></div>`;
}

// ---------- panes ----------

export function apiOpPane(snap: ApiSnapshot, id: string): string {
  const op = snap.ops.find((o) => o.id === id);
  if (!op) {
    return `<div class="v-api-detail" data-ws="api" data-id="${esc(id)}">${errorPanel(`no op '${id}' in snapshot`)}</div>`;
  }
  return `<div class="v-api-detail" data-ws="api" data-id="${esc(op.id)}">
  <div class="v-api-head">
    <div class="v-api-title">
      ${methodChip(op.method)}
      <h2 class="v-api-path mono">${esc(op.path)}</h2>
    </div>
    <div class="v-api-actions">${copyButton(op.path, 'Copy path')}</div>
  </div>
  ${op.summary ? `<p class="v-api-summary">${esc(op.summary)}</p>` : ''}
</div>`;
}

export function dbTablePane(snap: DbSnapshot, name: string): string {
  const table = snap.tables.find((t) => t.name === name);
  if (!table) {
    return `<div class="v-db-pane active" data-ws="db" data-id="${esc(name)}">${errorPanel(`no table '${name}' in snapshot`)}</div>`;
  }
  const conn = snap.connection;
  const connLine = conn && (conn.host || conn.database)
    ? `<div class="hint mono conn-line">${esc([conn.host, conn.database].filter(Boolean).join(' / '))}</div>`
    : '';
  return `<div class="v-db-pane active" data-ws="db" data-id="${esc(table.name)}">
  <div class="v-db-head">
    <div class="v-db-name">
      <span class="v-db-table-name">${esc(table.name)}</span>
      <span class="badge badge-neutral">${table.columns} columns</span>
    </div>
    <div class="v-db-actions">${copyButton(table.name, 'Copy name')}</div>
  </div>
  ${connLine}
</div>`;
}