<script>
	// A real table, which is what most of Studio wanted all along.
	//
	// The pages moved into Studio in v0.73 render lists as stacked cards, because
	// that is what they were when they lived on a phone. A card is the right shape
	// at 375px and the wrong one at 1280px: `insights` showed four teams in the
	// height that holds twenty rows, and comparing them was the entire job.
	//
	//     <Table>
	//       {#snippet head()}<tr><th>Team</th><th data-num>Entries</th></tr>{/snippet}
	//       <tr><td>254</td><td data-num>11</td></tr>
	//     </Table>
	//
	// The page writes its own rows. A column API — pass an array of {key, label,
	// render} — was the alternative, and every one of these tables has a cell that
	// is a button, a bar chart or three chips, so the API would have grown a
	// snippet-per-column and become the markup with extra steps.
	//
	// Styling reaches those rows with :global(), scoped under .wrap so it stays
	// inside this component. That is the legitimate use: the component owns how a
	// table looks, the page owns what is in it.

	/**
	 * @type {{
	 *   head?: import('svelte').Snippet,
	 *   caption?: string,
	 *   dense?: boolean,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let { head, caption = '', dense = false, children } = $props();
</script>

<div class="wrap">
	<table class:dense>
		{#if caption}<caption>{caption}</caption>{/if}
		{#if head}
			<thead>{@render head()}</thead>
		{/if}
		<tbody>{@render children()}</tbody>
	</table>
</div>

<style>
	/* Hallmark · genre: modern-minimal · component: table
	 * design-system: design.md · palette: Studio ([data-studio])
	 */

	/* The scroll lives here, on the table's own wrapper, never on the page. A
	   wide table is the one thing in Studio that legitimately exceeds the
	   viewport, and the fix is that IT scrolls — the document scrolling sideways
	   is the bug this app has shipped three times. */
	.wrap {
		width: 100%;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-sm);
	}
	caption {
		text-align: left;
		padding: var(--space-2) var(--space-4);
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.wrap :global(th) {
		position: sticky;
		top: 0;
		z-index: 1;
		text-align: left;
		white-space: nowrap;
		padding: var(--space-2) var(--space-3);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		background: var(--bg-card);
		border-bottom: 1px solid var(--border-strong);
	}
	.wrap :global(td) {
		padding: var(--space-3);
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	.dense :global(td) {
		padding: var(--space-2) var(--space-3);
	}
	/* Last row keeps the panel's own edge rather than drawing a second line
	   one pixel above it. */
	.wrap :global(tbody tr:last-child td) {
		border-bottom: none;
	}
	.wrap :global(tbody tr:hover td) {
		background: var(--bg-subtle);
	}

	/* An expanded row's detail sits in a full-width cell below it. Marked with
	   data-detail so it reads as a recess under its row and does NOT light up on
	   hover — it is the row's contents, not another row to click. */
	.wrap :global(tr[data-detail] td),
	.wrap :global(tr[data-detail]:hover td) {
		background: var(--bg-page);
		padding: var(--space-4);
	}

	/* Numbers line up or they are not worth tabulating. `data-num` on the cell
	   rather than an nth-child rule, because which column is numeric is a fact
	   about the data and nth-child is a fact about the markup — they disagree the
	   first time a column is inserted. */
	.wrap :global([data-num]) {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* A row that is a link or a button still has to clear the tap floor. design.md
	   treats 44px as non-negotiable and a manager does open this on a phone. */
	.wrap :global(tbody td) {
		height: var(--tap-min);
	}
</style>
