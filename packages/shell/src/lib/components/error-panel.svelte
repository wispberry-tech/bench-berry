<script lang="ts">
	// ErrorPanel — registry Alert composition: destructive alert with a
	// triangle icon, shown when a workspace snapshot is missing/unparseable.
	// Shared migration contract for Api/Db/Design: prop is `message`.
	import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

	let { message }: { message: string } = $props();
</script>

<Alert variant="destructive" data-ws="error">
	<TriangleAlert aria-hidden="true" />
	<AlertTitle>{message}</AlertTitle>
	<AlertDescription>No snapshot data is available for this workspace.</AlertDescription>
</Alert>
