<script lang="ts">
  // Design System workspace (§4.6): stories rail (title or file basename) +
  // live component preview pane. The pane shows Preview | Docs | Code tabs per
  // story. Preview embeds the story in a sandboxed iframe pointed at the
  // preview bundle (?story=<file>) and drives it with the §4.6 postMessage
  // protocol: setStory on rail/deep-link changes, setProps from the schema
  // controls column; ready/error messages flip the loading/error state.
  import { snapshots, env } from '../lib/store.svelte.ts';
  import { isDesignSnapshot, isSnapshotError, type PreviewMessage, type StoryMeta } from '../lib/types.ts';
  import { highlightJson, highlightCode } from '../lib/highlight.ts';
  import { basename, errorPanel } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';
  import { readRailState, isCollapsed, setGroupCollapsed } from '../lib/railState.ts';

  import PageHeader from '../lib/components/PageHeader.svelte';
  import EmptyState from '../lib/components/EmptyState.svelte';
  import { Card } from '$lib/components/ui/card';
  import { Alert } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import Rail from '../lib/components/rail/Rail.svelte';
  import RailGroup from '../lib/components/rail/RailGroup.svelte';
  import RailItem from '../lib/components/rail/RailItem.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Table from '$lib/components/ui/table';

  let { route, navigate, theme = 'light' } = $props<{
    route: Route;
    navigate: (hash: string) => void;
    theme: 'light' | 'dark';
  }>();

  const raw = $derived(snapshots.design);
  const error = $derived(isSnapshotError(raw) ? raw.error : isDesignSnapshot(raw) ? null : 'no snapshot for design');
  const snap = $derived(isDesignSnapshot(raw) ? raw : null);

  const activeFile = $derived(
    route.kind === 'workspace' && route.key !== undefined && route.id && snap
      ? (snap.stories.find((s) => s.file === route.id)?.file ?? snap.stories[0]?.file ?? null)
      : (snap?.stories[0]?.file ?? null),
  );

  const activeStory = $derived(snap?.stories.find((s) => s.file === activeFile) ?? null);

  const packageName = $derived(snap?.packageName ?? 'Design System');
  const version = $derived(snap?.version);

  // ---------- story rail grouping ----------
  // Group by the story's directory (parent dir name). Stories nested directly
  // under a `stories` dir — or the srcRoot itself — are "flat": their path
  // already says 'stories', so a group header would just repeat it.
  function storyGroup(file: string): string | null {
    const name = file.split('/').slice(0, -1).at(-1);
    return name === undefined || name === 'stories' ? null : name;
  }

  // Sections keep snapshot order; adjacent same-group stories merge (the
  // palette convention). A section with group === null renders headerless.
  const railSections = $derived.by(() => {
    const sections: { group: string | null; stories: StoryMeta[] }[] = [];
    for (const story of snap?.stories ?? []) {
      const group = storyGroup(story.file);
      const last = sections[sections.length - 1];
      if (last && last.group === group) last.stories.push(story);
      else sections.push({ group, stories: [story] });
    }
    return sections;
  });

  // Group of each story for auto-expansion (null = flat, nothing to expand).
  const groupOfStory = $derived(
    new Map((snap?.stories ?? []).map((s) => [s.file, storyGroup(s.file)] as const)),
  );

  // ---------- rail collapse state (persisted) ----------
  let railState = $state(readRailState());

  // Auto-expand the active story's group when the ACTIVE STORY switches (deep
  // link, palette navigation or first load) so the current selection is always
  // visible. Deliberately keyed to the id so a user collapsing the group is
  // not undone by the effect re-running on railState changes.
  let lastActiveFile = $state<string | null>(activeFile ?? null);
  $effect(() => {
    const file = activeFile;
    if (!file) return;
    if (file === lastActiveFile) return;
    lastActiveFile = file;
    const g = groupOfStory.get(file);
    if (g && isCollapsed(railState, 'design', g)) {
      railState = setGroupCollapsed(railState, 'design', g, false);
    }
  });

  // ---------- tabs ----------
  type TabId = 'preview' | 'docs' | 'code';
  let tab = $state<TabId>('preview');

  // ---------- props controls (schema-driven) ----------
  type ControlSpec =
    | { key: string; type: 'enum'; options: string[] }
    | { key: string; type: 'string' }
    | { key: string; type: 'number' };

  function specOf(raw: unknown): ControlSpec | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const spec = raw as Record<string, unknown>;
    if (spec.type === 'enum' && Array.isArray(spec.options) && spec.options.every((o) => typeof o === 'string')) {
      return { key: '', type: 'enum', options: spec.options as string[] };
    }
    if (spec.type === 'string') return { key: '', type: 'string' };
    if (spec.type === 'number') return { key: '', type: 'number' };
    return null;
  }

  function specFromSchema(schema: Record<string, unknown>): ControlSpec[] {
    const specs: ControlSpec[] = [];
    for (const [key, raw] of Object.entries(schema)) {
      const spec = specOf(raw);
      if (spec) specs.push({ ...spec, key });
    }
    return specs;
  }

  let controls = $state<ControlSpec[]>([]);
  let values = $state<Record<string, unknown>>({});

  // Rebuild the control values whenever the active story (or its meta) changes.
  $effect(() => {
    const story = activeStory;
    const specs = story?.schema ? specFromSchema(story.schema) : [];
    controls = specs;
    const base = { ...(story?.props ?? {}) };
    const next: Record<string, unknown> = { ...base };
    for (const s of specs) {
      const v = base[s.key];
      if (s.type === 'enum') next[s.key] = typeof v === 'string' && s.options.includes(v) ? v : (s.options[0] ?? '');
      else if (s.type === 'string') next[s.key] = typeof v === 'string' ? v : '';
      else next[s.key] = typeof v === 'number' ? v : 0;
    }
    values = next;
  });

  // ---------- preview iframe ----------
  let frame = $state<HTMLIFrameElement | undefined>();
  let frameSrc = $state<string | null>(null);
  let frameStory = $state<string | null>(null);
  let previewStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let previewMessage = $state('');

  /** Current merged props: meta.props overlaid with live control values. */
  function mergedProps(): Record<string, unknown> {
    return { ...(activeStory?.props ?? {}), ...values };
  }

  function postToFrame(msg: PreviewMessage): void {
    if (frame?.contentWindow) frame.contentWindow.postMessage(msg, '*');
  }

  // Keep the iframe pointed at the active story: first mount sets the src once
  // (the URL carries ?story=), later changes go through the setStory message so
  // the iframe document and its state stay alive.
  $effect(() => {
    const file = activeFile;
    if (!file || !snap) return;
    if (frameStory === file) return;
    if (frame?.contentWindow) {
      postToFrame({ type: 'setStory', storyId: file });
      frameStory = file;
      postToFrame({ type: 'setProps', props: mergedProps() });
    } else {
      frameSrc = `${env.preview.base}?story=${encodeURIComponent(file)}&theme=${theme}`;
      frameStory = file;
      previewStatus = 'loading';
      previewMessage = '';
    }
  });

  // Preview <-> shell protocol. The iframe is sandboxed (opaque origin), so its
  // messages carry e.origin 'null'; the unforgeable e.source === contentWindow
  // identity check is the gate, with the exact-origin check kept for non-null
  // origins in dev (per §4.6; build relies on the source check alone).
  $effect(() => {
    const expectedOrigin = env.dev ? new URL(env.preview.base, location.href).origin : null;
    const handler = (e: MessageEvent) => {
      if (e.source !== frame?.contentWindow) return;
      if (env.dev && e.origin !== 'null' && expectedOrigin !== null && e.origin !== expectedOrigin) return;
      if (e.data === null || typeof e.data !== 'object') return;
      const msg = e.data as Partial<PreviewMessage>;
      if (msg.type === 'ready') {
        previewStatus = 'ready';
        previewMessage = '';
        postToFrame({ type: 'setProps', props: mergedProps() });
        postToFrame({ type: 'setTheme', theme });
      } else if (msg.type === 'error') {
        previewStatus = 'error';
        previewMessage = typeof msg.message === 'string' ? msg.message : 'Unknown preview error';
      }
    };    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  // Push live theme changes to a ready frame; the boot theme rides in frameSrc.
  $effect(() => {
    if (frame && previewStatus === 'ready') {
      postToFrame({ type: 'setTheme', theme });
    }
  });

  /** Any control change pushes the current merged props to the preview. */
  function onControlChange(): void {
    postToFrame({ type: 'setProps', props: mergedProps() });
  }
</script>

<div class="view-body flex min-h-full">
  <Rail title={packageName} sub={version ? `v${version}` : undefined}>
    {#if snap}
      {#each railSections as section (section.group ?? section.stories[0].file)}
        {#if section.group === null}
          {#each section.stories as story (story.file)}
            <RailItem
              active={story.file === activeFile}
              mono
              data-ws="design"
              data-id={story.file}
              onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: story.file }))}
            >
              {story.title ?? basename(story.file)}
            </RailItem>
          {/each}
        {:else}
          <RailGroup
            ws="design"
            group={section.group}
            count={section.stories.length}
            collapsed={isCollapsed(railState, 'design', section.group)}
            onToggle={() =>
              (railState = setGroupCollapsed(
                railState,
                'design',
                section.group,
                !isCollapsed(railState, 'design', section.group),
              ))}
          >
            {#each section.stories as story (story.file)}
              <RailItem
                active={story.file === activeFile}
                mono
                data-ws="design"
                data-id={story.file}
                onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: story.file }))}
              >
                {story.title ?? basename(story.file)}
              </RailItem>
            {/each}
          </RailGroup>
        {/if}
      {/each}
    {/if}
  </Rail>

  <div class="min-w-0 flex-1">
    <div class="mx-auto w-full max-w-[1200px] px-8 pb-16 pt-6">
      <PageHeader
        title="Design System"
        meta={[packageName, version ? `v${version}` : undefined, `${snap?.stories.length ?? 0} stories`]}
      />
      {#if error}
        {@html errorPanel(error)}
      {:else if snap && activeStory}
        <div data-ws="design" data-id={activeStory.file}>
          <h2 class="text-[16px] font-semibold tracking-[-0.015em] text-foreground">
            {activeStory.title ?? basename(activeStory.file)}
          </h2>
          <p class="mt-0.5 font-mono text-[12.5px] text-muted-foreground">{activeStory.file}</p>

          <Tabs.Root value={tab} onValueChange={(v) => (tab = v as TabId)} class="mt-4">
            <Tabs.List>
              <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
              <Tabs.Trigger value="docs">Docs</Tabs.Trigger>
              <Tabs.Trigger value="code">Code</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="preview" class="mt-4">
              <div class="flex items-start gap-4">
                <Card class="min-w-0 flex-1 p-0 overflow-hidden">
                  {#if frameSrc}
                    <iframe
                      bind:this={frame}
                      class="block h-[clamp(380px,60vh,720px)] w-full border-0 bg-canvas"
                      sandbox="allow-scripts"
                      title={activeStory.title ? `${activeStory.title} preview` : 'Story preview'}
                      src={frameSrc}
                    ></iframe>
                    {#if previewStatus === 'loading'}
                      <p class="px-4 py-2 text-[11px] text-muted-foreground">Loading preview…</p>
                    {:else if previewStatus === 'error'}
                      <Alert variant="destructive" class="m-4 flex items-start gap-2">
                        <Badge variant="destructive">Preview error</Badge>
                        <p class="text-[11px] leading-snug">{previewMessage}</p>
                      </Alert>
                    {/if}
                  {/if}
                </Card>
                <div class="w-[240px] flex-none">
                  <div class="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-sm">
                    <div class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                      Props
                    </div>
                    {#if controls.length > 0}
                      {#each controls as c (c.key)}
                        <label class="flex flex-col gap-1.5">
                          <span class="text-[11.5px] font-medium text-secondary-foreground">{c.key}</span>
                          {#if c.type === 'enum'}
                            <Select.Root
                              type="single"
                              value={String(values[c.key] ?? '')}
                              onValueChange={(v) => {
                                values[c.key] = v;
                                onControlChange();
                              }}
                            >
                              <Select.Trigger class="w-full" aria-label={c.key}><Select.Value /></Select.Trigger>
                              <Select.Content>
                                <Select.Group>
                                  {#each c.options as opt (opt)}
                                    <Select.Item value={opt}>{opt}</Select.Item>
                                  {/each}
                                </Select.Group>
                              </Select.Content>
                            </Select.Root>
                          {:else if c.type === 'string'}
                            <Input
                              value={typeof values[c.key] === 'string' ? values[c.key] : ''}
                              oninput={(e) => {
                                values[c.key] = (e.currentTarget as HTMLInputElement).value;
                                onControlChange();
                              }}
                            />
                          {:else}
                            <Input
                              type="number"
                              value={typeof values[c.key] === 'number' ? values[c.key] : 0}
                              oninput={(e) => {
                                const n = (e.currentTarget as HTMLInputElement).valueAsNumber;
                                values[c.key] = Number.isFinite(n) ? n : 0;
                                onControlChange();
                              }}
                            />
                          {/if}
                        </label>
                      {/each}
                    {:else}
                      <p class="text-[11px] text-muted-foreground">No props schema for this story.</p>
                    {/if}
                  </div>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="docs" class="mt-4">
              <div class="flex max-w-[720px] flex-col gap-3.5">
                <p class="text-[12.5px] leading-snug text-muted-foreground">
                  {activeStory.description ?? 'No description.'}
                </p>
                {#if activeStory.schema !== undefined}
                  <div class="overflow-hidden rounded-lg border border-border bg-card">
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.Head class="font-semibold uppercase tracking-[0.06em] text-muted-foreground">Name</Table.Head>
                          <Table.Head class="font-semibold uppercase tracking-[0.06em] text-muted-foreground">Type</Table.Head>
                          <Table.Head class="font-semibold uppercase tracking-[0.06em] text-muted-foreground">Default</Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each Object.entries(activeStory.schema) as [key, spec] (key)}
                          <Table.Row>
                            <Table.Cell class="font-mono text-[11px]">{key}</Table.Cell>
                            <Table.Cell>
                              <code class="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] text-secondary-foreground">
                                {typeof spec === 'object' && spec !== null && 'type' in spec
                                  ? String((spec as { type: unknown }).type)
                                  : 'any'}
                              </code>
                            </Table.Cell>
                            <Table.Cell class="font-mono text-[11px] text-muted-foreground">
                              {activeStory.props?.[key] !== undefined ? String(activeStory.props[key]) : '—'}
                            </Table.Cell>
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  </div>
                {/if}
                {#if activeStory.props !== undefined || activeStory.schema !== undefined}
                  <div class="flex flex-col gap-3">
                    {#if activeStory.props !== undefined}
                      <div>
                        <div class="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">props</div>
                        <pre class="codeblock">{@html highlightJson(activeStory.props)}</pre>
                      </div>
                    {/if}
                    {#if activeStory.schema !== undefined}
                      <div>
                        <div class="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">schema</div>
                        <pre class="codeblock">{@html highlightJson(activeStory.schema)}</pre>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </Tabs.Content>
            <Tabs.Content value="code" class="mt-4">
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2.5">
                  <span class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">code</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-copy
                    data-copy-text={activeStory.code ?? ''}
                    disabled={!activeStory.code}
                  >
                    Copy
                  </Button>
                </div>
                <pre class="codeblock">{@html highlightCode(activeStory.code ?? '')}</pre>
                {#if !activeStory.code}
                  <p class="text-[11px] text-muted-foreground">No code sample for this story.</p>
                {/if}
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      {:else}
        <EmptyState message="No stories in this snapshot yet." />
      {/if}
    </div>
  </div>
</div>