<script>
	import Panel from './Panel.svelte';
	import Button from '../Button.svelte';
	// Scouts assigned two or more teams in the same match. Display-only — the
	// fix is a per-match override, which is why each row opens the match modal.

	let { coverageConflicts, onOpenMatch, orphans = [], onClearOrphans = null, busy = false } = $props();

	const orphanRows = $derived(orphans.reduce((n, o) => n + o.count, 0));
</script>

<Panel title="Coverage check">
	<!-- Overrides addressed to somebody who is not on this event.
	     Reported, not deleted: a manager's planning is not tidied away from under
	     them. Same call Settings makes about a name mismatch — show it, offer the
	     fix, let them press it.
	     Worth showing even though these do not affect coverage today (that loop
	     only consults scouts who have assignments): the key is a lowercased name,
	     so they REACTIVATE the day someone with a matching name is added. -->
	{#if orphans.length > 0}
		<div class="orphans">
			<p class="orph-head">
				<strong>{orphanRows}</strong>
				{orphanRows === 1 ? 'override' : 'overrides'} addressed to
				{orphans.length === 1 ? 'someone' : 'people'} not on this event
			</p>
			<p class="orph-who">{orphans.map((o) => `${o.scout} (${o.count})`).join(' · ')}</p>
			<p class="orph-why">
				They do nothing now, and would start overriding a real assignment if
				anyone with a matching name joins.
			</p>
			{#if onClearOrphans}
				<Button variant="danger" disabled={busy} onclick={onClearOrphans}>
					Remove {orphanRows === 1 ? 'it' : 'them'}
				</Button>
			{/if}
		</div>
	{/if}

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
</Panel>

<style>
	.orphans {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		color: var(--warning);
	}
	.orph-head {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.orph-who {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
	}
	.orph-why {
		margin: var(--space-1) 0 var(--space-3);
		font-size: var(--fs-xs);
	}

	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	.ok-inline { color: var(--success); }
	/* ── coverage check ─────────────────────────────────────────── */
	.conflict-list {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.conflict-row {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
		padding: var(--space-2) var(--space-3);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
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
		font-size: var(--fs-xs);
		font-style: italic;
	}
</style>
