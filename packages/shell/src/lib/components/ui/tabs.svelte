<script lang="ts">
	// Tabs — bits-ui Tabs, underline style (matches the legacy `.tabs`).
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let { class: className, ...restProps }: TabsPrimitive.RootProps = $props();
</script>

<TabsPrimitive.Root class={cn("w-full", className)} {...restProps} />