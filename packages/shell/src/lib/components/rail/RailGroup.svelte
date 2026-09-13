<script lang="ts">
	// RailGroup — collapsible rail group header (chevron + name + count) with
	// a children slot of RailItems. Collapse state is CONTROLLED by the
	// workspace via railState (persisted, auto-expanded for the active item).
	// A plain button + conditional render: when collapsed the items simply
	// unmount, so hidden rail items never receive keyboard focus.
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";

	let {
		ws,
		group,
		count,
		collapsed,
		onToggle,
		children,
		class: className,
	}: {
		ws: string;
		group: string;
		count?: number;
		collapsed: boolean;
		onToggle: () => void;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div class={cn("flex flex-col", className)} data-ws={ws}>
	<button
		type="button"
		class="rail-group-btn flex w-full cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-4 pb-1.5 pt-3 font-sans text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 outline-none transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground"
		aria-expanded={!collapsed}
		onclick={() => onToggle()}
	>
		<svg
			class="size-[11px] flex-none text-muted-foreground/70 transition-transform duration-150 {collapsed
				? '-rotate-90'
				: ''}"
			aria-hidden="true"
		>
			<use href="#i-chevron-down" />
		</svg>
		<span class="min-w-0 flex-1 truncate">{group}</span>
		{#if count !== undefined}
			<span class="flex-none tabular-nums">{count}</span>
		{/if}
	</button>
	{#if !collapsed}
		<div class="flex flex-col">{@render children()}</div>
	{/if}
</div>