<script>
	// The row a set of <Stat>s sits in. Exists so five pages stop each choosing a
	// column count — insights had repeat(4), coverage had three flex children,
	// event had a two-column grid, and they disagreed at every width.
	//
	// auto-fit rather than a fixed count: the number of stats on a page is data,
	// not layout. Coverage shows three, Insights four, Accounts two, and a fixed
	// repeat(4) leaves a hole in two of them.
	//
	// minmax(0, 1fr) inside auto-fit, not a bare fr — a bare track refuses to
	// shrink below its content, and a long label held the whole grid wider than
	// the viewport. check_components.mjs fails the build on it; it shipped three
	// times before that check existed.

	/** @type {{ children: import('svelte').Snippet }} */
	let { children } = $props();
</script>

<div class="stats">{@render children()}</div>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-3);
	}
</style>
