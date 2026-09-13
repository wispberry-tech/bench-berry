<script lang="ts">
	// PageHeader — the single workspace page header: title + optional meta
	// line (joined with ' · ') and an actions slot. Replaces the duplicated
	// `.vh-title`/`.vh-sub` markup and the per-workspace punctuation.
	import type { Snippet } from "svelte";

	function joinMeta(parts: (string | undefined)[]): string {
		return parts.filter((p) => p !== undefined && p !== "").join(" · ");
	}

	let {
		title,
		sub,
		meta = [],
		actions,
	}: {
		title: string;
		sub?: string;
		meta?: (string | undefined)[];
		actions?: Snippet;
	} = $props();
</script>

<div class="mb-5 flex items-start gap-4">
	<div class="min-w-0">
		<h1 class="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
		{#if meta.length > 0 || sub}
			<p class="mt-1 max-w-[640px] text-[12.5px] leading-snug text-muted-foreground">
				{joinMeta(meta)}{sub ? sub : ""}
			</p>
		{/if}
	</div>
	{#if actions}
		<div class="ml-auto flex flex-none flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</div>