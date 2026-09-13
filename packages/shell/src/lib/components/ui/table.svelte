<script lang="ts">
	// Table — shadcn Table anatomy wrapped in a rounded bordered container
	// (the dbdocs-style look). Defaults: header row bg-muted/50 + uppercase
	// micro labels, body rows separated by border-b.
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLDivElement> & { class?: string; children?: Snippet };

	let { class: className, children, ...restProps }: Props = $props();
</script>

<div
	class={cn("w-full overflow-hidden rounded-lg border border-border bg-card", className)}
	{...restProps}
>
	<table class="w-full border-collapse text-xs">
		{@render children?.()}
	</table>
</div>