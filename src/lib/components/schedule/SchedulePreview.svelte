<script>
	// Manager's full match table, with a coverage rollup on top. Used to
	// spot-check a TBA fetch before publishing it to everyone.
	import { matchCoverage, coverageLevel } from '$lib/coverage.js';
	import { timeOfDay } from '$lib/format.js';

	let { qmList, rollup, entryIndex, overridesByMatch, onOpenMatch } = $props();
</script>

<section>
	<h2>Schedule preview</h2>
	<p class="muted small">
		{qmList.length} qual matches. Use this to spot-check the fetch before publishing.
	</p>
	{#if rollup.teamMatchesTotal > 0}
		<div class="cov-rollup" aria-label="Scouting coverage so far">
			<div class="cov-bar" aria-hidden="true">
				<span
					class="cov-bar-fill"
					style="width:{Math.round((rollup.teamMatchesScouted / rollup.teamMatchesTotal) * 100)}%"
				></span>
			</div>
			<p class="cov-rollup-text">
				<strong>{rollup.teamMatchesScouted}</strong>/{rollup.teamMatchesTotal}
				team-matches scouted
				<span class="key-sep">·</span>
				<strong>{rollup.matchesComplete}</strong> of {rollup.matchesTotal}
				matches fully covered
			</p>
		</div>
	{/if}
	<ol class="sched-preview">
		{#each qmList as m (m.match_number)}
			{@const matchTime = m.actual_time ?? m.predicted_time ?? m.time ?? null}
			{@const red = (m.alliances?.red?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
			{@const blue = (m.alliances?.blue?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
			{@const myOv = overridesByMatch.get(m.match_number) ?? []}
			{@const cov = matchCoverage(m, entryIndex)}
			<li class="sched-li" id={`match-${m.match_number}`}>
				<div class="sched-row">
					<span class="sp-match">Q{m.match_number}</span>
					<span class="sp-side red">{red.join(' · ')}</span>
					<span class="sp-vs">vs</span>
					<span class="sp-side blue">{blue.join(' · ')}</span>
					{#if matchTime}
						<span class="sp-time">{timeOfDay(matchTime)}</span>
					{/if}
					<span
						class="cov-chip {coverageLevel(cov.scoutedTeams, cov.totalTeams)}"
						title="{cov.scoutedTeams} of {cov.totalTeams} teams in this match have a scouting entry"
					>{cov.scoutedTeams}/{cov.totalTeams}</span>
					<button
						type="button"
						class="sp-edit"
						onclick={() => onOpenMatch(m.match_number)}
						aria-label={`Edit Q${m.match_number}`}
					>
						✎ Edit
						{#if myOv.length > 0}<span class="ov-pill">{myOv.length}</span>{/if}
					</button>
				</div>
			</li>
		{/each}
	</ol>
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
	.key-sep { opacity: 0.5; margin: 0 0.35rem; }
	/* ── manager: full-schedule preview ─────────────────────────── */
	.sched-preview {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.sched-row {
		display: grid;
		/* match · red · vs · blue · time · coverage · edit — an explicit column
		   per cell so the Edit button never auto-flows into the narrow match
		   column (which used to clip its label). */
		grid-template-columns: 2.5rem minmax(0, 1fr) auto minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 0.3rem;
		background: var(--bg-card);
		font-size: 0.85rem;
	}
	.sp-match { font-weight: 700; color: var(--accent); }
	.sp-side { font-variant-numeric: tabular-nums; }
	.sp-side.red { color: var(--alliance-red); text-align: right; }
	.sp-side.blue { color: var(--alliance-blue); text-align: left; }
	.sp-vs {
		color: var(--text-faint);
		font-size: 0.75rem;
		text-transform: uppercase;
	}
	.sp-time {
		color: var(--text-muted);
		font-size: 0.78rem;
		white-space: nowrap;
	}
	/* ── coverage chip + roll-up ────────────────────────────────── */
	.cov-chip {
		justify-self: end;
		align-self: center;
		font-size: 0.74rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-muted);
		background: var(--bg-subtle);
		white-space: nowrap;
		line-height: 1.3;
	}
	.cov-chip.full {
		color: var(--success);
		background: var(--success-bg);
		border-color: var(--success-border);
	}
	.cov-chip.partial {
		color: var(--warning);
		background: var(--warning-bg);
		border-color: var(--warning-border);
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
	@media (max-width: 28rem) {
		.sched-row {
			grid-template-columns: 2.5rem 1fr auto auto;
			grid-template-rows: auto auto;
			row-gap: 0.15rem;
			column-gap: 0.55rem;
		}
		.sp-vs { display: none; }
		.sp-match { grid-row: 1 / span 2; grid-column: 1; }
		.sp-side.red { grid-row: 1; grid-column: 2; text-align: left; }
		.sp-side.blue { grid-row: 2; grid-column: 2; text-align: left; }
		.sp-time {
			grid-row: 1;
			grid-column: 3;
			align-self: center;
			justify-self: end;
		}
		.cov-chip {
			grid-row: 2;
			grid-column: 3;
			justify-self: end;
		}
		.sp-edit {
			grid-row: 1 / span 2;
			grid-column: 4;
			align-self: center;
			justify-self: end;
		}
	}
	.sched-li { list-style: none; }
	.sp-edit {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		padding: 0.4rem 0.75rem;
		border-radius: 0.35rem;
		cursor: pointer;
		align-self: center;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		white-space: nowrap;
		min-height: 1.85rem;
	}
	.sp-edit:hover { color: var(--accent); border-color: var(--accent); }
	.ov-pill {
		display: inline-block;
		padding: 0 0.4rem;
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
	}
</style>
