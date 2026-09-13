<script lang="ts">
	// CommandDialog — shadcn CommandDialog pattern: a Dialog hosting a Command
	// (bits-ui). The palette (src/Palette.svelte) renders its input/list/items
	// as children; bits-ui's Command owns arrow/enter/esc keyboard behaviour.
	import { Dialog, Command as CommandPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";

	let {
		open,
		onOpenChange,
		class: className,
		children,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 grid place-items-start justify-items-center bg-black/40 pt-[14vh] backdrop-blur-[2px]" />
		<Dialog.Content
			class={cn(
				"z-50 w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none",
				className,
			)}
		>
			<Dialog.Title class="sr-only">Command palette</Dialog.Title>
			<CommandPrimitive.Root class="flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
				{@render children?.()}
			</CommandPrimitive.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>