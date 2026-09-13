<script lang="ts">
	// Alert — variants default | destructive; replaces the errorPanel
	// presentation and the settings note. Icon lives in the children slot.
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	const alert = tv({
		base: "relative w-full rounded-lg border px-4 py-3 text-sm",
		variants: {
			variant: {
				default: "border-border bg-card text-card-foreground",
				destructive: "border-destructive/40 bg-destructive/10 text-destructive",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	type Props = HTMLAttributes<HTMLDivElement> & {
		variant?: VariantProps<typeof alert>["variant"];
		class?: string;
		children?: Snippet;
	};

	let { class: className, variant = "default", children, ...restProps }: Props = $props();
</script>

<div class={cn(alert({ variant }), className)} {...restProps}>
	{@render children?.()}
</div>