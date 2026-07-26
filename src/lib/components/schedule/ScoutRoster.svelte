<script>
	// Roster of everyone the manager has assigned or who has recorded an entry.
	// Read-only: derived entirely in the route from assignments + local entries.
	import { relativeTime } from '$lib/format.js';

	let { scoutsInEvent, now } = $props();
</script>

<section>
	<h2>Scouts in this event</h2>
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
	/* ── scouts roster ──────────────────────────────────────────── */
	.roster {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.roster-row {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.4rem 0.6rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		font-size: 0.88rem;
	}
	.rs-name { font-weight: 700; }
	.rs-tags { display: flex; gap: 0.35rem; flex-wrap: wrap; }
	.rs-tag {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rs-tag.assigned { background: var(--accent-soft); color: var(--accent); }
	.rs-tag.recording { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.rs-tag.warn { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
	.rs-last { margin-left: auto; color: var(--text-muted); font-size: 0.8rem; }
</style>
