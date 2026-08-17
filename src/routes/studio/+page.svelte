<script>
	// /studio has no content of its own — it is the tab group's root. Redirect to
	// the first tab so a bookmark or a typed URL lands somewhere real rather than
	// on an empty shell.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	$effect(() => {
		goto(`${base}/studio/event/`, { replaceState: true });
	});
</script>

<p class="wait">Opening Studio…</p>

<style>
	.wait {
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
