<script lang="ts">
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLTableRowElement> & { class?: string; children?: Snippet };

	let { class: className, children, ...restProps }: Props = $props();
</script>

<tr class={cn("border-b border-border transition-colors", className)} {...restProps}>
	{@render children?.()}
</tr>