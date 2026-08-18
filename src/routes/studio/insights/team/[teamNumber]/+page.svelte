<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import { syncState } from '$lib/sync.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';

	let summary = $state(null);
	let loading = $state(true);

	const teamNumber = $derived(Number(page.params.teamNumber));
	const team = $derived(
		summary?.teams.find((t) => t.teamNumber === teamNumber) ?? null
	);

	async function refresh() {
		summary = await summarize();
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});

	function formatDate(iso) {
		if (!iso) return '';
		return new Date(iso).toLocaleString();
	}
</script>

<svelte:head>
	<title>Team {teamNumber} · FRC Scout</title>
</svelte:head>

<main>
	<PageHead
		title="Team {teamNumber}"
		back="{base}/studio/insights/"
		backLabel="Back to Insights"
	/>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if !team}
		<div class="not-found">
			<p>No entries on file for team {teamNumber}.</p>
			<a class="back-link" href="{base}/studio/insights/">Back to Insights</a>
		</div>
	{:else}
		<!-- Quick links -->
		<div class="quick-actions">
			<a class="action" href="{base}/studio/insights/compare/?teams={teamNumber}">Compare with another team →</a>
		</div>

		<!-- Summary line -->
		<section class="summary">
			<div class="counts">
				<span><strong>{team.entryCount}</strong> {team.entryCount === 1 ? 'entry' : 'entries'}</span>
				<span><strong>{team.matchesCovered}</strong> {team.matchesCovered === 1 ? 'match' : 'matches'}</span>
				<span><strong>{team.scoutsCovered}</strong> {team.scoutsCovered === 1 ? 'scout' : 'scouts'}</span>
			</div>
			<div class="badges">
				{#if team.discrepancyCount > 0}
					<span class="badge warn">⚠ {team.discrepancyCount} {team.discrepancyCount === 1 ? 'conflict' : 'conflicts'}</span>
				{/if}
				{#if team.breakdownCount > 0}
					<span class="badge bad">{team.breakdownCount} {team.breakdownCount === 1 ? 'breakdown' : 'breakdowns'}</span>
				{/if}
				{#if team.defenseCount > 0}
					<span class="badge">{team.defenseCount} defense</span>
				{/if}
			</div>
		</section>

		<!-- Metrics, with a sparkline of the raw readings in match order -->
		{#if team.hasMetrics}
			<section class="metrics">
				<h2>Metrics</h2>
				<div class="metric-grid">
					{#each METRIC_FIELDS as m (m.key)}
						{@const s = team.metrics[m.key]}
						{#if s.n > 0}
							<div class="mcard" class:provisional={!s.confident}>
								<div class="mc-head">
									<small class="mc-label">{m.label}</small>
									{#if !s.confident}<small class="mc-prov">n={s.n}</small>{/if}
								</div>
								<div class="mc-value">
									<strong>{fmt(s.mean)}</strong>
									{#if s.trend !== null && Math.abs(s.trend) >= 0.5}
										<span class="mc-trend" class:up={s.trend > 0}>
											{s.trend > 0 ? '▲' : '▼'}{fmt(Math.abs(s.trend))}
										</span>
									{/if}
								</div>
								<Sparkline values={s.values} higherIsBetter={m.higherIsBetter !== false} />
								<small class="mc-meta">
									med {fmt(s.median)} · max {s.max} · min {s.min}
									{#if s.stdDev !== null} · ±{fmt(s.stdDev)}{/if}
								</small>
							</div>
						{/if}
					{/each}
				</div>
			</section>
		{/if}

		<!-- Auto pathing roll-up -->
		{#if team.autoPathCount > 0}
			<section class="paths-block">
				<h2>Auto pathings ({team.autoPathEntryCount} sightings)</h2>
				<ul class="path-list">
					{#each team.autoPaths as p (p.pathName)}
						<li><span>{p.pathName}</span><strong>{p.count}</strong></li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Match log: every entry, in chronological order, full text -->
		<section>
			<h2>Match log</h2>
			<ul class="match-log">
				{#each [...team.entries].sort((a, b) => (a.matchNumber - b.matchNumber) || (new Date(a.createdAt) - new Date(b.createdAt))) as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
					<li class="entry" data-color={e.allianceColor}>
						<div class="hdr">
							<strong>Q{e.matchNumber}</strong>
							<span class="alliance">{e.allianceColor}</span>
							<span class="by">by {e.scoutName} · {formatDate(e.createdAt)}</span>
						</div>
						{#if e.observations?.autoPathing}<p><strong>→</strong> {e.observations.autoPathing}</p>{/if}
						{#if e.observations?.strengths}<p><strong>+</strong> {e.observations.strengths}</p>{/if}
						{#if e.observations?.weaknesses}<p><strong>−</strong> {e.observations.weaknesses}</p>{/if}
						{#if e.observations?.defense}<p><strong>D</strong> {e.observations.defense}</p>{/if}
						{#if e.observations?.brokeDown === true}<p class="brokedown"><strong>!</strong> Broke down</p>{/if}
						{#if e.observations?.comments}<p><strong>·</strong> {e.observations.comments}</p>{/if}
						{#if e.observations?.failures && e.observations?.brokeDown === undefined}
							<p><strong>!</strong> {e.observations.failures}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	h2 {
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: var(--space-5) 0 var(--space-2);
	}
	.muted { color: var(--text-faint); }
	.not-found { margin-top: var(--space-6); text-align: center; }
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		margin-top: var(--space-4);
		color: var(--accent);
		font-weight: 600;
	}

	/* ── metric cards ─────────────────────────────────── */
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: var(--space-2);
	}
	.mcard {
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	/* A metric under the sample-size floor. Dimmed rather than hidden: the
	   number is real, it just should not be acted on yet. */
	.mcard.provisional { opacity: 0.68; }
	.mc-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-1); }
	.mc-label {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.mc-prov { font-size: var(--fs-xs); color: var(--text-faint); font-variant-numeric: tabular-nums; }
	.mc-value { display: flex; align-items: baseline; gap: var(--space-1); }
	.mc-value strong {
		font-size: var(--fs-xl);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.mc-trend { font-size: var(--fs-xs); font-variant-numeric: tabular-nums; color: var(--text-muted); }
	/* was var(--ok, …) — --ok has never been defined, so every "up" trend
	   silently fell through to the accent. --success is the real token. */
	.mc-trend.up { color: var(--success); }
	.mc-meta { font-size: var(--fs-xs); color: var(--text-faint); font-variant-numeric: tabular-nums; }

	.quick-actions { margin-bottom: var(--space-2); }
	.action {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font-size: var(--fs-sm);
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}
	.action:hover { text-decoration: underline; }

	.summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.counts {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
		font-size: var(--fs-md);
		color: var(--text-muted);
	}
	.counts strong { color: var(--accent); margin-right: var(--space-1); }
	.badges { display: flex; gap: var(--space-2); flex-wrap: wrap; }
	.badge {
		background: var(--bg-subtle);
		border-radius: var(--radius-pill);
		padding: var(--space-1) var(--space-3);
		color: var(--text-muted);
		font-size: var(--fs-xs);
	}
	.badge.bad { background: var(--danger-bg); color: var(--danger); }
	.badge.warn {
		background: var(--warning-bg);
		color: var(--warning);
		border: 1px solid var(--warning-border);
	}

	.paths-block {
		margin-top: var(--space-4);
		padding: var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.paths-block h2 { margin: 0 0 var(--space-2); font-size: var(--fs-sm); }
	.path-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.path-list li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--fs-sm);
	}

	.match-log {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.entry {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-left: 4px solid var(--border-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}
	/* Was #e24b4a / #378add — a second pair of alliance colours that drifted
	   from the tokens and never darkened for dark mode. */
	.entry[data-color='red'] { border-left-color: var(--alliance-red); }
	.entry[data-color='blue'] { border-left-color: var(--alliance-blue); }
	.hdr {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		font-size: var(--fs-md);
		flex-wrap: wrap;
	}
	.alliance { text-transform: capitalize; color: var(--text-muted); }
	.by { margin-left: auto; font-size: var(--fs-xs); color: var(--text-faint); }
	.entry p { margin: var(--space-1) 0 0; font-size: var(--fs-md); line-height: 1.45; }
	.entry p strong { display: inline-block; width: 1rem; color: var(--accent); }
	.entry p.brokedown { color: var(--danger); font-weight: 600; }
	.entry p.brokedown strong { color: var(--danger); }
</style>
