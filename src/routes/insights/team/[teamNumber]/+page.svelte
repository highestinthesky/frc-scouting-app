<script>
	// A team page moved into Studio in v0.73, and this one carries its parameter
	// across rather than dropping the reader at the top of Insights — a bookmark
	// to team 254 should still land on team 254.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	$effect(() => {
		const n = page.params.teamNumber;
		goto(`${base}/studio/insights/team/${n}/`, { replaceState: true });
	});
</script>

<p class="wait">This team moved into Studio. Taking you there…</p>

<style>
	.wait {
		margin: var(--space-6) auto;
		max-width: 32rem;
		padding: 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
