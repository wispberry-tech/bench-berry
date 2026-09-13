<script lang="ts">
	// EmptyState — centered warning icon + message. Replaces the four
	// copy-pasted `.empty` blocks (App-level + one per workspace).
	let { message }: { message: string } = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
	<svg class="size-7 text-muted-foreground/40" style="stroke-width: 1.2" aria-hidden="true">
		<use href="#i-warn" />
	</svg>
	<p class="text-[12.5px] text-muted-foreground">{message}</p>
</div>