<script>
	// Review — the index the match and team pages never had.
	//
	// /studio/<code>/q<n> already renders a match and its auto replay, and
	// /studio/<code>/team/<n> already renders a team. Both shipped reachable from
	// almost nowhere: the match page for a release only by typing its URL. Review
	// is not new construction, it is the way in:
	//
	//   1. the next match, its six teams one tap each — "next match, tap a team"
	//      is the review workflow, so it is the first thing here and on Home
	//   2. the matches already played, most recent first, each a way into its
	//      replay, with how much of it was recorded and tracked
	//   3. a team by number
	//
	// Run › Matches is the other match list, deliberately: it is the calendar —
	// ascending, forward-looking, what is uncovered. This is the history. See
	// *Two match lists* in ROADMAP before merging them.

	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { session } from '$lib/session.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { matchCoverage } from '$lib/coverage.js';
	import { reviewSplit, trackedByMatch } from '$lib/review.js';
	import { teamsInMatch } from '$lib/tba.js';
	import { timeOfDay } from '$lib/format.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Button from '$lib/components/Button.svelte';

	const split = $derived(reviewSplit(eventData.qmList, eventData.entryIndex));
	const tracked = $derived(trackedByMatch(eventData.eventEntries));
	const nextTeams = $derived(split.next ? teamsInMatch(split.next) : null);

	/** How many of `recent` show before the manager asks for the rest. */
	const FIRST_FEW = 10;
	let showAll = $state(false);
	const visibleRecent = $derived(showAll ? split.recent : split.recent.slice(0, FIRST_FEW));

	const matchHref = (n) => `${base}/studio/${session.eventCode}/q${n}/`;
	const teamHref = (t) => `${base}/studio/${session.eventCode}/team/${t}/`;

	let teamInput = $state('');
	let findErr = $state('');
	function findTeam(e) {
		e.preventDefault();
		const n = Number(String(teamInput).replace(/[^0-9]/g, ''));
		if (!Number.isInteger(n) || n <= 0) {
			findErr = 'Type a team number.';
			return;
		}
		findErr = '';
		goto(teamHref(n));
	}
</script>

<svelte:head><title>Review · FRC Scout</title></svelte:head>

<PageHead title="Review" />

{#if !session.eventCode}
	<Panel tone="quiet">
		<p class="muted">Choose an event from the event button in the bar above first.</p>
	</Panel>
{:else if !eventData.localReady}
	<p class="muted">Loading…</p>
{:else}
	<div class="board">
		<div class="main-col">
			{#if !eventData.qmList.length}
				<Panel tone="quiet">
					<p class="muted">
						No schedule on this device for {session.eventCode} yet, so there are no matches to
						list. Publish one from <a href="{base}/studio/plan/schedule/">Plan › Schedule</a>.
						A team's page works without one.
					</p>
				</Panel>
			{:else}
				<Panel title="Next match">
					{#if split.next && nextTeams}
						{@const when = timeOfDay(split.next.predicted_time ?? split.next.time ?? null)}
						<div class="next-head">
							<a class="qm" href={matchHref(split.next.match_number)}>Q{split.next.match_number}</a>
							{#if when}<span class="when">{when}</span>{/if}
						</div>
						<div class="alliances">
							{#each /** @type {const} */ (['red', 'blue']) as color (color)}
								<ul class="side" data-color={color} aria-label="{color} alliance">
									{#each nextTeams[color].filter((t) => t != null) as t (t)}
										<li><a class="team-chip" href={teamHref(t)}>{t}</a></li>
									{/each}
								</ul>
							{/each}
						</div>
					{:else}
						<p class="muted">Every qual has been played.</p>
					{/if}
				</Panel>

				<Panel
					title="Played"
					hint={split.recent.length
						? 'Most recent first. A match opens its six robots, what was recorded, and the auto replay.'
						: ''}
				>
					{#if split.recent.length === 0}
						<p class="muted">Nothing played yet — a match shows here once someone records it.</p>
					{:else}
						<ol class="played">
							{#each visibleRecent as m (m.key ?? m.match_number)}
								{@const cov = matchCoverage(m, eventData.entryIndex)}
								{@const tr = tracked.get(m.match_number)?.size ?? 0}
								{@const lineup = teamsInMatch(m)}
								<li>
									<a class="played-row" href={matchHref(m.match_number)}>
										<span class="qm">Q{m.match_number}</span>
										<span class="sides">
											<span class="red">{lineup.red.join(' · ')}</span>
											<span class="blue">{lineup.blue.join(' · ')}</span>
										</span>
										<span class="counts">
											<span class:short={cov.scoutedTeams < cov.totalTeams}>
												{cov.scoutedTeams}/{cov.totalTeams} recorded
											</span>
											<span class="tracked">{tr} tracked</span>
										</span>
									</a>
								</li>
							{/each}
						</ol>
						{#if split.recent.length > FIRST_FEW}
							<div class="more">
								<Button onclick={() => (showAll = !showAll)}>
									{showAll ? 'Show fewer' : `Show all ${split.recent.length}`}
								</Button>
							</div>
						{/if}
					{/if}
				</Panel>
			{/if}
		</div>

		<div class="side-col">
			<Panel title="Find a team">
				<form class="find" onsubmit={findTeam}>
					<label for="find-team">Team number</label>
					<div class="find-row">
						<input
							id="find-team"
							inputmode="numeric"
							pattern="[0-9]*"
							autocomplete="off"
							bind:value={teamInput}
						/>
						<Button variant="primary" type="submit">Open</Button>
					</div>
					{#if findErr}<p class="err" role="alert">{findErr}</p>{/if}
				</form>
			</Panel>
		</div>
	</div>
{/if}

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.main-col,
	.side-col {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-sm);
		margin: 0;
	}
	.muted a {
		color: var(--accent);
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
		margin: var(--space-2) 0 0;
	}

	/* ── next match ─────────────────────────────────────────────────── */
	.next-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.qm {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	a.qm {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font-size: var(--fs-lg);
		text-decoration: none;
	}
	a.qm:hover {
		text-decoration: underline;
	}
	.when {
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
	.alliances {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.side {
		list-style: none;
		margin: 0;
		padding: 0 0 0 var(--space-2);
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
		/* The alliance is the rule down the side AND the word in the label —
		   colour is never the only signal. */
		border-left: 3px solid var(--border);
	}
	.side[data-color='red'] {
		border-left-color: var(--alliance-red);
	}
	.side[data-color='blue'] {
		border-left-color: var(--alliance-blue);
	}
	.team-chip {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
	}
	.team-chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	/* ── played ─────────────────────────────────────────────────────── */
	.played {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	/* The whole row is the link: the replay is the reason to be here, and a row
	   is a bigger target than a number. */
	.played-row {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-primary);
		text-decoration: none;
		font-size: var(--fs-sm);
	}
	.played-row:hover {
		border-color: var(--accent);
	}
	.sides {
		display: flex;
		flex-direction: column;
		font-variant-numeric: tabular-nums;
		min-width: 0;
	}
	.sides .red {
		color: var(--alliance-red);
	}
	.sides .blue {
		color: var(--alliance-blue);
	}
	.counts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-size: var(--fs-xs);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.counts .short {
		color: var(--warning);
		font-weight: 600;
	}
	.more {
		margin-top: var(--space-3);
	}

	/* ── find a team ────────────────────────────────────────────────── */
	.find label {
		display: block;
		font-size: var(--fs-sm);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}
	.find-row {
		display: flex;
		gap: var(--space-2);
	}
	.find input {
		flex: 1;
		min-width: 0;
		min-height: var(--tap-min);
		box-sizing: border-box;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		font: inherit;
		font-variant-numeric: tabular-nums;
	}
	.find input:focus {
		border-color: var(--accent);
	}

	@media (min-width: 64rem) {
		.board {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		}
	}
</style>
