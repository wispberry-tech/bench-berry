<script lang="ts">
	// Command — bits-ui Command root (cmdk-style), used by the palette.
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let { class: className, ...restProps }: CommandPrimitive.RootProps = $props();
</script>

<CommandPrimitive.Root
	class={cn(
		"flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
		className,
	)}
	{...restProps}
/>