<script>
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { eventOverview } from '$lib/coverage.js';
	import { rowScout, sameScout, scoutRef } from '$lib/scout-identity.js';
	import { timeOfDay } from '$lib/format.js';
	import Button from './Button.svelte';

	let { scouting } = $props();
	let personalOpen = $state(false);
	let peopleSlow = $state(false);
	const loading = $derived(!eventData.localReady);
	const peopleLoading = $derived(!eventData.rosterReady || !eventData.remoteReady);
	const peopleError = $derived(eventData.rosterError || eventData.remoteError || (peopleSlow ? 'Scout activity is taking longer to load. Coverage is available from this device.' : ''));
	const overview = $derived(eventOverview({ eventCode: session.eventCode, matches: eventData.cached?.matches ?? [], entries: eventData.entries, roster: eventData.roster }));
	const assignedScouts = $derived(overview.activity.filter(r => eventData.assignments.some(a => sameScout(rowScout(a), scoutRef(r.name, r.person.profileId)))).length);
	const nextTime = $derived(timeOfDay(overview.nextMatch?.predicted_time ?? overview.nextMatch?.time));
	const matchHref = (number) => `${base}/studio/${encodeURIComponent(session.eventCode)}/q${number}/`;
	const reload = () => eventData.load(session.eventCode);
	$effect(() => {
		peopleSlow = false;
		if (!peopleLoading) return;
		const timer = setTimeout(() => peopleSlow = true, 8000);
		return () => clearTimeout(timer);
	});
</script>

<main>
	<header class="page-head">
		<h1>Home</h1>
		<div class="head-actions"><Button variant="primary" href="{base}/scouting/new/">New entry</Button><Button href="{base}/studio/plan/schedule/">Open schedule</Button></div>
	</header>

	{#if loading}
		<p class="muted" role="status">Loading event coverage…</p>
	{:else}
		<section class="coverage" aria-labelledby="coverage-title">
			<div class="coverage-main">
				<h2 id="coverage-title">Event coverage</h2>
				{#if overview.percent !== null}
					<p class="coverage-number">{overview.percent}<span>%</span></p>
					<p class="coverage-detail"><strong>{overview.recorded} of {overview.expected}</strong> robot entries received</p>
					<progress max={overview.expected} value={overview.recorded} aria-label="Recorded robot entries"></progress>
					<p class="muted">Across {overview.trackedCount} played or started {overview.trackedCount === 1 ? 'match' : 'matches'}. Future matches are excluded.</p>
				{:else}
					<p class="coverage-empty">{overview.matchCount ? 'Waiting for the first match' : 'No schedule published'}</p>
					<p class="muted">{overview.matchCount ? 'Coverage appears as results or scout entries arrive.' : 'Publish the event schedule to track missing entries.'}</p>
				{/if}
			</div>
			<dl class="event-status">
				<div><dt>Latest match</dt><dd>{overview.latestMatch ? `Q${overview.latestMatch.match_number}` : 'Not started'}</dd></div>
				<div><dt>Next on the schedule</dt><dd>{overview.nextMatch ? `Q${overview.nextMatch.match_number}` : overview.matchCount ? 'Quals finished' : 'No schedule'}{#if overview.nextMatch && nextTime}<span>{nextTime}</span>{/if}</dd></div>
				<div><dt>Fully recorded</dt><dd>{overview.completeCount}<span>of {overview.trackedCount} {overview.trackedCount === 1 ? 'match' : 'matches'}</span></dd></div>
			</dl>
		</section>

		<div class="details">
			<section aria-labelledby="gaps-title">
				<div class="section-head"><h2 id="gaps-title">Missing entries</h2><a href="{base}/studio/run/matches/?show=gaps">View coverage →</a></div>
				{#if overview.gaps.length}
					<p class="section-note">{overview.gaps.length} {overview.gaps.length === 1 ? 'match needs' : 'matches need'} follow-up</p>
					<ul class="rows">
						{#each overview.gaps.slice(0, 5) as row (row.match.key)}
							<li><a class="gap-row" href={matchHref(row.match.match_number)}>
								<strong>Q{row.match.match_number}</strong>
								<span class="gap-info"><span class="gap-count">{row.coverage.totalTeams - row.coverage.scoutedTeams} missing</span><span class="muted">{row.coverage.teams.filter(t => !t.submitted).map(t => t.team).join(' · ')}</span></span>
								<span aria-hidden="true">→</span>
							</a></li>
						{/each}
					</ul>
					{#if overview.gaps.length > 5}<p class="muted">{overview.gaps.length - 5} more in Run</p>{/if}
				{:else}
					<p class="empty">{overview.trackedCount ? 'Every played or started match is fully recorded.' : 'No matches to review yet.'}</p>
				{/if}
			</section>

			<section aria-labelledby="scouts-title">
				<div class="section-head"><h2 id="scouts-title">Scout activity</h2><a href="{base}/studio/plan/people/">Manage scouts →</a></div>
				{#if peopleError}
					<p class="muted" role="status">{peopleError}</p><div class="retry"><Button onclick={reload}>Try again</Button></div>
				{:else if peopleLoading}
					<p class="muted" role="status">Loading scouts…</p>
				{:else if !overview.activity.length}
					<p class="empty">No scouts on this event. Add scouts in Plan to start assigning teams.</p>
				{:else}
					<p class="section-note">{assignedScouts} of {overview.activity.length} scouts assigned to teams</p>
					<ul class="rows scouts">
						{#each overview.activity.slice(0, 6) as row (row.person.profileId)}
							<li><span class="scout-name">{row.name}</span><span class:quiet={row.count === 0}>{row.count} {row.count === 1 ? 'entry' : 'entries'}</span></li>
						{/each}
					</ul>
					{#if overview.activity.length > 6}<p class="muted">{overview.activity.length - 6} more on the Scouts page</p>{/if}
					{#if assignedScouts < overview.activity.length}<div class="retry"><Button href="{base}/studio/plan/assignments/">Assign teams</Button></div>{/if}
				{/if}
			</section>
		</div>

		<nav class="tools" aria-label="Event tools">
			<a href="{base}/studio/pick/"><span>Team insights</span><span class="muted">{overview.teamsSeen} teams recorded</span><span aria-hidden="true">→</span></a>
			<a href="{base}/studio/pick/picklist/"><span>Picklist</span><span aria-hidden="true">→</span></a>
			<a href="{base}/studio/accounts/"><span>Accounts</span><span aria-hidden="true">→</span></a>
		</nav>
		{#if syncState.status !== 'connected' || !syncState.lastSyncedAt || syncState.pendingCount > 0}<p class="data-note muted">Based on data available on this device. Check sync status for updates.</p>{/if}
	{/if}
	<details class="personal" bind:open={personalOpen}>
		<summary>Your scouting</summary>
		{#if personalOpen}<div class="personal-content">{@render scouting?.()}</div>{/if}
	</details>
</main>

<style>
	main { max-width: var(--w-board); margin: var(--space-4) 0; padding: var(--space-5) var(--space-5) calc(var(--nav-bottom-h) + var(--space-5)); }
	.page-head, .section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
	.page-head { border-bottom: 1px solid var(--border); padding-bottom: var(--space-5); margin-bottom: var(--space-6); }
	h1 { margin: 0; font-size: var(--fs-page); letter-spacing: -0.02em; }
	h2 { margin: 0; font-size: var(--fs-lg); font-weight: 600; }
	p { margin: 0; }
	.muted, .section-note { color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.5; }
	.coverage { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
	.coverage-main { padding: var(--space-5) var(--space-6); min-width: 0; }
	.coverage-number { font-size: calc(var(--fs-xl) * 2); line-height: 1.2; font-weight: 650; font-variant-numeric: tabular-nums; margin-top: var(--space-4); }
	.coverage-number span { font-size: var(--fs-xl); color: var(--text-muted); margin-left: var(--space-1); }
	.coverage-detail { margin-top: var(--space-2); font-size: var(--fs-md); }
	progress { display: block; width: 100%; height: var(--space-2); margin: var(--space-4) 0 var(--space-3); border: 0; border-radius: var(--radius-pill); overflow: clip; appearance: none; background: var(--bg-subtle); color: var(--accent); }
	progress::-webkit-progress-bar { background: var(--bg-subtle); }
	progress::-webkit-progress-value { background: var(--accent); }
	progress::-moz-progress-bar { background: var(--accent); }
	.coverage-empty { font-size: var(--fs-xl); font-weight: 600; margin: var(--space-5) 0 var(--space-3); }
	.event-status { margin: 0; padding: var(--space-5) var(--space-6); border-left: 1px solid var(--border); display: flex; flex-direction: column; justify-content: center; gap: var(--space-4); }
	dt { color: var(--text-muted); font-size: var(--fs-sm); }
	dd { margin: var(--space-1) 0 0; font-size: var(--fs-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
	dd span { font-weight: 400; font-size: var(--fs-sm); color: var(--text-muted); margin-left: var(--space-2); }
	.details { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--space-7); margin-top: var(--space-6); }
	.details section { min-width: 0; }
	.section-head { align-items: baseline; }
	.section-head a { color: var(--accent); font-size: var(--fs-sm); text-decoration: none; white-space: nowrap; min-height: var(--tap-min); display: inline-flex; align-items: center; }
	.section-head a:hover { text-decoration: underline; }
	.section-note { margin-bottom: var(--space-3); }
	.rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
	.rows li { border-bottom: 1px solid var(--border); }
	.gap-row { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) 0; min-height: var(--tap-min); text-decoration: none; color: var(--text-primary); }
	.gap-row:hover { background: var(--bg-subtle); }
	.gap-row > strong { font-size: var(--fs-lg); min-width: calc(var(--space-6) * 1.5); font-variant-numeric: tabular-nums; }
	.gap-info { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
	.gap-info .muted { overflow-wrap: anywhere; }
	.gap-count { font-size: var(--fs-sm); color: var(--warning); font-weight: 600; }
	.scouts li { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) 0; font-size: var(--fs-sm); }
	.scout-name { min-width: 0; overflow-wrap: anywhere; }
	.scouts li > span:last-child { flex: none; font-variant-numeric: tabular-nums; }
	.quiet { color: var(--text-muted); }
	.empty { color: var(--text-muted); font-size: var(--fs-md); line-height: 1.5; padding: var(--space-4) 0; border-top: 1px solid var(--border); }
	.retry { display: flex; margin-top: var(--space-3); }
	.tools { display: flex; gap: var(--space-5); flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: var(--space-4); margin-top: var(--space-6); }
	.tools a { min-height: var(--tap-min); display: flex; align-items: center; gap: var(--space-2); color: var(--accent); text-decoration: none; font-size: var(--fs-sm); white-space: nowrap; }
	.tools a:hover { text-decoration: underline; }
	.data-note { margin-top: var(--space-3); }
	.personal { margin-top: var(--space-5); border-top: 1px solid var(--border); }
	.personal summary { min-height: var(--tap-min); padding: var(--space-3) 0; font-weight: 600; cursor: pointer; }
	.personal-content { max-width: var(--w-read); padding-top: var(--space-3); }
	.head-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	@media (max-width: 47.9375rem) {
		main { padding-left: var(--space-4); padding-right: var(--space-4); }
		.coverage, .details { grid-template-columns: minmax(0, 1fr); }
		.coverage-main { padding: var(--space-5); }
		.event-status { border-left: 0; border-top: 1px solid var(--border); padding: var(--space-4) var(--space-5); }
		.event-status > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
		dd { text-align: right; }
		dd span { display: block; margin-left: 0; }
		.details { gap: var(--space-6); }
		.tools { gap: var(--space-2) var(--space-5); }
	}
</style>
