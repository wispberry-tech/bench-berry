<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let { class: className, ...restProps }: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	class={cn("flex items-center gap-1 border-b border-border", className)}
	{...restProps}
/>