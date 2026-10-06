<script>
	// The manager pages' layout: the role gate, and the frame the pages sit in.
	//
	// It used to be a whole application — its own rail, its own event badge, a
	// "Leave Studio" link — rendered with the app shell switched off. The shell
	// is shared now (see +layout.svelte and nav-items.js), so what is left is
	// what is genuinely common to every page under /studio/: who may see them,
	// and how wide and how padded the content is.
	//
	// The URL prefix stays. The Studio palette (data-studio) keys on it, in
	// app.html before paint and in the root layout after, and every link and
	// reserved event code assumes it.

	import { base } from '$app/paths';
	import { auth } from '$lib/auth.svelte.js';

	// The event data every manager page reads (event-data.svelte.js) is loaded in
	// the root layout, not here: Home's manager tiles read it too.

	let { children } = $props();
</script>

{#if !auth.signedIn}
	<!-- The route guard in +layout.svelte already redirects, so this is only the
	     flash before it fires. Saying nothing looks broken; saying this does not. -->
	<p class="gate">Sign in to open this page.</p>
{:else if !auth.isManager}
	<!-- Deliberately explicit rather than a 404. A scout who followed a link from
	     a manager should learn why it will not open, not conclude the app is
	     broken and ask someone mid-match. -->
	<div class="gate">
		<h1>This is a manager page</h1>
		<p>
			Your account is a {auth.role ?? 'scout'}. A super can change that — everything
			you record is unaffected either way.
		</p>
		<a href="{base}/home/">Back to Home</a>
	</div>
{:else}
	<main>{@render children()}</main>
{/if}

<style>
	.gate {
		max-width: 32rem;
		margin: var(--space-6) auto;
		padding: 0 var(--space-4);
		/* Clear of the phone's docked nav, which a scout has too. */
		padding-bottom: var(--nav-bottom-h);
		color: var(--text-muted);
	}
	.gate h1 {
		font-size: var(--fs-xl);
		color: var(--text-primary);
		margin: 0 0 var(--space-3);
	}
	.gate a {
		color: var(--accent);
	}

	main {
		min-width: 0; /* lets wide tables scroll instead of stretching the page */
		/* Dense by design, but not unboundedly: --w-board is the width a table is
		   readable at, and a 2400px row is not more information, it is a longer
		   saccade. Left-aligned against the sidebar rather than centred, because
		   the sidebar is where the eye starts. */
		max-width: var(--w-board);
		padding: var(--space-5);
		/* A phone on its side puts the notch on one edge or the other. */
		padding-right: max(var(--space-5), env(safe-area-inset-right, 0px));
		padding-bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
	}

	/* Responsive blocks go last — a media query adds no specificity, so an
	   override above the rule it overrides loses on source order. Under 40rem
	   the nav is docked to the bottom of the viewport, and a page has to
	   reserve its height itself (see AppNav). */
	@media (max-width: 39.9375rem) {
		main {
			padding: var(--space-4);
			padding-left: max(var(--space-4), env(safe-area-inset-left, 0px));
			padding-right: max(var(--space-4), env(safe-area-inset-right, 0px));
			padding-bottom: calc(var(--space-4) + var(--nav-bottom-h));
		}
	}
</style>
