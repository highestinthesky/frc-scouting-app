<script>
	// One team, scoped two ways.
	//
	// The old route was /studio/insights/team/<n> and it answered with every
	// entry the device held, from every event, pooled into one mean. Nobody asked
	// for that and nothing said it was happening — a manager reading "4.2
	// average" in a gym had no way to know how much of it came from a different
	// weekend. See the header on aggregate.js.
	//
	// So the event is in the URL now, and the two questions are answered side by
	// side. They are genuinely different questions:
	//
	//   at this event   decides the next match and the picklist
	//   this season     says whether what is happening here is normal
	//
	// Season never crosses a year. The game changes every January, so a 2025
	// cycle count and a 2026 cycle count measure different actions.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { listEntries } from '$lib/db.js';
	import { teamProfile } from '$lib/aggregate.js';
	import { fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { syncState } from '$lib/sync.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import Table from '$lib/components/studio/Table.svelte';

	const eventCode = $derived(String(page.params.eventCode ?? '').toLowerCase());
	const teamNumber = $derived(Number(page.params.teamNumber));

	let entries = $state([]);
	let loading = $state(true);

	const profile = $derived(teamProfile(entries, teamNumber, eventCode));
	const here = $derived(profile.event);
	const season = $derived(profile.seasonWide);

	// Only worth showing the season column when it says something the event
	// column does not. One event in the pool means the two numbers are the same
	// number, and printing it twice invites reading it as corroboration.
	const seasonAdds = $derived(profile.byEvent.length > 1);

	async function refresh() {
		entries = await listEntries();
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});

	function matchLink(e) {
		return `${base}/studio/${e.eventCode}/q${e.matchNumber}/`;
	}
</script>

<svelte:head>
	<title>Team {teamNumber} · {eventCode} · FRC Scout</title>
</svelte:head>

<main>
	<PageHead
		title="Team {teamNumber}"
		sub={eventCode}
		back="{base}/studio/insights/"
		backLabel="Back to Insights"
	/>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if !here && !season}
		<Panel
			title="Nothing on file"
			hint="No entries for team {teamNumber} at {eventCode}, and none this season."
		/>
	{:else}
		<Stats>
			<Stat
				label="At this event"
				value={here?.entryCount ?? 0}
				note={here ? `${here.matchesCovered} matches` : 'not seen here yet'}
				tone={here ? 'default' : 'warn'}
			/>
			{#if seasonAdds}
				<Stat
					label="This season"
					value={season?.entryCount ?? 0}
					note="{profile.byEvent.length} events{profile.season ? ` · ${profile.season}` : ''}"
				/>
			{/if}
			{#if here?.discrepancyCount}
				<Stat label="Disagreements" value={here.discrepancyCount} tone="warn" />
			{/if}
		</Stats>

		{#if !here && season}
			<Panel
				title="Not seen at this event yet"
				hint="Everything below is from earlier events this season. It is context, not a reading of what this team is doing here."
			/>
		{/if}

		<Panel
			title="Metrics"
			hint={seasonAdds
				? 'Each number carries its own sample size. A season figure pools every event this season and never crosses a year.'
				: 'Each number carries its own sample size. Blank means not recorded, which is not the same as zero.'}
			flush
		>
			<Table>
				{#snippet head()}
					<tr>
						<th>Metric</th>
						<th data-num>At this event</th>
						{#if seasonAdds}<th data-num>This season</th>{/if}
					</tr>
				{/snippet}
				{#each METRIC_FIELDS as f}
					{@const e = here?.metrics?.[f.key]}
					{@const s = season?.metrics?.[f.key]}
					{#if (e?.n ?? 0) > 0 || (s?.n ?? 0) > 0}
						<tr>
							<th scope="row">{f.label}</th>
							<td data-num>
								{#if e?.n}
									<strong>{fmt(e.mean)}</strong>
									<span class="n">n={e.n}</span>
								{:else}
									<span class="blank" title="Not recorded at this event">—</span>
								{/if}
							</td>
							{#if seasonAdds}
								<td data-num>
									{#if s?.n}
										{fmt(s.mean)}
										<span class="n">n={s.n}</span>
									{:else}
										<span class="blank">—</span>
									{/if}
								</td>
							{/if}
						</tr>
					{/if}
				{/each}
			</Table>
		</Panel>

		{#if seasonAdds}
			<Panel
				title="By event"
				hint="Oldest first, so it reads as a history. A team that has improved since its last event is the thing this is for."
				flush
			>
				<Table>
					{#snippet head()}
						<tr>
							<th>Event</th>
							<th data-num>Entries</th>
							<th data-num>Matches</th>
							<th>Last seen</th>
						</tr>
					{/snippet}
					{#each profile.byEvent as row}
						<tr class:current={row.isCurrent}>
							<th scope="row">
								{#if row.isCurrent}
									{row.eventCode} <span class="tag">here</span>
								{:else}
									<a href="{base}/studio/{row.eventCode}/team/{teamNumber}/">{row.eventCode}</a>
								{/if}
							</th>
							<td data-num>{row.entryCount}</td>
							<td data-num>{row.matchesCovered}</td>
							<td>{row.lastCreatedAt ? new Date(row.lastCreatedAt).toLocaleDateString() : '—'}</td>
						</tr>
					{/each}
				</Table>
			</Panel>
		{/if}

		{#if here?.entries?.length}
			<Panel title="Entries at this event" flush>
				<Table>
					{#snippet head()}
						<tr>
							<th>Match</th>
							<th>Scout</th>
							<th>Alliance</th>
							<th>Notes</th>
						</tr>
					{/snippet}
					{#each here.entries as e}
						<tr>
							<th scope="row"><a href={matchLink(e)}>Qual {e.matchNumber}</a></th>
							<td>{e.scoutName}</td>
							<td>{e.allianceColor ?? '—'}</td>
							<td class="notes">
								{e.observations?.strengths?.trim() || e.observations?.comments?.trim() || '—'}
							</td>
						</tr>
					{/each}
				</Table>
			</Panel>
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

	.n {
		font-size: var(--fs-xs);
		color: var(--text-muted);
		margin-left: var(--space-1);
	}

	.blank {
		color: var(--text-faint);
	}

	.tag {
		font-size: var(--fs-xs);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--accent-soft);
		color: var(--text-primary);
		white-space: nowrap;
	}

	.notes {
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
</style>
