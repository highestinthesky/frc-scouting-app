<script>
	// Scouts the UNSAVED assignment draft gives two robots in one match.
	//
	// What is left of CoverageCheck. On Run › Matches the same check is a line on
	// the row it happens in, over what is saved, and the orphaned-override warning
	// went with it; here it is over what is being typed, so a clash shows before
	// Save rather than after. A row opens that match on Run, where the fix — an
	// override — is made.
	import Panel from './Panel.svelte';

	/**
	 * @type {{
	 *   conflicts: Array<{ match: number, scout: string, teams: number[], hasOverride: boolean }>,
	 *   onOpenMatch: (n: number) => void
	 * }}
	 */
	let { conflicts, onOpenMatch } = $props();
</script>

<Panel title="Conflicts in this draft">
	{#if conflicts.length === 0}
		<p class="ok">✓ Nobody has two robots in one match.</p>
	{:else}
		<ul class="conflict-list">
			{#each conflicts as c (c.match + ':' + c.scout)}
				<li class="conflict-row">
					<button type="button" class="cf-match" onclick={() => onOpenMatch(c.match)}>
						Q{c.match}
					</button>
					<span class="cf-scout">{c.scout}</span>
					<span class="cf-teams">{c.teams.join(' · ')}</span>
					{#if c.hasOverride}
						<span class="cf-tag">override active, still overlaps</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Panel>

<style>
	.ok {
		margin: 0;
		color: var(--success);
		font-size: var(--fs-sm);
	}
	.conflict-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.conflict-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		padding: 0 var(--space-3);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		color: var(--warning);
	}
	/* The tap floor. It was a dotted-underlined word, 17px tall, and it is the
	   control that takes a manager to the fix. */
	.cf-match {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font: inherit;
		font-weight: 700;
		color: var(--warning);
		background: transparent;
		border: none;
		padding: 0;
		text-decoration: underline dotted;
		cursor: pointer;
	}
	.cf-match:hover {
		color: var(--accent);
	}
	.cf-scout {
		font-weight: 600;
	}
	.cf-teams {
		font-variant-numeric: tabular-nums;
	}
	.cf-tag {
		margin-left: auto;
		color: var(--text-muted);
		font-size: var(--fs-xs);
		font-style: italic;
	}
</style>
