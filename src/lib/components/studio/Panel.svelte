<script>
	// Studio's box. `insights` alone had this shape written out four times under
	// four names — .empty, .stat, .team, .paths-block — each with its own idea of
	// the padding and the radius, and none of them wrong enough to notice.
	//
	//     <Panel title="Coverage" hint="Against the published schedule">
	//     <Panel title="Teams" flush>{table}</Panel>
	//     <Panel tone="raised">          a panel sitting on another panel
	//
	// `flush` drops the body padding so a table can run to the panel's edge,
	// which is the whole reason a table looks like a table rather than a card
	// with lines in it.
	//
	// No `class` prop. A parent's scoping hash never reaches a child's markup, so
	// `<Panel class="wide">` with `.wide {}` in the parent compiles, renders, and
	// does nothing — silently, because the compiler can see the class sitting
	// right there. Variants are props here for that reason.

	/**
	 * @type {{
	 *   title?: string,
	 *   hint?: string,
	 *   tone?: 'default'|'raised'|'quiet',
	 *   flush?: boolean,
	 *   actions?: import('svelte').Snippet,
	 *   children?: import('svelte').Snippet
	 * }}
	 */
	let { title = '', hint = '', tone = 'default', flush = false, actions, children } = $props();
</script>

<section class="panel {tone}">
	{#if title || actions}
		<header>
			<div class="titles">
				{#if title}<h2>{title}</h2>{/if}
				{#if hint}<p class="hint">{hint}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	<!-- children is optional: a panel with a title and a hint and no body is how
	     an empty state is said here ("No schedule for this match"), and the header
	     already carries the whole message. Rendering it unconditionally threw
	     invalid_snippet and left the page stuck on "Loading…" — a blank screen for
	     what is only an absence of data. -->
	{#if children}
		<div class="body" class:flush>{@render children()}</div>
	{/if}
</section>

<style>
	/* Hallmark · genre: modern-minimal · component: panel
	 * design-system: design.md · palette: Studio ([data-studio])
	 * contrast: AA pass — verified per surface by check_contrast.mjs
	 */

	.panel {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		/* Clips a flush table's first and last rows to the radius. Without it the
		   corners of a full-bleed table square off the panel they sit in. */
		overflow: hidden;
	}
	/* Raised, for a panel inside a panel. On a dark ground elevation is a lighter
	   surface, not a shadow — a 6%-black drop shadow is invisible at #14121f. */
	.raised {
		background: var(--bg-elev);
	}
	/* Quiet, for the ones that are context rather than content: an empty state,
	   a note. Reads as a recess instead of a card. */
	.quiet {
		background: var(--bg-subtle);
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}
	.titles {
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.hint {
		margin: 2px 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}

	.body {
		padding: var(--space-4);
	}
	.body.flush {
		padding: 0;
	}
</style>
