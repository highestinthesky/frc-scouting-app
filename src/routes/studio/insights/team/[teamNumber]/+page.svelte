<script>
	// Moved to /studio/<eventCode>/team/<teamNumber> when the event went into the
	// URL. A redirect rather than a deletion, for the reason /insights already
	// establishes: this is an installed PWA, and a phone that has not reloaded
	// still holds a bundle whose links point here. A manager opening it on the
	// morning of an event must not get a 404 for a route we moved.
	//
	// The event comes from the session, which is what this page was implicitly
	// using anyway — except it was pooling every OTHER event into the same
	// numbers without saying so.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { session } from '$lib/session.svelte.js';

	$effect(() => {
		const team = page.params.teamNumber;
		const code = (session.eventCode ?? '').trim().toLowerCase();
		// With no event set there is nothing to scope to, and guessing one would
		// silently answer about the wrong weekend. Insights is where an event gets
		// picked, so that is where this goes.
		const to = code
			? `${base}/studio/${code}/team/${team}/`
			: `${base}/studio/insights/`;
		goto(to, { replaceState: true });
	});
</script>

<p class="redirect">Opening team {page.params.teamNumber}…</p>

<style>
	.redirect {
		padding: var(--space-4);
		color: var(--text-muted);
	}
</style>
