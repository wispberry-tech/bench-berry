<script lang="ts">
  // Command palette overlay ('.' keyboard shortcut + button in topbar). Built
  // on the bits-ui Command primitives via the shell's own ui/ command-dialog:
  // the dialog owns focus trapping, Escape-to-close and scroll lock while the
  // Command root owns query filtering, arrow-key selection and Enter-to-run.
  // Navigation happens in App.navigate (hash change + palette close); '/'
  // shortcuts are wired in App via lib/keyboard.ts.
  import { Command } from 'bits-ui';
  import { config } from './lib/store.svelte.ts';
  import { paletteItems, type PaletteItem } from './lib/palette.ts';
  import CommandDialog from './lib/components/ui/command-dialog.svelte';

  let { open, onOpenChange, onclose, navigate } = $props<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onclose: () => void;
    navigate: (hash: string) => void;
  }>();

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

<CommandDialog {open} {onOpenChange}>
  <div class="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
    <svg class="size-4 flex-none text-muted-foreground" aria-hidden="true"><use href="#i-search" /></svg>
    <Command.Input
      bind:value={query}
      class="h-6 min-w-0 flex-1 bg-transparent font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground"
      placeholder="Type a command or search…"
    />
    <span class="kbd">esc</span>
  </div>
  <Command.List class="max-h-[330px] overflow-y-auto p-1.5">
    {#each groups as group (group.group)}
      <Command.Group value={group.group} class="mb-1">
        <Command.GroupHeading
          class="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70"
        >
          {group.group}
        </Command.GroupHeading>
        {#each group.items as item (item.label)}
          <Command.Item
            value={item.label}
            onSelect={() => run(item)}
            class="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground outline-none hover:bg-accent-soft hover:text-foreground data-[selected=true]:bg-accent-soft data-[selected=true]:text-foreground"
          >
            <svg class="size-3.5 flex-none text-muted-foreground" aria-hidden="true"><use href={'#' + item.icon} /></svg>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/each}
    <Command.Empty class="px-7 py-7 text-center text-[12.5px] text-muted-foreground">
      No results for “{query}”
    </Command.Empty>
  </Command.List>
  <div class="flex items-center gap-3.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
    <span><span class="kbd">↑↓</span> navigate</span>
    <span><span class="kbd">↵</span> open</span>
    <span><span class="kbd">esc</span> close</span>
    <span class="ml-auto">BerryBench</span>
  </div>
</CommandDialog>