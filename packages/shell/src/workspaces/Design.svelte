<script lang="ts">
  // Design System workspace (§4.6): stories rail (title or file basename) +
  // live component preview pane. The pane shows Preview | Docs | Code tabs per
  // story. Preview embeds the story in a sandboxed iframe pointed at the
  // preview bundle (?story=<file>) and drives it with the §4.6 postMessage
  // protocol: setStory on rail/deep-link changes, setProps from the schema
  // controls column; ready/error messages flip the loading/error state.
  import { snapshots, env } from '../lib/store.svelte.ts';
  import { isDesignSnapshot, isSnapshotError, type PreviewMessage } from '../lib/types.ts';
  import { basename, errorPanel } from '../lib/markup.ts';
  import { hashFor, type Route } from '../lib/router.ts';

  let { route, navigate } = $props<{
    route: Route;
    navigate: (hash: string) => void;
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
      frameSrc = `${env.preview.base}?story=${encodeURIComponent(file)}`;
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
      } else if (msg.type === 'error') {
        previewStatus = 'error';
        previewMessage = typeof msg.message === 'string' ? msg.message : 'Unknown preview error';
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  /** Any control change pushes the current merged props to the preview. */
  function onControlChange(): void {
    postToFrame({ type: 'setProps', props: mergedProps() });
  }

  function pretty(v: unknown): string {
    return JSON.stringify(v, null, 2);
  }
</script>

<div class="view-body">
  <aside class="rail" data-ws="design">
    <div class="rail-head">
      <div class="rail-title">{packageName}</div>
      {#if version}
        <div class="rail-sub">v{version}</div>
      {/if}
    </div>
    {#if snap}
      <div class="rail-group">Stories</div>
      {#each snap.stories as story (story.file)}
        <button
          class="rail-item"
          class:active={story.file === activeFile}
          type="button"
          data-ws="design"
          data-id={story.file}
          onclick={() => navigate(hashFor({ kind: 'workspace', ws: 'design', key: 'comp', id: story.file }))}
        >
          <span class="mono">{story.title ?? basename(story.file)}</span>
        </button>
      {/each}
    {/if}
  </aside>

  <div class="view-content">
    <div class="view-head">
      <div>
        <div class="vh-title">Design System</div>
        <div class="vh-sub">{packageName}{version ? ` v${version}` : ''} — stories rendered from the latest snapshot.</div>
      </div>
    </div>
    {#if error}
      {@html errorPanel(error)}
    {:else if snap && activeStory}
      <div class="v-ds-pane" data-ws="design" data-id={activeStory.file}>
        <div class="v-ds-docs-title">{activeStory.title ?? basename(activeStory.file)}</div>
        <div class="v-ds-docs-sub"><span class="mono">{activeStory.file}</span></div>

        <div class="tabs v-ds-tabs">
          <button class="tab" class:active={tab === 'preview'} type="button" onclick={() => (tab = 'preview')}>Preview</button>
          <button class="tab" class:active={tab === 'docs'} type="button" onclick={() => (tab = 'docs')}>Docs</button>
          <button class="tab" class:active={tab === 'code'} type="button" onclick={() => (tab = 'code')}>Code</button>
        </div>

        <div class="v-ds-tabpane" class:active={tab === 'preview'}>
          <div class="v-ds-preview">
            <div class="v-ds-preview-main">
              {#if frameSrc}
                <iframe
                  bind:this={frame}
                  class="preview-frame"
                  sandbox="allow-scripts"
                  title={activeStory.title ? `${activeStory.title} preview` : 'Story preview'}
                  src={frameSrc}
                ></iframe>
                {#if previewStatus === 'loading'}
                  <div class="hint v-ds-preview-note">Loading preview…</div>
                {:else if previewStatus === 'error'}
                  <div class="v-ds-preview-err">
                    <span class="badge badge-danger">Preview error</span>
                    <p class="hint">{previewMessage}</p>
                  </div>
                {/if}
              {/if}
            </div>
            {#if controls.length > 0}
              <div class="v-ds-controls">
                <div class="v-ds-controls-title">Props</div>
                {#each controls as c (c.key)}
                  <label class="field">
                    <span class="field-label">{c.key}</span>
                    {#if c.type === 'enum'}
                      <select
                        class="select"
                        value={String(values[c.key] ?? '')}
                        onchange={(e) => {
                          values[c.key] = (e.currentTarget as HTMLSelectElement).value;
                          onControlChange();
                        }}
                      >
                        {#each c.options as opt (opt)}
                          <option value={opt}>{opt}</option>
                        {/each}
                      </select>
                    {:else if c.type === 'string'}
                      <input
                        class="input"
                        value={typeof values[c.key] === 'string' ? values[c.key] : ''}
                        oninput={(e) => {
                          values[c.key] = (e.currentTarget as HTMLInputElement).value;
                          onControlChange();
                        }}
                      />
                    {:else}
                      <input
                        class="input"
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
              </div>
            {:else}
              <div class="v-ds-controls v-ds-controls-empty">
                <div class="v-ds-controls-title">Props</div>
                <p class="hint">No props schema for this story.</p>
              </div>
            {/if}
          </div>
        </div>

        <div class="v-ds-tabpane" class:active={tab === 'docs'}>
          <div class="v-ds-docs">
            <p class="v-ds-docs-desc">{activeStory.description ?? 'No description.'}</p>
            {#if activeStory.props !== undefined || activeStory.schema !== undefined}
              <div class="v-ds-docs-json">
                {#if activeStory.props !== undefined}
                  <div>
                    <div class="v-ds-docs-json-title">props</div>
                    <pre class="codeblock">{pretty(activeStory.props)}</pre>
                  </div>
                {/if}
                {#if activeStory.schema !== undefined}
                  <div>
                    <div class="v-ds-docs-json-title">schema</div>
                    <pre class="codeblock">{pretty(activeStory.schema)}</pre>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <div class="v-ds-tabpane" class:active={tab === 'code'}>
          <div class="v-ds-code-head">
            <span class="v-ds-docs-json-title">code</span>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              data-copy
              data-copy-text={activeStory.code ?? ''}
              disabled={!activeStory.code}
            >
              Copy
            </button>
          </div>
          <pre class="codeblock">{activeStory.code ?? ''}</pre>
          {#if !activeStory.code}
            <p class="hint">No code sample for this story.</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty">
        <p>No stories in this snapshot yet.</p>
      </div>
    {/if}
  </div>
</div>