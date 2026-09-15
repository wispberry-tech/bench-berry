<script lang="ts">
  // API Explorer workspace: sidebar of ops grouped by first tag (method
  // Badge + two-line path/summary rows) + a component pane with method/path
  // header, summary, parameters, request body and responses; or an error
  // panel when the snapshot is missing.
  import { snapshots, config } from '../lib/store.svelte.ts';
  import { isApiSnapshot, isDbSnapshot, isDesignSnapshot, isSnapshotError } from '../lib/types.ts';
  import { basename } from '../lib/markup.ts';
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
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import Database from '@lucide/svelte/icons/database';
  import Box from '@lucide/svelte/icons/box';

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

  // HTTP verb -> Badge variant (shadcn tones; unknown verbs fall back to
  // neutral secondary).
  type MethodVariant = 'default' | 'secondary' | 'destructive';
  const METHOD_VARIANT: Record<string, MethodVariant> = {
    DELETE: 'destructive',
    GET: 'default',
    POST: 'secondary',
    PUT: 'secondary',
    PATCH: 'secondary',
  };
  const methodVariant = (method: string): MethodVariant =>
    METHOD_VARIANT[method.toUpperCase()] ?? 'secondary';

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

  // §5 cross-link chips: per-op links into another enabled workspace,
  // rendered only when the referenced id exists in its snapshot.
  interface CrossLink {
    label: string;
    href: string;
    icon: 'database' | 'box';
  }
  const dbSnap = $derived(isDbSnapshot(snapshots.db) ? snapshots.db : null);
  const designSnap = $derived(isDesignSnapshot(snapshots.design) ? snapshots.design : null);

  const opLinks = $derived.by(() => {
    const op = activeOp;
    if (!op) return [] as CrossLink[];
    const links: CrossLink[] = [];
    if (op.table && config.workspaces.db?.enabled && dbSnap?.tables.some((t) => t.name === op.table)) {
      links.push({
        label: `table: ${op.table}`,
        href: hashFor({ kind: 'workspace', ws: 'db', key: 'table', id: op.table }),
        icon: 'database',
      });
    }
    if (op.comp && config.workspaces.design?.enabled && designSnap) {
      // The design deep-link id-space is the STORY FILE (router hasDeepLink /
      // Design.svelte activeFile), so bind the chip to the matched story's
      // `file`, not to the comp name itself.
      const matched = designSnap.stories.find((s) => (s.title ?? basename(s.file)) === op.comp);
      if (matched) {
        links.push({
          label: `comp: ${op.comp}`,
          href: hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: matched.file }),
          icon: 'box',
        });
      }
    }
    return links;
  });

  // curl command for the active op; always a full command (deterministic,
  // multi-line with `\` continuations). Path params substitute their example
  // values; unsubstituted `{name}` segments stay verbatim; query params
  // append only when they carry an example value.
  const curl = $derived.by(() => {
    const op = activeOp;
    if (!op || !snap) return '';
    const base = (snap.server ?? '').replace(/\/+$/, '');
    let path = op.path;
    const query: string[] = [];
    for (const p of op.parameters ?? []) {
      if (p.in === 'path' && p.example !== undefined) {
        path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.example)));
      } else if (p.in === 'query' && p.example !== undefined) {
        query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(p.example))}`);
      }
    }
    const url = `${base}${path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
    const lines = [`curl -X ${op.method.toUpperCase()} '${url}'`];
    if (op.requestExample !== undefined || op.requestSchema !== undefined) {
      lines.push("  -H 'Content-Type: application/json'");
    }
    if (op.requestExample !== undefined) {
      lines.push(`  -d '${JSON.stringify(op.requestExample)}'`);
    }
    return lines.join(' \\\n');
  });

  const exampleResponses = $derived((activeOp?.responses ?? []).filter((r) => r.example !== undefined));
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

{#snippet statusBadge(status: string)}
  <Badge variant="outline" class="min-w-[52px] justify-center font-mono text-xs tracking-[0.03em]">
    {status}
  </Badge>
{/snippet}

{#snippet crossLinkBadge(link: CrossLink)}
  <Badge
    variant="outline"
    class="border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
    href={link.href}
  >
    {#if link.icon === 'database'}
      <Database class="size-3" />
    {:else}
      <Box class="size-3" />
    {/if}
    {link.label}
  </Badge>
{/snippet}

<div class="view-body flex min-h-full items-stretch">
  <Sidebar.Provider class="min-h-full">
    <Sidebar.Root collapsible="none" class="flex-none border-r border-sidebar-border">
      <Sidebar.Header class="gap-0.5 border-b border-sidebar-border px-4 pb-3 pt-4.5">
        <div class="text-sm font-medium tracking-[-0.01em]">{title}</div>
        <div class="text-xs text-muted-foreground">{endpointCount} endpoints</div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group data-ws="api">
          <Sidebar.GroupLabel>Endpoints</Sidebar.GroupLabel>
          <Sidebar.GroupContent>
            <Sidebar.Menu>
              {#each opGroups as [group, groupOps] (group)}
                <Collapsible.Root
                  class="group/collapsible"
                  open={!isCollapsed(railState, 'api', group)}
                  onOpenChange={(open) => {
                    railState = setGroupCollapsed(railState, 'api', group, !open);
                  }}
                >
                  <Sidebar.MenuItem>
                    <Collapsible.Trigger class="w-full">
                      {#snippet child({ props })}
                        <Sidebar.MenuButton {...props}>
                          <span class="flex-1 truncate">{group}</span>
                          <span class="flex-none text-xs tabular-nums text-sidebar-foreground/50">{groupOps.length}</span>
                          <ChevronRight class="flex-none text-sidebar-foreground/50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </Sidebar.MenuButton>
                      {/snippet}
                    </Collapsible.Trigger>
                  </Sidebar.MenuItem>
                  <Collapsible.Content>
                    <Sidebar.MenuSub>
                      {#each groupOps as op (op.id)}
                        <Sidebar.MenuSubItem>
                          <Sidebar.MenuSubButton
                            size="sm"
                            href={hashFor({ kind: 'workspace', ws: 'api', key: 'op', id: op.id })}
                            isActive={op.id === activeOp?.id}
                            data-ws="api"
                            data-id={op.id}
                          >
                            <Badge
                              variant={methodVariant(op.method)}
                              class="min-w-[52px] flex-none justify-center px-1.5 font-mono text-xs tracking-[0.03em]"
                            >
                              {op.method.toUpperCase()}
                            </Badge>
                            <span class="truncate">{op.path}</span>
                          </Sidebar.MenuSubButton>
                        </Sidebar.MenuSubItem>
                      {/each}
                    </Sidebar.MenuSub>
                  </Collapsible.Content>
                </Collapsible.Root>
              {/each}
            </Sidebar.Menu>
          </Sidebar.GroupContent>
        </Sidebar.Group>
      </Sidebar.Content>
    </Sidebar.Root>

    <div class="min-w-0 flex-1">
      <div class="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-6">
        <PageHeader
          title="API Explorer"
          meta={[title, snap?.version ? `v${snap.version}` : undefined, `${endpointCount} endpoints`]}
        />
        {#if error}
          <ErrorPanel message={error} />
        {:else if snap && activeOp}
          <div
            data-ws="api"
            data-id={activeOp.id}
            class="grid items-start gap-6 {opLinks.length > 0
              ? 'lg:grid-cols-[minmax(0,1fr)_380px]'
              : ''}"
          >
            <div class="flex min-w-0 flex-col gap-4.5">
              <Card class="flex-row flex-wrap items-start gap-x-4 gap-y-2 p-5">
                <Badge
                  variant={methodVariant(activeOp.method)}
                  class="min-w-[52px] flex-none justify-center font-mono text-xs tracking-[0.03em]"
                >
                  {activeOp.method.toUpperCase()}
                </Badge>
                <h2 class="min-w-0 flex-1 break-all font-mono text-lg font-semibold tracking-[-0.01em]">
                  {activeOp.path}
                </h2>
                <div class="ms-auto flex flex-none flex-wrap items-center gap-2">
                  {#each opLinks as link (link.href)}
                    {@render crossLinkBadge(link)}
                  {/each}
                  {@render copyButton(activeOp.path)}
                </div>
              </Card>

              {#if activeOp.summary}
                <Section title="Summary">
                  <p class="max-w-[720px] text-sm leading-snug text-muted-foreground">{activeOp.summary}</p>
                </Section>
              {/if}

              {#if activeOp.parameters?.length}
                <Section title="Parameters">
                  <div class="w-full overflow-hidden rounded-lg border border-border bg-card">
                    <Table.Root class="text-xs">
                      <Table.Header>
                        <Table.Row class="bg-muted/50 hover:bg-muted/50">
                          <Table.Head>Name</Table.Head>
                          <Table.Head>Type</Table.Head>
                          <Table.Head>Required</Table.Head>
                          <Table.Head>Description</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each activeOp.parameters as p (p.name)}
                          <Table.Row>
                            <Table.Cell><code class="font-mono text-xs">{p.name}</code></Table.Cell>
                            <Table.Cell>
                              {#if p.in || p.type}
                                <span class="font-mono text-muted-foreground">
                                  {[p.in, p.type].filter(Boolean).join(' · ')}
                                </span>
                              {:else}
                                —
                              {/if}
                            </Table.Cell>
                            <Table.Cell>
                              {#if p.required}
                                <span class="font-medium">required</span>
                              {:else}
                                <span class="text-muted-foreground">optional</span>
                              {/if}
                            </Table.Cell>
                            <Table.Cell>
                              {#if p.description || p.example !== undefined}
                                {p.description}{#if p.example !== undefined}
                                  <span class="text-muted-foreground">e.g. {JSON.stringify(p.example)}</span>
                                {/if}
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
              {/if}

              {#if activeOp.requestSchema !== undefined}
                <Section title="Request body">
                  <pre class="codeblock">{JSON.stringify(activeOp.requestSchema, null, 2)}</pre>
                </Section>
              {/if}

              {#if activeOp.responses?.length}
                <Section title="Responses">
                  <div class="flex flex-col gap-6">
                    {#each activeOp.responses as r, i (i)}
                      <div class="flex flex-col items-start gap-1.5">
                        {@render statusBadge(r.status)}
                        {#if r.description}
                          <p class="text-sm text-muted-foreground">{r.description}</p>
                        {/if}
                        {#if r.schema !== undefined}
                          <pre class="codeblock">{JSON.stringify(r.schema, null, 2)}</pre>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </Section>
              {/if}
            </div>

            <div class="flex min-w-0 flex-col gap-4">
              <Card class="gap-4 p-4">
                <Section title="Example request">
                  {#snippet actions()}
                    {@render copyButton(curl)}
                  {/snippet}
                  <pre class="codeblock">{curl}</pre>
                </Section>
              </Card>
              {#if exampleResponses.length > 0}
                <Card class="gap-3 p-4">
                  <Section title="Example responses">
                    {#each exampleResponses as r, i (i)}
                      <div class="flex flex-col gap-1.5">
                        {@render statusBadge(r.status)}
                        <pre class="codeblock">{JSON.stringify(r.example, null, 2)}</pre>
                      </div>
                    {/each}
                  </Section>
                </Card>
              {/if}
            </div>
          </div>
        {:else}
          <EmptyState message="No operations in this snapshot yet." />
        {/if}
      </div>
    </div>
  </Sidebar.Provider>
</div>
