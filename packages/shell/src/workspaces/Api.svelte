<script lang="ts">
  // API Explorer workspace: ops rail (method chip + path, one row per op) +
  // pane with method, path, summary and a copy button; header shows the
  // snapshot title/version/endpointCount, or an error panel when the snapshot
  // is missing.
  import { snapshots, config } from '../lib/store.svelte.ts';
  import { isApiSnapshot, isDbSnapshot, isDesignSnapshot, isSnapshotError } from '../lib/types.ts';
  import { apiOpPane, basename, crossLinkChip, errorPanel, methodTone } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';

  let { route, navigate } = $props<{
    route: Route;
    navigate: (hash: string) => void;
  }>();

  const raw = $derived(snapshots.api);
  const error = $derived(isSnapshotError(raw) ? raw.error : isApiSnapshot(raw) ? null : 'no snapshot for api');
  const snap = $derived(isApiSnapshot(raw) ? raw : null);
  const ops = $derived(snap?.ops ?? []);

  const activeOp = $derived(
    route.kind === 'workspace' && route.id && snap
      ? (snap.ops.find((o) => o.id === route.id) ?? snap.ops[0] ?? null)
      : (snap?.ops[0] ?? null),
  );

  const title = $derived(snap?.title ?? 'API Explorer');
  const endpointCount = $derived(snap?.endpointCount ?? 0);

  // §5 cross-link chips: rendered per op only when the target workspace is
  // enabled AND the referenced id exists in its snapshot; otherwise omitted.
  const dbSnap = $derived(isDbSnapshot(snapshots.db) ? snapshots.db : null);
  const designSnap = $derived(isDesignSnapshot(snapshots.design) ? snapshots.design : null);

  const opLinks = $derived.by(() => {
    const op = activeOp;
    if (!op) return '';
    const parts: string[] = [];
    if (op.table && config.workspaces.db?.enabled && dbSnap?.tables.some((t) => t.name === op.table)) {
      parts.push(crossLinkChip(
        `table: ${op.table}`,
        hashFor({ kind: 'workspace', ws: 'db', key: 'table', id: op.table }),
        'i-db',
      ));
    }
    if (op.comp && config.workspaces.design?.enabled) {
      const found = designSnap?.stories.some((s) => (s.title ?? basename(s.file)) === op.comp);
      if (found) {
        parts.push(crossLinkChip(
          `comp: ${op.comp}`,
          hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: op.comp }),
          'i-cube',
        ));
      }
    }
    return parts.join('');
  });
</script>

<div class="view-body">
  <aside class="rail" data-ws="api">
    <div class="rail-head">
      <div class="rail-title">{snap?.title ?? 'API Explorer'}</div>
      <div class="rail-sub">{endpointCount} endpoints</div>
    </div>
    {#if snap}
      <div class="rail-group">Operations</div>
      {#each ops as op (op.id)}
        <button
          class="rail-item"
          class:active={op.id === activeOp?.id}
          type="button"
          data-ws="api"
          data-id={op.id}
          onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'api', key: 'op', id: op.id }))}
        >
          <span class="badge {methodTone(op.method)} v-api-method v-api-chip">{op.method.toUpperCase()}</span>
          <span class="mono">{op.path}</span>
        </button>
      {/each}
    {/if}
  </aside>

  <div class="view-content">
    <div class="view-head">
      <div>
        <div class="vh-title">API Explorer</div>
        <div class="vh-sub">{title}{snap?.version ? ` · v${snap.version}` : ''} · {endpointCount} endpoints, from the latest snapshot.</div>
      </div>
    </div>
    {#if error}
      {@html errorPanel(error)}
    {:else if snap && activeOp}
      {@html apiOpPane(snap, activeOp.id, opLinks)}
    {:else}
      <div class="empty">
        <p>No operations in this snapshot yet.</p>
      </div>
    {/if}
  </div>
</div>