<script lang="ts">
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: Snippet };

	let { class: className, children, ...restProps }: Props = $props();
</script>

<td class={cn("px-3 py-2 align-middle text-foreground", className)} {...restProps}>
	{@render children?.()}
</td>