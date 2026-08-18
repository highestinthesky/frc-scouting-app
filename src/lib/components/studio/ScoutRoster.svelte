<script>
	// Roster of everyone the manager has assigned or who has recorded an entry.
	// Read-only: derived entirely in the route from assignments + local entries.
	import { relativeTime } from '$lib/format.js';
	import Panel from './Panel.svelte';

	let { scoutsInEvent, now } = $props();
</script>

<Panel title="Scouts in this event">
	{#if scoutsInEvent.length === 0}
		<p class="muted small">Nobody yet.</p>
	{:else}
		<ul class="roster">
			{#each scoutsInEvent as s (s.name)}
				<li class="roster-row">
					<span class="rs-name">{s.name}</span>
					<span class="rs-tags">
						{#if s.assigned}<span class="rs-tag assigned">assigned</span>{/if}
						{#if s.recording}<span class="rs-tag recording">{s.count} {s.count === 1 ? 'entry' : 'entries'}</span>{/if}
						{#if !s.assigned && s.recording}<span class="rs-tag warn">not assigned</span>{/if}
					</span>
					{#if s.lastEntry}
						<span class="rs-last">last {relativeTime(s.lastEntry, now)}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Panel>

<style>
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	/* ── scouts roster ──────────────────────────────────────────── */
	.roster {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.roster-row {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}
	.rs-name { font-weight: 700; }
	.rs-tags { display: flex; gap: var(--space-2); flex-wrap: wrap; }
	.rs-tag {
		font-size: var(--fs-xs);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rs-tag.assigned { background: var(--accent-soft); color: var(--accent); }
	.rs-tag.recording { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.rs-tag.warn { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
	.rs-last { margin-left: auto; color: var(--text-muted); font-size: var(--fs-sm); }
</style>
