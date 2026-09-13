<script lang="ts">
  // Database workspace: tables rail (name + column-count badge) + pane with
  // table name, column count and the connection host/database line; a
  // snapshot.error shows an error panel instead.
  import { snapshots } from '../lib/store.svelte.ts';
  import { isDbSnapshot, isSnapshotError } from '../lib/types.ts';
  import { dbTablePane, errorPanel } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';
  import { isCollapsed, readRailState, setGroupCollapsed } from '../lib/railState.ts';
  import Rail from '../lib/components/rail/Rail.svelte';
  import RailGroup from '../lib/components/rail/RailGroup.svelte';
  import RailItem from '../lib/components/rail/RailItem.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';

  let { route, navigate } = $props<{
    route: Route;
    navigate: (hash: string) => void;
  }>();

  // Persisted rail collapse state (per workspace+group, default expanded).
  let railState = $state(readRailState());

  const raw = $derived(snapshots.db);
  const error = $derived(
    isSnapshotError(raw) ? raw.error
      : isDbSnapshot(raw) ? (raw.error ?? null)
      : 'no snapshot for db',
  );
  const snap = $derived(isDbSnapshot(raw) ? raw : null);
  const tables = $derived(snap?.tables ?? []);

  // Rail groups: one per schema, first-seen order (single schema still shows its header).
  const schemaGroups = $derived.by(() => {
    const groups = new Map<string, typeof tables>();
    for (const t of tables) {
      const list = groups.get(t.schema) ?? [];
      list.push(t);
      groups.set(t.schema, list);
    }
    return [...groups.entries()];
  });

  const activeTable = $derived(
    route.kind === 'workspace' && route.id && snap
      ? (snap.tables.find((t) => t.name === route.id) ?? snap.tables[0] ?? null)
      : (snap?.tables[0] ?? null),
  );

  // Schema of each table (mirrors schemaGroups) for auto-expand.
  const groupOfTable = $derived(new Map(tables.map((t) => [t.name, t.schema] as const)));

  // Auto-expand the schema of the active table: deep links and first load
  // land here, so the active table's schema group is never collapsed. Keyed
  // to the table name so manual collapses stick.
  let lastActiveTable = $state<string | null>(route.kind === 'workspace' ? (route.id ?? null) : null);
  $effect(() => {
    const name = activeTable?.name ?? null;
    if (!name) return;
    if (name === lastActiveTable) return;
    lastActiveTable = name;
    const g = groupOfTable.get(name);
    if (g && isCollapsed(railState, 'db', g)) {
      railState = setGroupCollapsed(railState, 'db', g, false);
    }
  });

  const database = $derived(snap?.connection?.database);
</script>

<div class="view-body flex min-h-full" data-ws="db">
  <Rail title={database ?? 'Database'} sub={`${tables.length} tables`}>
    {#if snap}
      {#each schemaGroups as [schema, schemaTables] (schema)}
        <RailGroup
          ws="db"
          group={schema}
          count={schemaTables.length}
          collapsed={isCollapsed(railState, 'db', schema)}
          onToggle={() => railState = setGroupCollapsed(railState, 'db', schema, !isCollapsed(railState, 'db', schema))}
        >
          {#each schemaTables as table (table.name)}
            <RailItem
              active={table.name === activeTable?.name}
              icon="i-table"
              mono
              count={table.columns.length}
              data-ws="db"
              data-id={table.name}
              onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'db', key: 'table', id: table.name }))}
            >
              <span class="truncate">{table.name}</span>
            </RailItem>
          {/each}
        </RailGroup>
      {/each}
    {/if}
  </Rail>

  <div class="min-w-0 flex-1">
    <div class="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-6">
      <PageHeader title="Database" meta={[database ?? 'Database', snap?.connection?.host, `${tables.length} tables`]} />
      {#if error}
        {@html errorPanel(error)}
      {:else if snap && activeTable}
        {@html dbTablePane(snap, activeTable.name)}
      {:else}
        <EmptyState message="No tables in this snapshot yet." />
      {/if}
    </div>
  </div>
</div>