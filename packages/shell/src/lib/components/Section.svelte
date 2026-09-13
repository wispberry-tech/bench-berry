<script lang="ts">
	// Section — the ONE uppercase micro-label + optional Card wrapper.
	// Replaces the seven copy-pasted section-title flavors.
	import Card from "./ui/card.svelte";
	import type { Snippet } from "svelte";

	let {
		title,
		card = false,
		actions,
		children,
		class: className,
	}: {
		title: string;
		card?: boolean;
		actions?: Snippet;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<section class={["flex flex-col gap-2.5", className].filter(Boolean).join(" ")}>
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
			{title}
		</h2>
		{#if actions}
			<div class="flex flex-none items-center gap-2">{@render actions()}</div>
		{/if}
	</div>
	{#if card}
		<Card class="p-4">{@render children()}</Card>
	{:else}
		{@render children()}
	{/if}
</section>