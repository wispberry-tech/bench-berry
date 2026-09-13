<script lang="ts">
	// Separator — bits-ui Separator; replaces the deleted `.divider` where a
	// rule is needed.
	import { Separator as SeparatorPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let { class: className, ...restProps }: SeparatorPrimitive.RootProps = $props();
</script>

<SeparatorPrimitive.Root
	class={cn(
		"shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
		className,
	)}
	{...restProps}
/>