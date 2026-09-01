<script>
	// Manager's full match table, with a coverage rollup on top. Used to
	// spot-check a TBA fetch before publishing it to everyone.
	import { matchCoverage, coverageLevel } from '$lib/coverage.js';
	import { timeOfDay } from '$lib/format.js';
	import Panel from './Panel.svelte';

	let { qmList, rollup, entryIndex, overridesByMatch, onOpenMatch } = $props();
</script>

<Panel title="Schedule preview">
	<p class="muted small">
		{qmList.length} qual matches. 
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
</Panel>

<style>
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	.key-sep { opacity: 0.5; margin: 0 var(--space-2); }
	/* ── manager: full-schedule preview ─────────────────────────── */
	.sched-preview {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.sched-row {
		display: grid;
		/* match · red · vs · blue · time · coverage · edit — an explicit column
		   per cell so the Edit button never auto-flows into the narrow match
		   column (which used to clip its label). */
		grid-template-columns: 2.5rem minmax(0, 1fr) auto minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		font-size: var(--fs-sm);
	}
	.sp-match { font-weight: 700; color: var(--accent); }
	.sp-side { font-variant-numeric: tabular-nums; }
	.sp-side.red { color: var(--alliance-red); text-align: right; }
	.sp-side.blue { color: var(--alliance-blue); text-align: left; }
	.sp-vs {
		color: var(--text-faint);
		font-size: var(--fs-xs);
		text-transform: uppercase;
	}
	.sp-time {
		color: var(--text-muted);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	/* ── coverage chip + roll-up ────────────────────────────────── */
	.cov-chip {
		justify-self: end;
		align-self: center;
		font-size: var(--fs-xs);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
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
		margin: var(--space-1) 0 var(--space-3);
	}
	.cov-bar {
		height: 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.cov-bar-fill {
		display: block;
		height: 100%;
		background: var(--success);
		border-radius: var(--radius-pill);
		transition: width 240ms ease;
	}
	.cov-rollup-text {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.cov-rollup-text strong {
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 28rem) {
		.sched-row {
			grid-template-columns: 2.5rem minmax(0, 1fr) auto auto;
			grid-template-rows: auto auto;
			row-gap: var(--space-1);
			column-gap: var(--space-2);
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
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 1.2;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		cursor: pointer;
		align-self: center;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		white-space: nowrap;
		/* The tap floor, not a literal a little under it.
		   This was 1.85rem and measured 32px on a phone — a control a manager
		   presses at a competition, 12px short of the floor design.md calls
		   non-negotiable. The vertical padding goes with it: the button already
		   centres its label with flex, so `min-height` alone lands it on exactly
		   44px instead of 44 plus two paddings in a content-box layout. */
		min-height: var(--tap-min);
	}
	.sp-edit:hover { color: var(--accent); border-color: var(--accent); }
	.ov-pill {
		display: inline-block;
		padding: 0 var(--space-2);
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: var(--radius-pill);
		font-size: var(--fs-xs);
		font-weight: 700;
	}
</style>
