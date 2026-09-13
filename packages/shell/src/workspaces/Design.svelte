<script lang="ts">
  // Design System workspace: stories rail (title or file basename) + pane
  // showing title, file path and a copy button; header shows packageName +
  // version from the snapshot.
  import { snapshots } from '../lib/store.svelte.ts';
  import { isDesignSnapshot, isSnapshotError } from '../lib/types.ts';
  import { basename, designPane, errorPanel } from '../lib/markup.ts';
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

  const packageName = $derived(snap?.packageName ?? 'Design System');
  const version = $derived(snap?.version);
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
    {:else if snap && activeFile}
      {@html designPane(snap, activeFile)}
    {:else}
      <div class="empty">
        <p>No stories in this snapshot yet.</p>
      </div>
    {/if}
  </div>
</div>