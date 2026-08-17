<script>
	// /home is gone; recording lives at /scouting, which is what the word means.
	//
	// A redirect rather than a deletion, because this app is an installed PWA. A
	// phone that has not reloaded still holds a bundle whose nav points here, and
	// a scout who opens it on the morning of an event must not get a 404 for a
	// route we moved for tidiness.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	$effect(() => {
		goto(`${base}/scouting/`, { replaceState: true });
	});
</script>

<p class="wait">Scouting moved here. Taking you there…</p>

<style>
	.wait {
		margin: var(--space-6) auto;
		max-width: 32rem;
		padding: 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
