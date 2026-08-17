<script>
	// The row of controls above a list: filters on the left, actions on the right.
	//
	//     <Toolbar>
	//       <input … />  <Select … />
	//       {#snippet end()}<Button>Export CSV</Button>{/snippet}
	//     </Toolbar>
	//
	// The `end` snippet exists rather than a `margin-left: auto` on the last
	// child, because "the last child" is whatever the page happens to render
	// last, and on insights that was a filter chip. Naming the group makes the
	// split explicit and survives someone adding a control.
	//
	// It wraps rather than scrolls. A manager at 1280px never sees the wrap; the
	// one who opened Studio on a phone to check one thing gets two rows instead
	// of a horizontal scroll they have to discover.

	/**
	 * @type {{
	 *   children: import('svelte').Snippet,
	 *   end?: import('svelte').Snippet
	 * }}
	 */
	let { children, end } = $props();
</script>

<div class="toolbar">
	<div class="lead">{@render children()}</div>
	{#if end}<div class="end">{@render end()}</div>{/if}
</div>

<style>
	.toolbar {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		justify-content: space-between;
	}
	.lead,
	.end {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		min-width: 0;
	}
</style>
