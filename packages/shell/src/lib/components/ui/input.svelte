<script lang="ts">
	// Input — shadcn Input, replaces `.input`.
	import { cn } from "../../utils.ts";
	import type { HTMLInputAttributes } from "svelte/elements";

	type Props = HTMLInputAttributes & { class?: string };

	let { class: className, ...restProps }: Props = $props();
</script>

<input
	class={cn(
		"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
		className,
	)}
	{...restProps}
/>