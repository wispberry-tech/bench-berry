<script lang="ts">
	// EmptyState — registry Empty composition: warning icon (lucide) + message.
	// Replaces the four copy-pasted `.empty` blocks (App-level + one per workspace).
	import * as Empty from "$lib/components/ui/empty";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

	let { message }: { message: string } = $props();
</script>

<Empty.Root>
	<Empty.Header>
		<Empty.Media variant="icon">
			<TriangleAlert class="size-6" aria-hidden="true" />
		</Empty.Media>
		<Empty.Title class="max-w-[320px] text-center">{message}</Empty.Title>
	</Empty.Header>
</Empty.Root>