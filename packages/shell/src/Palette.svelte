<script lang="ts">
  // Command palette overlay: filter input + grouped items from lib/palette.ts.
  // ArrowUp/Down move the selection, Enter/click run the item, Esc closes
  // (Escape + Ctrl/Cmd+K are handled globally in App).
  import { config } from './lib/store.svelte.ts';
  import { paletteItems, filterPaletteItems, type PaletteItem } from './lib/palette.ts';

  let { onclose, navigate, toggleTheme } = $props<{
    onclose: () => void;
    navigate: (hash: string) => void;
    toggleTheme: () => void;
  }>();

  let query = $state('');
  let selected = $state(0);

  const items = $derived(filterPaletteItems(paletteItems(config), query));
  const groups = $derived(
    items.reduce<{ group: string; items: PaletteItem[] }[]>((acc, item) => {
      const last = acc[acc.length - 1];
      if (last?.group === item.group) last.items.push(item);
      else acc.push({ group: item.group, items: [item] });
      return acc;
    }, []),
  );

  function onInput(e: Event): void {
    query = (e.currentTarget as HTMLInputElement).value;
    selected = 0;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n === 0) return;
      if (e.key === 'ArrowDown') selected = (selected + 1) % n;
      else selected = (selected - 1 + n) % n;
      const el = document.querySelector<HTMLElement>('.palette-item.selected');
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selected];
      if (item) run(item);
    }
  }

  function run(item: PaletteItem): void {
    if (item.action === 'navigate' && item.hash) navigate(item.hash);
    else if (item.action === 'toggle-theme') toggleTheme();
    onclose();
  }
</script>

<div
  class="palette-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Command palette"
  tabindex="-1"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <div class="palette">
    <div class="palette-input">
      <svg class="icon"><use href="#i-search"/></svg>
      <input
        type="text"
        placeholder="Type a command or search…"
        autocomplete="off"
        value={query}
        oninput={onInput}
        onkeydown={onKeydown}
      />
      <span class="kbd">esc</span>
    </div>
    <div class="palette-list">
      {#each groups as group (group.group)}
        <div class="palette-group">{group.group}</div>
        {#each group.items as item (item.label + item.action)}
          <div
            class="palette-item"
            class:selected={items.indexOf(item) === selected}
            role="button"
            tabindex="-1"
            onclick={() => run(item)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                run(item);
              }
            }}
          >
            <svg class="icon"><use href={'#' + item.icon}/></svg>
            <span>{item.label}</span>
          </div>
        {/each}
      {/each}
      {#if items.length === 0}
        <div class="palette-empty">No results for “{query}”</div>
      {/if}
    </div>
    <div class="palette-foot">
      <span><span class="kbd">↑↓</span> navigate</span>
      <span><span class="kbd">↵</span> open</span>
      <span><span class="kbd">esc</span> close</span>
      <span style="margin-left:auto">BerryBench · palette</span>
    </div>
  </div>
</div>