<script lang="ts">
  // Shell chrome: topbar (workspace dropdown, palette button with '/' hint),
  // main view area, palette overlay, settings route. Route state is derived
  // from location.hash + the live store; config/snapshot changes re-resolve so
  // disabled workspaces drop out and deep links redirect. Dark mode follows
  // the OS preference (prefers-color-scheme); the accent tracks config.
  import { config, snapshots } from './lib/store.svelte.ts';
  import { parseHash, resolve, hashFor, go, type Route } from './lib/router.ts';
  import { WORKSPACE_LABELS } from './lib/types.ts';
  import {
    systemTheme,
    watchSystemTheme,
    applyTheme,
    isKnownAccent,
    DEFAULT_ACCENT,
    type ThemeName,
  } from './lib/theme.ts';
  import {
    handleGlobalKeydown,
    handleRailNavKeydown,
    handleCopyClick,
    type PaletteController,
  } from './lib/keyboard.ts';
  import Button from './lib/components/ui/button.svelte';
  import Select from './lib/components/ui/select.svelte';
  import EmptyState from './lib/components/EmptyState.svelte';
  import Palette from './Palette.svelte';
  import Settings from './Settings.svelte';
  import Design from './workspaces/Design.svelte';
  import Api from './workspaces/Api.svelte';
  import Db from './workspaces/Db.svelte';

  let route = $state<Route>({ kind: 'workspace', ws: null });
  let paletteOpen = $state(false);
  let theme = $state<ThemeName>(systemTheme());
  const accent = $derived(
    isKnownAccent(config.theme?.accent ?? '') ? config.theme!.accent! : DEFAULT_ACCENT,
  );

  // Live OS preference: theme re-resolves on system flips; the effect's
  // returned unsubscribe is Svelte's effect cleanup, so the listener is
  // disposed with the component.
  $effect(() => watchSystemTheme((t) => (theme = t)));
  $effect(() => {
    applyTheme(theme, accent);
  });

  const enabledWorkspaces = $derived(
    (['design', 'api', 'db'] as const).filter((id) => config.workspaces[id]?.enabled === true),
  );

  function syncRoute(): void {
    const r = resolve(parseHash(location.hash), config, snapshots);
    if (r.kind === 'workspace' && r.ws !== null) {
      // Deep-link redirects (disabled ws, unknown id) use replaceState so they
      // do not spam history.
      const want = hashFor(r);
      if (location.hash !== want) history.replaceState(null, '', want);
    }
    route = r;
  }

  // Re-resolve whenever the store changes (HMR or dev write-back).
  $effect(() => {
    void config.workspaces;
    void snapshots;
    syncRoute();
  });

  const paletteCtl: PaletteController = {
    open: () => (paletteOpen = true),
    close: () => (paletteOpen = false),
    isOpen: () => paletteOpen,
  };

  function onKeydown(e: KeyboardEvent): void {
    handleGlobalKeydown(e, paletteCtl);
    handleRailNavKeydown(e);
  }

  function onClick(e: MouseEvent): void {
    handleCopyClick(e);
  }

  function navigate(hash: string): void {
    paletteOpen = false;
    go(hash, syncRoute);
  }

  const currentWs = $derived(route.kind === 'workspace' ? route.ws : null);
</script>

<svelte:window onkeydown={onKeydown} onclick={onClick} onhashchange={syncRoute} />

<!-- icon sprite (subset of the mockup's symbol set) -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-search" viewBox="0 0 16 16"><path d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm4.5 8.7 3 3.05" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
    <symbol id="i-command" viewBox="0 0 16 16"><path d="M5.5 3.5A2 2 0 1 0 3.5 5.5h9a2 2 0 1 0-2-2c0 1.104.896 2 2 2v1a2 2 0 1 0 2 2c0 1.104-.896 2-2 2a2 2 0 1 0-2 2 2 2 0 1 0-2-2v-1a2 2 0 1 0-2 2 2 2 0 1 0-2-2v1c0-1.104-.896-2-2-2 0 1.104-.896 2-2 2a2 2 0 1 0-2-2 2 2 0 1 0 2-2h-1c1.104 0 2-.896 2-2 0 1.104.896 2 2 2h1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-chevron-down" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-cube" viewBox="0 0 16 16"><path d="M8 1.5 13.5 4.5v7L8 14.5 2.5 11.5v-7L8 1.5Zm0 0v6.2m5.5-2.7L8 7.7l-5.5-2.7M8 13.7V7.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></symbol>
    <symbol id="i-plug" viewBox="0 0 16 16"><path d="M9.5 2.5V6h4M9.5 2.5h-3M9.5 6c0 .8-.3 1.5-.8 2.1L6 11.1a2.8 2.8 0 1 1-2.1-2.1l3-2.7c.6-.5 1.3-.8 2.1-.8h4a1 1 0 0 1 1 1v0M7 12.5V15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-db" viewBox="0 0 16 16"><ellipse cx="8" cy="3.8" rx="5.5" ry="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 3.8v8.4c0 1.27 2.46 2.3 5.5 2.3s5.5-1.03 5.5-2.3V3.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8c0 1.27 2.46 2.3 5.5 2.3s5.5-1.03 5.5-2.3" fill="none" stroke="currentColor" stroke-width="1.4"/></symbol>
    <symbol id="i-table" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5h12M2 9.5h12M6.5 6.5v7M10 6.5v7" fill="none" stroke="currentColor" stroke-width="1.3"/></symbol>
    <symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-1.5a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 10.5h1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></symbol>
    <symbol id="i-check" viewBox="0 0 16 16"><path d="m3 8.5 3.5 3.5L13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-settings" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.8v1.6m0 9.2v1.6M1.8 8h1.6m9.2 0h1.6M3.6 3.6l1.1 1.1m6.6 6.6 1.1 1.1m0-8.8-1.1 1.1M4.7 11.3l-1.1 1.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>
    <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 1.8 14.5 13.7H1.5L8 1.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.5v3.2m0 2v.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>
  </defs>
</svg>

<div class="flex h-screen overflow-hidden bg-background text-foreground">
  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="flex flex-none items-center gap-3 border-b border-border bg-background px-3.5"
      style="height: var(--topbar-h)"
    >
      <Select
        class="w-[220px]"
        title="Workspace"
        value={currentWs ?? ''}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v) navigate(hashFor({ kind: 'workspace', ws: v as 'design' | 'api' | 'db' }));
        }}
      >
        {#if currentWs === null}
          <option value="" disabled>—</option>
        {/if}
        {#each enabledWorkspaces as id (id)}
          <option value={id}>{WORKSPACE_LABELS[id]}</option>
        {/each}
      </Select>
      <div class="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onclick={() => navigate('#/settings')}>
          <svg class="size-4"><use href="#i-settings"/></svg>
          Settings
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="gap-1"
          aria-label="Open command palette"
          title="Open command palette (/)"
          onclick={() => (paletteOpen = true)}
        >
          <svg class="size-4"><use href="#i-command"/></svg>
          <span class="kbd">/</span>
        </Button>
      </div>
    </header>

    <main class="relative flex-1 overflow-y-auto">
      {#if route.kind === 'settings'}
        <Settings />
      {:else if route.ws === null || enabledWorkspaces.length === 0}
        <EmptyState message="No workspaces enabled. Open Settings to enable design, api, or db." />
      {:else if route.ws === 'design'}
        <Design {route} navigate={navigate} theme={theme} />
      {:else if route.ws === 'api'}
        <Api {route} navigate={navigate} />
      {:else if route.ws === 'db'}
        <Db {route} navigate={navigate} />
      {/if}
    </main>
  </div>
</div>

{#if paletteOpen}
  <Palette
    open={paletteOpen}
    onOpenChange={(o) => (paletteOpen = o)}
    onclose={() => (paletteOpen = false)}
    navigate={navigate}
  />
{/if}