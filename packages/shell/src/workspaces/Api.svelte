<script lang="ts">
  // API Explorer workspace: ops rail (method chip + path, one row per op) +
  // pane with method, path, summary and a copy button; header shows the
  // snapshot title/version/endpointCount, or an error panel when the snapshot
  // is missing.
  import { snapshots, config } from '../lib/store.svelte.ts';
  import { isApiSnapshot, isDbSnapshot, isDesignSnapshot, isSnapshotError } from '../lib/types.ts';
  import { apiOpPane, basename, crossLinkChip, errorPanel, methodTone } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';
  import { isCollapsed, readRailState, setGroupCollapsed } from '../lib/railState.ts';
  import Rail from '../lib/components/rail/Rail.svelte';
  import RailGroup from '../lib/components/rail/RailGroup.svelte';
  import RailItem from '../lib/components/rail/RailItem.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import Badge from '../lib/components/ui/badge.svelte';

  let { route, navigate } = $props<{
    route: Route;
    navigate: (hash: string) => void;
  }>();

  // Persisted rail collapse state (per workspace+group, default expanded).
  let railState = $state(readRailState());

  const raw = $derived(snapshots.api);
  const error = $derived(isSnapshotError(raw) ? raw.error : isApiSnapshot(raw) ? null : 'no snapshot for api');
  const snap = $derived(isApiSnapshot(raw) ? raw : null);
  const ops = $derived(snap?.ops ?? []);

  // Rail groups: first tag per op, first-seen group order, ops in snapshot order.
  const opGroups = $derived.by(() => {
    const groups = new Map<string, typeof ops>();
    for (const op of ops) {
      const key = op.tags?.[0] ?? 'Other';
      const list = groups.get(key) ?? [];
      list.push(op);
      groups.set(key, list);
    }
    return [...groups.entries()];
  });

  // Group id of each op (mirrors opGroups' first-tag rule) for auto-expand.
  const groupOfOp = $derived(new Map(ops.map((o) => [o.id, o.tags?.[0] ?? 'Other'])));

  const activeOp = $derived(
    route.kind === 'workspace' && route.id && snap
      ? (snap.ops.find((o) => o.id === route.id) ?? snap.ops[0] ?? null)
      : (snap?.ops[0] ?? null),
  );

  // Auto-expand the group of the active op: deep links, palette navigation
  // and first load all land here, so the active op's group is never
  // collapsed. Keyed to the op id so manual collapses stick (the effect does
  // not re-fire on every railState update).
  let lastActiveOp = $state<string | null>(route.kind === 'workspace' ? (route.id ?? null) : null);
  $effect(() => {
    const id = activeOp?.id ?? null;
    if (!id) return;
    if (id === lastActiveOp) return;
    lastActiveOp = id;
    const g = groupOfOp.get(id);
    if (g && isCollapsed(railState, 'api', g)) {
      railState = setGroupCollapsed(railState, 'api', g, false);
    }
  });

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
    if (op.comp && config.workspaces.design?.enabled && designSnap) {
      // The design deep-link id-space is the STORY FILE (router hasDeepLink /
      // Design.svelte activeFile), so bind the chip to the matched story's
      // `file`, not to the comp name itself.
      const matched = designSnap.stories.find((s) => (s.title ?? basename(s.file)) === op.comp);
      if (matched) {
        parts.push(crossLinkChip(
          `comp: ${op.comp}`,
          hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: matched.file }),
          'i-cube',
        ));
      }
    }
    return parts.join('');
  });
</script>

<div class="view-body flex min-h-full items-stretch">
  <Rail title={snap?.title ?? 'API Explorer'} sub={`${endpointCount} endpoints`}>
    {#if snap}
      {#each opGroups as [group, groupOps] (group)}
        <RailGroup
          ws="api"
          group={group}
          count={groupOps.length}
          collapsed={isCollapsed(railState, 'api', group)}
          onToggle={() => railState = setGroupCollapsed(railState, 'api', group, !isCollapsed(railState, 'api', group))}
        >
          {#each groupOps as op (op.id)}
            <RailItem
              twoLine
              active={op.id === activeOp?.id}
              data-ws="api"
              data-id={op.id}
              onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'api', key: 'op', id: op.id }))}
            >
              <Badge
                variant={methodTone(op.method)}
                class="min-w-[52px] justify-center px-1.5 font-mono text-[10px] tracking-[0.03em]"
              >
                {op.method.toUpperCase()}
              </Badge>
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-mono">{op.path}</span>
                {#if op.summary ?? op.operationId}
                  <span class="truncate text-[10.5px] text-muted-foreground">{op.summary ?? op.operationId}</span>
                {/if}
              </span>
            </RailItem>
          {/each}
        </RailGroup>
      {/each}
    {/if}
  </Rail>

  <div class="min-w-0 flex-1">
    <div class="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-6">
    <PageHeader
      title="API Explorer"
      meta={[title, snap?.version ? `v${snap.version}` : undefined, `${endpointCount} endpoints`]}
    />
    {#if error}
      {@html errorPanel(error)}
    {:else if snap && activeOp}
      {@html apiOpPane(snap, activeOp.id, opLinks)}
    {:else}
      <EmptyState message="No operations in this snapshot yet." />
    {/if}
    </div>
  </div>
</div>