<script>
	// One match: who was in it, what was recorded, and what was missed.
	//
	// The app had no route for this. Insights aggregates a team ACROSS matches
	// and coverage says WHETHER a match was watched; neither shows the match. It
	// is also where the auto replay lands in v0.81 step 2, which is why it ships
	// and gets used first — a recorder whose output cannot be played back cannot
	// be verified.
	//
	// The URL carries the event: /studio/2026onsum/q12. A match number means
	// nothing without one, and the old shape would have made a bookmark silently
	// re-point at whatever event the device was on later.
	//
	// `q` is honest rather than decorative: tba.js keeps only comp_level === 'qm',
	// so quals are the only matches this app has ever modelled. It also leaves
	// `sf` and `f` free to mean something later without moving these URLs.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { listEntries } from '$lib/db.js';
	import { matchReport } from '$lib/aggregate.js';
	import { getCachedSchedule, qualMatches, teamsInMatch } from '$lib/tba.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import AutoReplay from '$lib/components/studio/AutoReplay.svelte';
	import { readTrack, cycleStats } from '$lib/auto-track.js';
	import { startZone } from '$lib/field.js';

	const eventCode = $derived(String(page.params.eventCode ?? '').toLowerCase());
	const matchNumber = $derived(Number(page.params.matchNumber));

	let entries = $state([]);
	let schedule = $state(null);
	let loading = $state(true);

	const quals = $derived(schedule ? qualMatches(schedule.matches) : []);
	const match = $derived(quals.find((m) => m.match_number === matchNumber) ?? null);
	const lineup = $derived(match ? teamsInMatch(match) : {});
	const report = $derived(matchReport(entries, eventCode, matchNumber, lineup));

	// Neighbours for the pager, from the schedule rather than by adding one —
	// a schedule can skip a number and an off-by-one lands on a match that does
	// not exist.
	const index = $derived(quals.findIndex((m) => m.match_number === matchNumber));
	const prev = $derived(index > 0 ? quals[index - 1] : null);
	const next = $derived(index >= 0 && index < quals.length - 1 ? quals[index + 1] : null);

	async function refresh() {
		entries = await listEntries();
		schedule = await getCachedSchedule(eventCode);
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});

	function scoutLabel(s) {
		return s?.name || s?.key || 'Unknown';
	}

	const seats = $derived([...report.red, ...report.blue]);
	const withTracks = $derived(seats.filter((s) => s.entries.some((e) => readTrack(e))));

	/** The auto summary for one seat, or null when nobody recorded a track. */
	function autoOf(seat) {
		const e = seat.entries.find((x) => readTrack(x));
		if (!e) return null;
		const track = readTrack(e);
		return {
			zone: startZone(track.start, seat.allianceColor),
			stats: cycleStats(track)
		};
	}
</script>

<svelte:head>
	<title>Qual {matchNumber} · {eventCode} · FRC Scout</title>
</svelte:head>

<main>
	<PageHead
		title="Qual {matchNumber}"
		sub={eventCode}
		back="{base}/studio/schedule/"
		backLabel="Back to Schedule"
	/>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else}
		<nav class="pager" aria-label="Match navigation">
			{#if prev}
				<a href="{base}/studio/{eventCode}/q{prev.match_number}/">← Qual {prev.match_number}</a>
			{:else}
				<span class="muted">← Qual {matchNumber - 1}</span>
			{/if}
			{#if next}
				<a href="{base}/studio/{eventCode}/q{next.match_number}/">Qual {next.match_number} →</a>
			{:else}
				<span class="muted">Qual {matchNumber + 1} →</span>
			{/if}
		</nav>

		<Stats>
			<Stat
				label="Recorded"
				value={report.entryCount}
				note={report.entryCount === 1 ? 'entry' : 'entries'}
			/>
			{#if report.hasLineup}
				<Stat
					label="Teams covered"
					value="{report.teamsCovered}/{report.teamsScheduled}"
					tone={report.teamsCovered === report.teamsScheduled
						? 'good'
						: report.teamsCovered === 0
							? 'bad'
							: 'warn'}
				/>
			{/if}
			<Stat label="Scouts" value={report.scouts.length} />
		</Stats>

		{#if !report.hasLineup}
			<Panel
				title="No schedule for this match"
				hint="Publish a schedule from Studio → Schedule and this fills in with who was actually in it. Anything already recorded is below."
			/>
		{/if}

		{#if withTracks.length}
			<Panel
				title="Auto replay"
				hint="{withTracks.length} of {report.teamsScheduled} robots were tracked."
			>
				<AutoReplay {seats} />
			</Panel>
		{/if}

		{#each [{ colour: 'red', seats: report.red }, { colour: 'blue', seats: report.blue }] as side}
			{#if side.seats.length}
				<Panel title="{side.colour === 'red' ? 'Red' : 'Blue'} alliance">
					<ul class="seats {side.colour}">
						{#each side.seats as seat}
							<li class:uncovered={!seat.covered}>
								<div class="seat-head">
									<a class="team" href="{base}/studio/{eventCode}/team/{seat.teamNumber}/">
										{seat.teamNumber}
									</a>
									{#if !seat.covered}
										<span class="tag warn">Not scouted</span>
									{:else if seat.duplicated}
										<span class="tag">{seat.entries.length} scouts</span>
									{/if}
								</div>

								{#if seat.covered}
									<p class="by">{seat.scouts.map(scoutLabel).join(', ')}</p>
									<dl class="metrics">
										{#each METRIC_FIELDS as f}
											{#if seat.metrics?.[f.key]?.n}
												<div>
													<dt>{f.label}</dt>
													<dd>{fmt(seat.metrics[f.key].mean)}</dd>
												</div>
											{/if}
										{/each}
									</dl>
									{#if autoOf(seat)}
										{@const a = autoOf(seat)}
										<p class="auto">
											Auto{a.zone ? ` from ${a.zone}` : ''}{a.stats.cycles
												? ` · ${a.stats.cycles} ${a.stats.cycles === 1 ? 'cycle' : 'cycles'}`
												: ''}{a.stats.msScoring
												? ` · ${(a.stats.msScoring / 1000).toFixed(1)}s scoring`
												: ''}{a.stats.climbed
												? ` · climb${a.stats.climbLevel ? ` L${a.stats.climbLevel}` : ''}${
														a.stats.climbOk === true
															? ' made'
															: a.stats.climbOk === false
																? ' failed'
																: ''
													}`
												: ''}
										</p>
									{/if}
									{#each seat.entries as e}
										{#if e.observations?.comments?.trim() || e.observations?.strengths?.trim()}
											<blockquote>
												{#if e.observations?.strengths?.trim()}
													<p>{e.observations.strengths}</p>
												{/if}
												{#if e.observations?.comments?.trim()}
													<p>{e.observations.comments}</p>
												{/if}
											</blockquote>
										{/if}
									{/each}
								{/if}
							</li>
						{/each}
					</ul>
				</Panel>
			{/if}
		{/each}

		{#if report.stray.length}
			<Panel
				title="Recorded against this match, not in it"
				hint="The schedule does not place these teams here. Most likely a match number typed wrong — the observation is real either way, so it is kept."
			>
				<ul class="seats">
					{#each report.stray as seat}
						<li>
							<div class="seat-head">
								<a class="team" href="{base}/studio/{eventCode}/team/{seat.teamNumber}/">
									{seat.teamNumber}
								</a>
								<span class="tag warn">Unscheduled</span>
							</div>
							<p class="by">{seat.scouts.map(scoutLabel).join(', ')}</p>
						</li>
					{/each}
				</ul>
			</Panel>
		{/if}

		{#if report.entryCount === 0 && !report.hasLineup}
			<Panel
				title="Nothing here yet"
				hint="No entries recorded for qual {matchNumber} at {eventCode}, and no schedule cached to say who was in it."
			/>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: var(--w-board);
		margin: 0 auto;
		padding: var(--space-4);
	}

	.muted {
		color: var(--text-muted);
	}

	.pager {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.pager a,
	.pager span {
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}

	.pager a {
		color: var(--accent);
		text-decoration: none;
		background: var(--bg-card);
		border: 1px solid var(--border);
	}

	.pager a:hover {
		border-color: var(--border-strong);
	}

	.seats {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
		/* min() so a 16rem floor cannot exceed a 343px phone and push content off
		   the right edge unreachably — the v0.80 finding, applied here from the
		   start rather than after it ships. */
		grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
	}

	.seats > li {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		min-width: 0;
	}

	.seats.red > li {
		border-left: 3px solid var(--alliance-red);
	}

	.seats.blue > li {
		border-left: 3px solid var(--alliance-blue);
	}

	.seats > li.uncovered {
		border-style: dashed;
	}

	.seat-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
	}

	.team {
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
	}

	.tag {
		font-size: var(--fs-xs);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-subtle);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.tag.warn {
		background: var(--warning-bg);
		color: var(--warning);
	}

	.by {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		margin: var(--space-2) 0 0;
	}

	.metrics div {
		min-width: 0;
	}

	.metrics dt {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.metrics dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-sm);
		color: var(--text-primary);
	}

	blockquote {
		margin: var(--space-2) 0 0;
		padding-left: var(--space-2);
		border-left: 2px solid var(--border);
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}

	blockquote p {
		margin: 0 0 var(--space-1);
	}

	.auto {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}
</style>
