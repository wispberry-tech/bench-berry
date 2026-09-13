<script lang="ts">
  // API Explorer workspace: ops rail (method chip + path, one row per op) +
  // pane with method, path, summary and a copy button; header shows the
  // snapshot title/version/endpointCount, or an error panel when the snapshot
  // is missing.
  import { snapshots } from '../lib/store.svelte.ts';
  import { isApiSnapshot, isSnapshotError } from '../lib/types.ts';
  import { apiOpPane, errorPanel, methodTone } from '../lib/markup.ts';
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
      {@html apiOpPane(snap, activeOp.id)}
    {:else}
      <div class="empty">
        <p>No operations in this snapshot yet.</p>
      </div>
    {/if}
  </div>
</div>