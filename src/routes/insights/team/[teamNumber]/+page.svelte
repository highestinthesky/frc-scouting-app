<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import { syncState } from '$lib/sync.svelte.js';

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
	<header class="page-head">
		<a class="back" href="{base}/insights/" aria-label="Back to manager">←</a>
		<h1>Team {teamNumber}</h1>
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if !team}
		<div class="not-found">
			<p>No entries on file for team {teamNumber}.</p>
			<a class="back-link" href="{base}/insights/">Back to manager</a>
		</div>
	{:else}
		<!-- Quick links -->
		<div class="quick-actions">
			<a class="action" href="{base}/insights/compare/?teams={teamNumber}">Compare with another team →</a>
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
	main {
		max-width: 38rem;
		margin: 1rem auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0;
	}

	/* ── metric cards ─────────────────────────────────────────────── */
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 0.6rem;
	}
	.mcard {
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--bg-card);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.mcard.provisional { opacity: 0.68; }
	.mc-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.3rem;
	}
	.mc-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.mc-prov {
		font-size: 0.66rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.mc-value {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}
	.mc-value strong {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.mc-trend {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.mc-trend.up { color: var(--ok, var(--accent)); }
	.mc-meta {
		font-size: 0.68rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	h2 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: 1.5rem 0 0.5rem;
	}
	.muted { color: var(--text-faint); }
	.not-found { margin-top: 2rem; text-align: center; }
	.back-link { display: inline-block; margin-top: 1rem; color: var(--accent); font-weight: 600; }

	.quick-actions {
		margin-bottom: 0.6rem;
	}
	.action {
		font-size: 0.86rem;
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}
	.action:hover { text-decoration: underline; }

	.summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.75rem 0.85rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
	}
	.counts { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.92rem; color: var(--text-muted); }
	.counts strong { color: var(--accent); margin-right: 0.2rem; }
	.badges { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.badge {
		background: var(--bg-subtle);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		color: var(--text-muted);
		font-size: 0.78rem;
	}
	.badge.bad { background: var(--danger-bg); color: var(--danger); }
	.badge.warn { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }

	.paths-block {
		margin-top: 1rem;
		padding: 0.6rem 0.8rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
	}
	.paths-block h2 {
		margin: 0 0 0.5rem;
		font-size: 0.88rem;
	}
	.path-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.path-list li { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.88rem; }

	.match-log {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.entry {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.45rem;
		padding: 0.6rem 0.8rem;
	}
	.entry[data-color='red'] { border-left-color: #e24b4a; }
	.entry[data-color='blue'] { border-left-color: #378add; }
	.hdr {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 0.92rem;
		flex-wrap: wrap;
	}
	.alliance { text-transform: capitalize; color: var(--text-muted); }
	.by { margin-left: auto; font-size: 0.8rem; color: var(--text-faint); }
	.entry p { margin: 0.3rem 0 0; font-size: 0.92rem; line-height: 1.45; }
	.entry p strong {
		display: inline-block;
		width: 1rem;
		color: var(--accent);
	}
	.entry p.brokedown { color: var(--danger); font-weight: 600; }
	.entry p.brokedown strong { color: var(--danger); }
</style>
