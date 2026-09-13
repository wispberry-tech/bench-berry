<script lang="ts">
	// Checkbox — bits-ui Checkbox (shadcn anatomy). Used by story props
	// booleans; Settings toggles use the Switch instead.
	import { Checkbox as CheckboxPrimitive } from "bits-ui";
	import { cn } from "../../utils.ts";

	let {
		class: className,
		checked = $bindable(false),
		indeterminate = $bindable(false),
		...restProps
	}: CheckboxPrimitive.RootProps = $props();
</script>

<CheckboxPrimitive.Root
	class={cn(
		"peer grid size-4 shrink-0 place-content-center rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
		className,
	)}
	bind:checked
	bind:indeterminate
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		{#if checked}
			<svg class="size-3.5 text-current" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="m3 8.5 3.5 3.5L13 4.5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{:else if indeterminate}
			<svg class="size-3.5 text-current" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M4.5 8h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
			</svg>
		{/if}
	{/snippet}
</CheckboxPrimitive.Root>