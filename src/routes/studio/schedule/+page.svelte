<script>
	// Schedule was seven panels; when Studio folded into the app they split into
	// Plan (Schedule, Assignments) and Run (Matches, Scouts). Run › Matches is the
	// one a manager opened this page for during an event.
	//
	// A redirect rather than a deletion, because this app is an installed PWA: a
	// phone that has not reloaded still holds a bundle whose links point here,
	// and a manager who opens it on the morning of an event must not get a 404
	// for a route that moved for tidiness.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	$effect(() => {
		goto(`${base}/studio/run/matches/`, { replaceState: true });
	});
</script>

<p class="wait">This page moved. Taking you there…</p>

<style>
	.wait {
		margin: var(--space-6) auto;
		max-width: 32rem;
		padding: 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
