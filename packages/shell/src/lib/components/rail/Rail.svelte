<script lang="ts">
	// Rail — workspace sidebar shell: fixed 238px column with an optional
	// header (title + sub). Children are RailGroups/RailItems.
	import type { Snippet } from "svelte";

	let { title, sub, children }: { title?: string; sub?: string; children: Snippet } = $props();
</script>

<aside
	class="rail flex w-[238px] flex-none flex-col overflow-y-auto border-r border-border bg-secondary/40"
>
	{#if title}
		<div class="border-b border-border/60 px-4 pb-3 pt-[18px]">
			<div class="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
				{title}
			</div>
			{#if sub}
				<div class="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
			{/if}
		</div>
	{/if}
	{@render children()}
</aside>