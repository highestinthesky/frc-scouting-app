<script>
	// Scouts assigned two or more teams in the same match. Display-only — the
	// fix is a per-match override, which is why each row opens the match modal.

	let { coverageConflicts, onOpenMatch } = $props();
</script>

<section>
	<h2>Coverage check</h2>
	<p class="muted">
		Scouts assigned two or more teams in one match. Tap a match to override.
	</p>
	{#if coverageConflicts.length === 0}
		<p class="muted small ok-inline">✓ No conflicts.</p>
	{:else}
		<ul class="conflict-list">
			{#each coverageConflicts as c (c.match + ':' + c.scout)}
				<li class="conflict-row">
					<button type="button" class="cf-match" onclick={() => onOpenMatch(c.match)}>Q{c.match}</button>
					<span class="cf-scout">{c.scout}</span>
					<span class="cf-teams">{c.teams.join(' · ')}</span>
					{#if c.hasOverride}
						<span class="cf-tag">override active, still overlaps</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.muted.small { font-size: 0.82rem; }
	.ok-inline { color: var(--success); }
	/* ── coverage check ─────────────────────────────────────────── */
	.conflict-list {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.conflict-row {
		display: flex;
		gap: 0.45rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.4rem 0.6rem;
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: 0.35rem;
		font-size: 0.85rem;
		color: var(--warning);
	}
	.cf-match {
		font: inherit;
		font-weight: 700;
		color: var(--warning);
		background: transparent;
		border: none;
		border-bottom: 1px dotted currentColor;
		padding: 0;
		cursor: pointer;
	}
	.cf-match:hover { color: var(--accent); border-bottom-color: var(--accent); }
	.cf-scout { font-weight: 600; }
	.cf-teams { font-variant-numeric: tabular-nums; }
	.cf-tag {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-style: italic;
	}
</style>
