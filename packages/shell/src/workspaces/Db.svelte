<script lang="ts">
  // Database workspace: sidebar of tables grouped by schema (icon + mono
  // name + column-count rows) + a component pane with table name, column
  // count badges, columns/foreign-key tables and the connection host/database
  // line; a snapshot.error shows an error panel instead.
  import { snapshots } from '../lib/store.svelte.ts';
  import { isDbSnapshot, isSnapshotError } from '../lib/types.ts';
  import { hashFor, type Route } from '../lib/router.ts';
  import { isCollapsed, readRailState, setGroupCollapsed } from '../lib/railState.ts';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import ErrorPanel from '../lib/components/error-panel.svelte';
  import Section from '../lib/components/Section.svelte';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Table from '$lib/components/ui/table';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import TableIcon from '@lucide/svelte/icons/table-2';

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

{#snippet copyButton(text: string)}
  <Button
    variant="ghost"
    size="sm"
    class="size-6 p-0"
    data-copy
    data-copy-text={text}
    aria-label="Copy"
  >
    <Copy data-copy-btn-icon class="size-3.5" />
    <Check data-copy-btn-check class="hidden size-3.5" />
  </Button>
{/snippet}

<div class="view-body flex min-h-full" data-ws="db">
  <Sidebar.Provider class="min-h-full">
    <Sidebar.Root collapsible="none" class="flex-none border-r border-sidebar-border">
      <Sidebar.Header class="gap-0.5 border-b border-sidebar-border px-4 pb-3 pt-4.5">
        <div class="text-sm font-semibold tracking-[-0.01em]">{database ?? 'Database'}</div>
        <div class="text-xs text-muted-foreground">{tables.length} tables</div>
      </Sidebar.Header>
      <Sidebar.Content>
        {#each schemaGroups as [schema, schemaTables] (schema)}
          <Collapsible.Root
            open={!isCollapsed(railState, 'db', schema)}
            onOpenChange={(open) => {
              railState = setGroupCollapsed(railState, 'db', schema, !open);
            }}
          >
            <Sidebar.Group data-ws="db">
              <Sidebar.GroupLabel class="p-0">
                <Collapsible.Trigger class="group/label flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/70 outline-none hover:text-sidebar-foreground focus-visible:text-sidebar-foreground">
                  <ChevronDown
                    class="size-3 flex-none text-sidebar-foreground/70 transition-transform duration-150 group-data-[state=closed]/label:-rotate-90"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1 truncate">{schema}</span>
                  <span class="flex-none tabular-nums">{schemaTables.length}</span>
                </Collapsible.Trigger>
              </Sidebar.GroupLabel>
              <Collapsible.Content>
                <Sidebar.GroupContent>
                  <Sidebar.Menu>
                    {#each schemaTables as table (table.name)}
                      <Sidebar.MenuItem>
                        <Sidebar.MenuButton
                          isActive={table.name === activeTable?.name}
                          data-ws="db"
                          data-id={table.name}
                          onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'db', key: 'table', id: table.name }))}
                        >
                          <TableIcon class="flex-none text-muted-foreground" />
                          <span class="min-w-0 flex-1 truncate font-mono text-xs">{table.name}</span>
                          <span class="flex-none text-xs tabular-nums text-muted-foreground/70">{table.columns.length}</span>
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                    {/each}
                  </Sidebar.Menu>
                </Sidebar.GroupContent>
              </Collapsible.Content>
            </Sidebar.Group>
          </Collapsible.Root>
        {/each}
      </Sidebar.Content>
    </Sidebar.Root>

    <div class="min-w-0 flex-1">
      <div class="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-6">
        <PageHeader title="Database" meta={[database ?? 'Database', snap?.connection?.host, `${tables.length} tables`]} />
        {#if error}
          <ErrorPanel message={error} />
        {:else if snap && activeTable}
          <div data-ws="db" data-id={activeTable.name} class="flex flex-col gap-4.5">
            <Card class="flex-row flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <h2 class="font-mono text-lg font-semibold tracking-[-0.02em]">{activeTable.name}</h2>
              <Badge variant="secondary">{activeTable.columns.length} columns</Badge>
              {#if activeTable.rowCount !== undefined}
                <Badge variant="outline">~{activeTable.rowCount} rows</Badge>
              {/if}
              <div class="ms-auto flex flex-none items-center gap-2">
                {@render copyButton(activeTable.name)}
              </div>
            </Card>

            <Section title="Columns">
              <div class="w-full overflow-hidden rounded-lg border border-border bg-card">
                <Table.Root class="text-xs">
                  <Table.Header>
                    <Table.Row class="bg-muted/50 hover:bg-muted/50">
                      <Table.Head>Name</Table.Head>
                      <Table.Head>Type</Table.Head>
                      <Table.Head>Nullable</Table.Head>
                      <Table.Head>Default</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {#each activeTable.columns as c (c.name)}
                      <Table.Row>
                        <Table.Cell>
                          <code class="font-mono text-xs">{c.name}</code>
                          {#if c.primaryKey}
                            <Badge variant="outline" class="border-primary/20 bg-primary/10 text-primary">PK</Badge>
                          {/if}
                        </Table.Cell>
                        <Table.Cell>
                          <span class="font-mono text-muted-foreground">{c.type}</span>
                        </Table.Cell>
                        <Table.Cell>
                          {#if c.nullable}
                            yes
                          {:else}
                            <span class="text-muted-foreground">no</span>
                          {/if}
                        </Table.Cell>
                        <Table.Cell>
                          {#if c.default !== undefined}
                            <code class="font-mono text-xs text-secondary-foreground">{c.default}</code>
                          {:else}
                            —
                          {/if}
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              </div>
            </Section>

            {#if activeTable.foreignKeys.length > 0}
              <Section title="Foreign keys">
                <div class="w-full overflow-hidden rounded-lg border border-border bg-card">
                  <Table.Root class="text-xs">
                    <Table.Header>
                      <Table.Row class="bg-muted/50 hover:bg-muted/50">
                        <Table.Head>Column</Table.Head>
                        <Table.Head>References</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {#each activeTable.foreignKeys as fk (fk.column)}
                        <Table.Row>
                          <Table.Cell><code class="font-mono text-xs">{fk.column}</code></Table.Cell>
                          <Table.Cell>
                            <code class="font-mono text-xs">
                              <span class="text-muted-foreground">{fk.referencesTable}</span>.<span class="text-foreground">{fk.referencesColumn}</span>
                            </code>
                          </Table.Cell>
                        </Table.Row>
                      {/each}
                    </Table.Body>
                  </Table.Root>
                </div>
              </Section>
            {/if}

            {#if snap.connection && (snap.connection.host || snap.connection.database)}
              <div class="font-mono text-xs text-muted-foreground">
                {[snap.connection.host, snap.connection.database].filter(Boolean).join(' / ')}
              </div>
            {/if}
          </div>
        {:else}
          <EmptyState message="No tables in this snapshot yet." />
        {/if}
      </div>
    </div>
  </Sidebar.Provider>
</div>
