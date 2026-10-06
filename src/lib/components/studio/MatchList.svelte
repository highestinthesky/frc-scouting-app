<script>
	// Run's match list: every qual in order, how much of each is recorded, who is
	// double-booked in it, and the way into the match and its overrides.
	//
	// It was SchedulePreview, one of three surfaces answering "is this event
	// covered": this list, Coverage's Gaps table and the schedule page's
	// CoverageCheck. They read the same schedule and the same entries and lived on
	// three screens. Now Gaps is a filter over this list (the page passes the
	// rows), and a conflict is a line on the row it happens in — the place a
	// manager fixes it — rather than a second list naming the match by number.
	import { base } from '$app/paths';
	import { coverageLevel } from '$lib/coverage.js';
	import { timeOfDay } from '$lib/format.js';
	import Panel from './Panel.svelte';

	/**
	 * @type {{
	 *   rows: Array<{ match: any, cov: { scoutedTeams: number, totalTeams: number } }>,
	 *   conflictsByMatch: Map<number, Array<{ scout: string, teams: number[], hasOverride: boolean }>>,
	 *   overridesByMatch: Map<number, any[]>,
	 *   onOpenMatch: (n: number) => void,
	 *   eventCode?: string,
	 *   title?: string,
	 *   hint?: string,
	 *   empty?: string
	 * }}
	 */
	let {
		rows,
		conflictsByMatch,
		overridesByMatch,
		onOpenMatch,
		eventCode = '',
		title = 'Matches',
		hint = '',
		empty = 'Nothing here.'
	} = $props();

	const teamsOf = (m, color) =>
		(m.alliances?.[color]?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')));
</script>

<Panel {title} {hint}>
	{#if rows.length === 0}
		<p class="muted">{empty}</p>
	{:else}
		<ol class="sched-preview">
			<!-- Keyed on TBA's own match key. A match_number is only unique within a
			     competition level, and a duplicate key makes Svelte throw, which
			     aborts the render and leaves the page on whatever it painted last. -->
			{#each rows as { match: m, cov } (m.key ?? m.match_number)}
				{@const matchTime = m.actual_time ?? m.predicted_time ?? m.time ?? null}
				{@const myOv = overridesByMatch.get(m.match_number) ?? []}
				{@const clashes = conflictsByMatch.get(m.match_number) ?? []}
				<li class="sched-li" id={`match-${m.match_number}`} class:clashing={clashes.length > 0}>
					<div class="sched-row">
						<!-- The match number is the way IN to a match: its six seats, who
						     recorded what, and the replay. /studio/<code>/q<n> was linked
						     from nowhere for a release. -->
						{#if eventCode}
							<a class="sp-match" href="{base}/studio/{eventCode}/q{m.match_number}/">
								Q{m.match_number}
							</a>
						{:else}
							<span class="sp-match">Q{m.match_number}</span>
						{/if}
						<span class="sp-side red">{teamsOf(m, 'red').join(' · ')}</span>
						<span class="sp-vs">vs</span>
						<span class="sp-side blue">{teamsOf(m, 'blue').join(' · ')}</span>
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
					{#if clashes.length > 0}
						<!-- A scout assigned two robots in one match can watch one. The fix
						     is an override on this match, which is the Edit beside it. -->
						<ul class="clash-list">
							{#each clashes as c (c.scout)}
								<li>
									<span class="cf-mark" aria-hidden="true">⚠</span>
									<span class="cf-scout">{c.scout}</span>
									has {c.teams.join(' and ')}
									{#if c.hasOverride}<span class="cf-tag">override still overlaps</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</Panel>

<style>
	.muted { color: var(--text-muted); font-size: var(--fs-sm); margin: 0; }
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
		font-size: var(--fs-sm);
	}
	/* Already the accent and already bold, so as a link it needs no new colour —
	   only the underline on hover that every other text link here uses.
	   It had no tap floor, on the argument that 44px would push the rows apart.
	   It does not: the Edit button beside it is already 44px, so the row is that
	   tall anyway and the link was a 16px target inside a 44px row. */
	.sp-match {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font-weight: 700;
		color: var(--accent);
		text-decoration: none;
	}
	a.sp-match:hover,
	a.sp-match:focus-visible { text-decoration: underline; }
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
	/* The box is the item, not the row, so a conflict line sits inside it. */
	.sched-li {
		list-style: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
	}
	.sched-li.clashing {
		border-color: var(--warning-border);
	}
	.clash-list {
		list-style: none;
		margin: 0;
		padding: var(--space-1) var(--space-3) var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--fs-sm);
		color: var(--warning);
	}
	.cf-scout { font-weight: 600; }
	.cf-tag {
		color: var(--text-muted);
		font-size: var(--fs-xs);
		font-style: italic;
	}
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
