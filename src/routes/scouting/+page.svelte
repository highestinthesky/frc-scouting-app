<script>
	// Scouting folded into Home in v0.82. A redirect rather than a deletion,
	// because this is an installed PWA: a phone that has not reloaded still holds
	// a bundle whose tab bar points here, and a scout who opens it on the morning
	// of an event must not get a 404 for a route moved for tidiness.
	//
	// /scouting/new and /scouting/edit are untouched — the entry form was never
	// the duplicated part. Only this page, which was a list of what the scout had
	// already done under a second copy of Home's own answers, has gone.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	$effect(() => {
		goto(`${base}/home/`, { replaceState: true });
	});
</script>

<p class="wait">Your entries are on Home now. Taking you there…</p>

<style>
	.wait {
		margin: var(--space-6) auto;
		max-width: 32rem;
		padding: 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
