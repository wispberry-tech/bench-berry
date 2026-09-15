<script lang="ts">
  // Command palette overlay ('.' keyboard shortcut + button in topbar). Built
  // on the registry Dialog + Command barrels: the dialog owns focus trapping,
  // Escape-to-close and scroll lock while the Command root owns query
  // filtering, arrow-key selection and Enter-to-run. Navigation happens in
  // App.navigate (hash change + palette close); '/' shortcuts are wired in
  // App via lib/keyboard.ts.
  import * as Command from '$lib/components/ui/command';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Separator } from '$lib/components/ui/separator';
  import type { Component } from 'svelte';
  import Box from '@lucide/svelte/icons/box';
  import Plug from '@lucide/svelte/icons/plug';
  import Database from '@lucide/svelte/icons/database';
  import { config } from './lib/store.svelte.ts';
  import { paletteItems, type PaletteItem } from './lib/palette.ts';

  let { open, onOpenChange, onclose, navigate } = $props<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onclose: () => void;
    navigate: (hash: string) => void;
  }>();

  // Sprite ids from lib/palette.ts mapped to lucide components.
  const ITEM_ICONS: Record<string, Component> = {
    'i-cube': Box,
    'i-plug': Plug,
    'i-db': Database,
  };

  // Reset the search box each time the palette re-opens.
  let query = $state('');
  $effect(() => {
    if (open) query = '';
  });

  const items = $derived(paletteItems(config));
  const groups = $derived(
    items.reduce<{ group: string; items: PaletteItem[] }[]>((acc, item) => {
      const last = acc[acc.length - 1];
      if (last?.group === item.group) last.items.push(item);
      else acc.push({ group: item.group, items: [item] });
      return acc;
    }, []),
  );

  function run(item: PaletteItem): void {
    navigate(item.hash);
    onclose();
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content
    class="w-[560px] max-w-[92vw] sm:max-w-[92vw] overflow-hidden p-0"
    showCloseButton={false}
  >
    <Dialog.Title class="sr-only">Command palette</Dialog.Title>
    <Command.Root class="p-0">
      <div class="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <Command.Input
          bind:value={query}
          class="min-w-0 flex-1 bg-transparent font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Type a command or search…"
        />
        <span class="kbd">esc</span>
      </div>
      <Command.List class="max-h-[330px] overflow-y-auto p-1.5">
        {#each groups as group (group.group)}
          <Command.Group
            value={group.group}
            heading={group.group}
            class="mb-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.08em] **:[[cmdk-group-heading]]:text-muted-foreground/70"
          >
            {#each group.items as item (item.label)}
              <Command.Item
                value={item.label}
                onSelect={() => run(item)}
                class="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-foreground"
              >
                {#if ITEM_ICONS[item.icon]}
                  {@const Icon = ITEM_ICONS[item.icon]}
                  <Icon class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
                {/if}
                <span class="min-w-0 flex-1 truncate">{item.label}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
        <Command.Empty class="px-7 py-7 text-center text-sm text-muted-foreground">
          No results for “{query}”
        </Command.Empty>
      </Command.List>
    </Command.Root>
    <Separator />
    <div class="flex items-center gap-3.5 px-4 py-2 text-xs text-muted-foreground">
      <span><span class="kbd">↑↓</span> navigate</span>
      <span><span class="kbd">↵</span> open</span>
      <span><span class="kbd">esc</span> close</span>
      <span class="ml-auto">BerryBench</span>
    </div>
  </Dialog.Content>
</Dialog.Root>