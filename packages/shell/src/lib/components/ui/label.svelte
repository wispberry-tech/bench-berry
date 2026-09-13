<script lang="ts">
	// Label — shadcn Label (bits-ui), replaces `.field-label`.
	import { Label as LabelPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let { class: className, ...restProps }: LabelPrimitive.RootProps = $props();
</script>

<LabelPrimitive.Root
	class={cn(
		"select-none text-xs font-medium leading-none text-secondary-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
		className,
	)}
	{...restProps}
/>