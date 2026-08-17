<script>
	// One number with a name on it. The most-copied shape in Studio: a label, a
	// figure, sometimes a qualifier under it.
	//
	//     <Stat label="Entries" value={11} />
	//     <Stat label="Coverage" value="82%" note="of 34 matches" tone="warn" />
	//
	// The figure is tabular-nums and always has been in every copy — a column of
	// counts that shifts by a pixel as it updates is the one thing a manager
	// watching a live event actually notices.
	//
	// `tone` is a state, not a decoration: it is the difference between "82%" and
	// "82%, and that is a problem". Colour alone would be the whole signal, so a
	// toned stat also carries its note, which is the readable half.

	/**
	 * @type {{
	 *   label: string,
	 *   value: string|number,
	 *   note?: string,
	 *   tone?: 'default'|'good'|'warn'|'bad'
	 * }}
	 */
	let { label, value, note = '', tone = 'default' } = $props();
</script>

<div class="stat {tone}">
	<small>{label}</small>
	<span class="value">{value}</span>
	{#if note}<span class="note">{note}</span>{/if}
</div>

<style>
	/* Hallmark · genre: modern-minimal · component: stat
	 * design-system: design.md · palette: Studio ([data-studio])
	 */

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
	}
	small {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value {
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.1;
		/* A figure that reflows as it counts up is the one thing anybody watching
		   a live event notices. */
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}
	.note {
		font-size: var(--fs-xs);
		color: var(--text-faint);
	}

	/* The tone colours the figure, never the panel. A filled tile reads as an
	   alert the moment there are four of them, and on this palette a fill would
	   have to be the purple — the only member that takes light text. */
	.good .value {
		color: var(--success);
	}
	.warn .value {
		color: var(--warning);
	}
	.bad .value {
		color: var(--danger);
	}
	.good .note {
		color: var(--success);
	}
	.warn .note {
		color: var(--warning);
	}
	.bad .note {
		color: var(--danger);
	}
</style>
