<script lang="ts">
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: Snippet };

	let { class: className, children, ...restProps }: Props = $props();
</script>

<th
	class={cn(
		"h-8 whitespace-nowrap px-3 text-left align-middle text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground border-b border-border",
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</th>