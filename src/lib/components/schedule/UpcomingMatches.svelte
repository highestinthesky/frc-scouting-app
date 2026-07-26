<script>
	// The scout's own match list, filtered to their teams. Already-recorded
	// rows stay in the list but muted, so the scout keeps a sense of pace.
	import { role } from '$lib/role.svelte.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';

	let { cached, effectiveTeams, myUpcoming, myProgress, now, hrefFor } = $props();
</script>

<section>
	<h2>Upcoming matches</h2>
	{#if !cached}
		<p class="muted small">
			{#if role.isManager}
				Fetch and publish to populate this list.
			{:else}
				No schedule pulled yet. Tap “Refresh from manager” above once your
				manager has published.
			{/if}
		</p>
	{:else if !effectiveTeams.length}
		<p class="muted small">Add at least one team above to see your matches.</p>
	{:else if myUpcoming.length === 0}
		<p class="muted small">None of your teams appear in the qual schedule.</p>
	{:else}
		<div class="cov-rollup" aria-label="Your scouting progress">
			<div class="cov-bar" aria-hidden="true">
				<span
					class="cov-bar-fill"
					style="width:{myProgress.total ? Math.round((myProgress.done / myProgress.total) * 100) : 0}%"
				></span>
			</div>
			<p class="cov-rollup-text">
				You've logged <strong>{myProgress.done}</strong> of
				<strong>{myProgress.total}</strong> assigned team-matches.
			</p>
		</div>
		<ul class="upcoming">
			{#each myUpcoming as row (row.match + ':' + row.team)}
				{@const matchTime = row.actualTime ?? row.predictedTime}
				<li class="upcoming-row" data-color={row.color} class:done={row.done}>
					<a href={hrefFor(row)} class="upcoming-link">
						<span class="up-match">Q{row.match}</span>
						<span class="up-team">Team {row.team}</span>
						<span class="up-color">{row.color}</span>
						{#if matchTime}
							<span class="up-time">
								{timeOfDay(matchTime)}
								<span class="up-rel">· {relativeTime(matchTime, now)}</span>
							</span>
						{/if}
						{#if row.done}<span class="up-done">✓ scouted</span>{/if}
					</a>
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
	/* ── upcoming matches list ──────────────────────────────────────── */
	.upcoming {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.upcoming-row {
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.4rem;
		background: var(--bg-card);
	}
	.upcoming-row[data-color='red'] { border-left-color: var(--alliance-red); }
	.upcoming-row[data-color='blue'] { border-left-color: var(--alliance-blue); }
	.upcoming-row.done { opacity: 0.55; }
	.upcoming-link {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.55rem 0.75rem;
		color: inherit;
		text-decoration: none;
		flex-wrap: wrap;
	}
	.upcoming-link:hover { background: var(--bg-subtle); }
	.up-match { font-weight: 700; color: var(--accent); min-width: 3rem; }
	.up-team { font-weight: 600; }
	.up-color { color: var(--text-muted); text-transform: capitalize; font-size: 0.85rem; }
	.up-time {
		color: var(--text-muted);
		font-size: 0.82rem;
		margin-left: auto;
		white-space: nowrap;
	}
	.up-rel { color: var(--text-faint); font-size: 0.78rem; }
	.up-done {
		color: var(--success);
		font-size: 0.8rem;
		font-weight: 600;
	}
	.cov-rollup {
		margin: 0.2rem 0 0.7rem;
	}
	.cov-bar {
		height: 0.5rem;
		border-radius: 999px;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.cov-bar-fill {
		display: block;
		height: 100%;
		background: var(--success);
		border-radius: 999px;
		transition: width 240ms ease;
	}
	.cov-rollup-text {
		margin: 0.35rem 0 0;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.cov-rollup-text strong {
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
</style>
