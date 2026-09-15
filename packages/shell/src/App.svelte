<script lang="ts">
  // Shell chrome: topbar (workspace dropdown, palette button with '/' hint),
  // main view area, palette overlay, settings route. Route state is derived
  // from location.hash + the live store; config/snapshot changes re-resolve so
  // disabled workspaces drop out and deep links redirect. Dark mode follows
  // the OS preference (prefers-color-scheme).
  import { config, snapshots } from './lib/store.svelte.ts';
  import { parseHash, resolve, hashFor, go, type Route } from './lib/router.ts';
  import { WORKSPACE_LABELS } from './lib/types.ts';
  import {
    systemTheme,
    watchSystemTheme,
    applyTheme,
    type ThemeName,
  } from './lib/theme.ts';
  import {
    handleGlobalKeydown,
    handleRailNavKeydown,
    handleCopyClick,
    type PaletteController,
  } from './lib/keyboard.ts';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import Command from '@lucide/svelte/icons/command';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import EmptyState from './lib/components/EmptyState.svelte';
  import Palette from './Palette.svelte';
  import Settings from './Settings.svelte';
  import Design from './workspaces/Design.svelte';
  import Api from './workspaces/Api.svelte';
  import Db from './workspaces/Db.svelte';

  let route = $state<Route>({ kind: 'workspace', ws: null });
  let paletteOpen = $state(false);
  let theme = $state<ThemeName>(systemTheme());

  // Live OS preference: theme re-resolves on system flips; the effect's
  // returned unsubscribe is Svelte's effect cleanup, so the listener is
  // disposed with the component.
  $effect(() => watchSystemTheme((t) => (theme = t)));
  $effect(() => {
    applyTheme(theme);
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

<div class="flex h-screen overflow-hidden bg-background text-foreground">
  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="flex flex-none items-center gap-3 border-b border-border bg-background px-3.5"
      style="height: var(--topbar-h)"
    >
      <Select.Root
        type="single"
        value={currentWs ?? ''}
        onValueChange={(v) => v && go(`#/${v}`)}
      >
        <Select.Trigger class="w-[220px]" aria-label="Workspace" title="Workspace">
          <Select.Value placeholder="Select workspace" />
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each enabledWorkspaces as id (id)}
              <Select.Item value={id}>{WORKSPACE_LABELS[id]}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <div class="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onclick={() => navigate('#/settings')}>
          <SettingsIcon class="size-4" />
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
          <Command class="size-4" />
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