<script>
	// Every Studio page's first element: the name of the page, what it is for, and
	// the actions that belong to the page rather than to a panel inside it.
	//
	//     <PageHead title="Insights" sub="11 entries · last 2h ago">
	//       {#snippet actions()}<Button>Export CSV</Button>{/snippet}
	//     </PageHead>
	//
	// This renders the page's <h1>, and check_components.mjs asserts that a nav
	// label matches the heading of the page it opens. That check reads the page
	// FILE, so it now accepts `title="…"` here as well as a literal <h1> — the
	// string it reads is still the string that becomes the heading, which is the
	// whole guarantee. Three of four labels disagreed with their page before
	// v0.73 and nothing in the code would ever have caught it.

	/**
	 * @type {{
	 *   title: string,
	 *   sub?: string,
	 *   back?: string,
	 *   backLabel?: string,
	 *   actions?: import('svelte').Snippet
	 * }}
	 */
	let { title, sub = '', back = '', backLabel = 'Back', actions } = $props();
</script>

<header class="head">
	{#if back}
		<a class="back" href={back} aria-label={backLabel}>
			<span aria-hidden="true">←</span>
		</a>
	{/if}
	<div class="titles">
		<h1>{title}</h1>
		{#if sub}<p class="sub">{sub}</p>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	.titles {
		min-width: 0;
		margin-right: auto;
	}
	h1 {
		margin: 0;
		font-size: var(--fs-page);
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.sub {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.actions {
		padding-top: var(--space-1);		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}

	/* 44 x 44, because the ← is the most-used control on a sub-page and started
	   life on every one of them as a 1.5rem character with 4px of padding.
	   check_components.mjs asserts both dimensions. */
	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border-radius: var(--radius-md);
		color: var(--accent);
		text-decoration: none;
		font-size: var(--fs-lg);
	}
	.back:hover {
		background: var(--bg-subtle);
	}
	@media (max-width: 40rem) {
		.head { gap: var(--space-2); }
		.actions { width: 100%; padding-top: var(--space-2); }
	}
</style>
