<script lang="ts">
	// Select — STYLED NATIVE <select> (deliberately not the bits-ui Select:
	// the shell is a dense tool UI where native menus are more predictable).
	// Replaces `.tb-ws select`, `.select` and the data-URI chevron hacks —
	// the chevron is an inline SVG stroke="currentColor" so it re-themes.
	import { cn } from "../../utils.ts";
	import type { Snippet } from "svelte";
	import type { HTMLSelectAttributes } from "svelte/elements";

	type Props = HTMLSelectAttributes & { class?: string; children?: Snippet };

	let { class: className, children, value = $bindable(), ...restProps }: Props = $props();
</script>

<span class={cn("relative inline-flex items-center", className)}>
	<select
		class="h-8 w-full cursor-pointer appearance-none rounded-md border border-input bg-secondary pl-3 pr-8 font-sans text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring"
		bind:value
		{...restProps}
	>
		{@render children?.()}
	</select>
	<svg
		class="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
		viewBox="0 0 16 16"
		fill="none"
		aria-hidden="true"
	>
		<path
			d="m4 6 4 4 4-4"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</span>