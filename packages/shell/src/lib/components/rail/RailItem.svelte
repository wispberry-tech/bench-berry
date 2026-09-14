<script lang="ts">
	// RailItem — one rail row. Keeps the `rail-item` marker class (the
	// keyboard.ts ArrowUp/Down navigation queries `.view-body .rail
	// .rail-item`) plus the four slots: badge (snippet), icon (sprite id),
	// default children (content, e.g. a two-line mono column), count.
	import { cn } from "$lib/utils";
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	let {
		active = false,
		badge,
		icon,
		count,
		mono = false,
		twoLine = false,
		class: className,
		children,
		...restProps
	}: {
		active?: boolean;
		badge?: Snippet;
		icon?: string;
		count?: number | string;
		mono?: boolean;
		twoLine?: boolean;
		class?: string;
		children: Snippet;
	} & HTMLButtonAttributes = $props();
</script>

<button
	type="button"
	class={cn(
		"rail-item flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2.5 font-sans text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-primary",
		twoLine ? "min-h-8 py-1.5" : "h-8",
		className,
	)}
	data-active={active}
	{...restProps}
>
	{#if badge}
		{@render badge()}
	{/if}
	{#if icon}
		<svg class="size-3.5 flex-none text-muted-foreground" aria-hidden="true">
			<use href={'#' + icon} />
		</svg>
	{/if}
	<span
		class={cn(
			"flex min-w-0 flex-1 items-center gap-2",
			mono ? "font-mono text-[11.5px]" : "font-sans",
		)}
	>
		{@render children()}
	</span>
	{#if count !== undefined}
		<span class="flex-none text-[10.5px] tabular-nums text-muted-foreground/70">{count}</span>
	{/if}
</button>