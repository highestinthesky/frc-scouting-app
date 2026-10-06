<script>
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { eventOverview } from '$lib/coverage.js';
	import { rowScout, sameScout, scoutRef } from '$lib/scout-identity.js';
	import { teamsInMatch } from '$lib/tba.js';
	import { timeOfDay } from '$lib/format.js';
	import Button from './Button.svelte';

	let { scouting, greeting } = $props();
	let personalOpen = $state(false);
	let peopleSlow = $state(false);
	const loading = $derived(!eventData.localReady);
	const peopleLoading = $derived(!eventData.rosterReady || !eventData.remoteReady);
	const peopleError = $derived(eventData.rosterError || eventData.remoteError || (peopleSlow ? 'Scout activity is taking longer to load. Coverage is available from this device.' : ''));
	const overview = $derived(eventOverview({ eventCode: session.eventCode, matches: eventData.cached?.matches ?? [], entries: eventData.entries, roster: eventData.roster }));
	const assignedScouts = $derived(overview.activity.filter(r => eventData.assignments.some(a => sameScout(rowScout(a), scoutRef(r.name, r.person.profileId)))).length);
	const focusMatch = $derived(overview.nextMatch ?? overview.latestMatch);
	const focusTime = $derived(timeOfDay(focusMatch?.actual_time ?? focusMatch?.predicted_time ?? focusMatch?.time));
	const focusTeams = $derived(teamsInMatch(focusMatch));
	const matchHref = (number) => `${base}/studio/${encodeURIComponent(session.eventCode)}/q${number}/`;
	const teamHref = (number) => `${base}/studio/${encodeURIComponent(session.eventCode)}/team/${number}/`;
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
		<h1>{greeting}</h1>
		<div class="head-actions"><Button variant="primary" href="{base}/scouting/new/">New entry</Button><Button href="{base}/studio/plan/schedule/">Open schedule</Button></div>
	</header>

	{#if loading}
		<p class="muted" role="status">Loading event…</p>
	{:else}
		<section class="match-focus" aria-labelledby="match-title">
			{#if focusMatch}
				<div class="match-heading">
					<div>
						<h2 id="match-title">{overview.nextMatch ? 'Next match' : 'Latest match'}</h2>
						<p class="match-number">Q{focusMatch.match_number}{#if focusTime}<span>{focusTime}</span>{/if}</p>
					</div>
					<Button variant="primary" href={matchHref(focusMatch.match_number)}>Review match</Button>
				</div>
				<div class="alliances">
					{#each /** @type {const} */ (['red', 'blue']) as color (color)}
						<div class="alliance-row" data-color={color}>
							<h3>{color === 'red' ? 'Red alliance' : 'Blue alliance'}</h3>
							<ul>
								{#each focusTeams[color].filter(Number.isFinite) as team (team)}
									<li><a href={teamHref(team)} aria-label="Team {team}">{team}</a></li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
				{#if !overview.nextMatch}
					<p class="match-note">Qualification matches finished. <a href="{base}/studio/pick/compare/">Compare teams</a></p>
				{:else if overview.latestMatch}
					<p class="match-note">Last played <a href={matchHref(overview.latestMatch.match_number)}>Q{overview.latestMatch.match_number}</a></p>
				{/if}
			{:else}
				<h2 id="match-title">Set up this event</h2>
				<p class="setup-note">Publish the schedule to see the next match and its teams.</p>
				<Button href="{base}/studio/plan/schedule/">Open schedule</Button>
			{/if}
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

		<section class="event-summary" aria-labelledby="summary-title">
			<h2 id="summary-title">Event summary</h2>
			<dl>
				<div>
					<dt>Coverage</dt>
					<dd>{overview.percent === null ? '—' : `${overview.percent}%`}<span>{overview.percent === null ? 'Waiting for matches' : `${overview.recorded} of ${overview.expected} robot entries`}</span></dd>
				</div>
				<div>
					<dt>Fully recorded</dt>
					<dd>{overview.completeCount}<span>of {overview.trackedCount} {overview.trackedCount === 1 ? 'match' : 'matches'}</span></dd>
				</div>
			</dl>
			{#if overview.trackedCount}<p class="muted">Through Q{overview.latestMatch.match_number}. Future matches are excluded.</p>{/if}
		</section>

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
	.match-focus { padding: var(--space-5); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
	.match-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
	.match-number { margin-top: var(--space-2); font-size: var(--fs-display); font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
	.match-number span { font-size: var(--fs-lg); font-weight: 400; color: var(--text-muted); margin-left: var(--space-3); white-space: nowrap; }
	.alliances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); margin-top: var(--space-5); }
	.alliance-row { min-width: 0; }
	.alliance-row h3 { margin: 0 0 var(--space-2); font-size: var(--fs-sm); font-weight: 600; }
	.alliance-row[data-color='red'] h3 { color: var(--alliance-red); }
	.alliance-row[data-color='blue'] h3 { color: var(--alliance-blue); }
	.alliance-row ul { display: flex; gap: var(--space-2); padding: 0; margin: 0; list-style: none; }
	.alliance-row li { flex: 1 1 0; min-width: 0; }
	.alliance-row a { display: flex; align-items: center; justify-content: center; min-height: var(--tap-min); padding: var(--space-2) var(--space-1); color: var(--text-primary); background: var(--bg-subtle); border-radius: var(--radius-sm); font-size: var(--fs-lg); font-weight: 600; font-variant-numeric: tabular-nums; text-decoration: none; white-space: nowrap; }
	.alliance-row a:hover { color: var(--accent); background: var(--accent-soft); }
	.match-note, .setup-note { color: var(--text-muted); font-size: var(--fs-sm); margin-top: var(--space-4); }
	.match-note a { color: var(--accent); }
	.setup-note { margin-bottom: var(--space-4); }
	.event-summary { border-top: 1px solid var(--border); margin-top: var(--space-6); padding-top: var(--space-5); }
	.event-summary dl { display: flex; gap: var(--space-6); flex-wrap: wrap; margin: var(--space-3) 0; }
	.event-summary dl > div { min-width: 0; }
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
		.details, .alliances { grid-template-columns: minmax(0, 1fr); }
		.alliances { gap: var(--space-4); }
		.match-number span { display: block; margin: var(--space-2) 0 0; }
		.event-summary dl { gap: var(--space-3) var(--space-6); }
		.details { gap: var(--space-6); }
		.tools { gap: var(--space-2) var(--space-5); }
	}
</style>
