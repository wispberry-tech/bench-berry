<script lang="ts">
	// Badge — vendored from the shadcn-svelte registry (MIT), extended with the
	// shell's success/warning/info status variants. Replaces `.badge*` incl.
	// the Api method chips (methodTone maps verb -> variant in markup.ts).
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLSpanAttributes } from "svelte/elements";

	export const badgeVariants = tv({
		base: "inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none [&_svg]:size-[11px]",
		variants: {
			variant: {
				default: "border-primary bg-primary text-primary-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				success: "border-success-border bg-success-bg text-success",
				warning: "border-warning-border bg-warning-bg text-warning",
				destructive: "border-transparent bg-destructive text-destructive-foreground",
				info: "border-info-border bg-info-bg text-info",
				outline: "border-input text-secondary-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

	type Props = HTMLSpanAttributes & {
		variant?: BadgeVariant;
		class?: string;
		children?: Snippet;
	};

	let { class: className, variant = "default", children, ...restProps }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...restProps}>
	{@render children?.()}
</span>