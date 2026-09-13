<script lang="ts">
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLTableSectionElement> & { class?: string; children?: Snippet };

	let { class: className, children, ...restProps }: Props = $props();
</script>

<thead class={cn("bg-muted/50", className)} {...restProps}>
	{@render children?.()}
</thead>