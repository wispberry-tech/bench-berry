<script lang="ts">
  // Database workspace: tables rail (name + column-count badge) + pane with
  // table name, column count and the connection host/database line; a
  // snapshot.error shows an error panel instead.
  import { snapshots } from '../lib/store.svelte.ts';
  import { isDbSnapshot, isSnapshotError } from '../lib/types.ts';
  import { dbTablePane, errorPanel } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';

  let { route, navigate } = $props<{
    route: Route;
    navigate: (hash: string) => void;
  }>();

  const raw = $derived(snapshots.db);
  const error = $derived(
    isSnapshotError(raw) ? raw.error
      : isDbSnapshot(raw) ? (raw.error ?? null)
      : 'no snapshot for db',
  );
  const snap = $derived(isDbSnapshot(raw) ? raw : null);
  const tables = $derived(snap?.tables ?? []);

  const activeTable = $derived(
    route.kind === 'workspace' && route.id && snap
      ? (snap.tables.find((t) => t.name === route.id) ?? snap.tables[0] ?? null)
      : (snap?.tables[0] ?? null),
  );

  const database = $derived(snap?.connection?.database);
</script>

<div class="view-body">
  <aside class="rail" data-ws="db">
    <div class="rail-head">
      <div class="rail-title">{database ?? 'Database'}</div>
      <div class="rail-sub">{tables.length} tables</div>
    </div>
    {#if snap}
      <div class="rail-group">Tables</div>
      {#each tables as table (table.name)}
        <button
          class="rail-item"
          class:active={table.name === activeTable?.name}
          type="button"
          data-ws="db"
          data-id={table.name}
          onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'db', key: 'table', id: table.name }))}
        >
          <svg class="icon"><use href="#i-table"/></svg>
          <span class="mono">{table.name}</span>
          <span class="rail-count">{table.columns}</span>
        </button>
      {/each}
    {/if}
  </aside>

  <div class="view-content">
    <div class="view-head">
      <div>
        <div class="vh-title">Database</div>
        <div class="vh-sub">{database ?? 'Database'}{snap?.connection?.host ? ` · ${snap.connection.host}` : ''} · {tables.length} tables, from the latest snapshot.</div>
      </div>
    </div>
    {#if error}
      {@html errorPanel(error)}
    {:else if snap && activeTable}
      {@html dbTablePane(snap, activeTable.name)}
    {:else}
      <div class="empty">
        <p>No tables in this snapshot yet.</p>
      </div>
    {/if}
  </div>
</div>