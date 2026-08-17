<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { syncState } from '$lib/sync.svelte.js';

	let summary = $state(null);
	let loading = $state(true);
	let addInput = $state('');
	let addError = $state('');

	// The set of team numbers we're comparing comes from the ?teams= URL param.
	// Editing the set rewrites the URL, which keeps the comparison sharable as
	// a link and keeps history navigable.
	const requestedTeams = $derived.by(() => {
		const raw = page.url.searchParams.get('teams') ?? '';
		return raw
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n) && n > 0);
	});

	const teams = $derived.by(() => {
		if (!summary) return [];
		return requestedTeams
			.map((n) => summary.teams.find((t) => t.teamNumber === n))
			.filter(Boolean);
	});

	const missing = $derived.by(() => {
		if (!summary) return [];
		return requestedTeams.filter(
			(n) => !summary.teams.some((t) => t.teamNumber === n)
		);
	});

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

	/**
	 * Which team leads on each metric, so the winning cell can be marked.
	 * Only teams with an actual reading are eligible, and a tie leaves every
	 * tied team unmarked rather than arbitrarily crowning the first one.
	 */
	const leaders = $derived.by(() => {
		const out = {};
		for (const m of METRIC_FIELDS) {
			const withValue = teams
				.map((t) => ({ teamNumber: t.teamNumber, mean: t.metrics?.[m.key]?.mean }))
				.filter((x) => x.mean !== null && x.mean !== undefined);
			if (withValue.length < 2) continue;
			const best =
				m.higherIsBetter === false
					? Math.min(...withValue.map((x) => x.mean))
					: Math.max(...withValue.map((x) => x.mean));
			const winners = withValue.filter((x) => x.mean === best);
			if (winners.length === 1) out[m.key] = winners[0].teamNumber;
		}
		return out;
	});

	function setTeams(list) {
		const url = new URL(window.location.href);
		if (list.length === 0) url.searchParams.delete('teams');
		else url.searchParams.set('teams', list.join(','));
		goto(url.pathname + url.search, { replaceState: false, keepFocus: true });
	}

	function addTeam() {
		addError = '';
		const n = Number(addInput.trim());
		if (!Number.isFinite(n) || n <= 0) {
			addError = 'Enter a team number.';
			return;
		}
		if (requestedTeams.includes(n)) {
			addError = `Team ${n} is already in the comparison.`;
			return;
		}
		setTeams([...requestedTeams, n]);
		addInput = '';
	}

	function removeTeam(teamNumber) {
		setTeams(requestedTeams.filter((n) => n !== teamNumber));
	}
</script>

<svelte:head>
	<title>Compare · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/studio/insights/" aria-label="Back to Insights">←</a>
		<h1>Compare teams</h1>
	</header>

	<form class="add-row" onsubmit={(e) => { e.preventDefault(); addTeam(); }}>
		<input
			type="number"
			inputmode="numeric"
			bind:value={addInput}
			placeholder="Add team #"
			class="add-input"
		/>
		<button type="submit" class="add-btn">Add</button>
		{#if addError}<small class="error">{addError}</small>{/if}
	</form>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if requestedTeams.length === 0}
		<div class="empty">
			<p>Add at least two teams (above) to compare them side by side.</p>
		</div>
	{:else}
		{#if missing.length > 0}
			<p class="info">No entries yet for: {missing.join(', ')}.</p>
		{/if}
		<div class="grid">
			{#each teams as t (t.teamNumber)}
				<section class="col">
					<header class="col-head">
						<h2>Team {t.teamNumber}</h2>
						<button class="remove" onclick={() => removeTeam(t.teamNumber)} title="Remove from comparison">
							✕
						</button>
					</header>
					<dl>
						<dt>Coverage</dt>
						<dd>{t.entryCount} {t.entryCount === 1 ? 'entry' : 'entries'} · {t.matchesCovered} {t.matchesCovered === 1 ? 'match' : 'matches'} · {t.scoutsCovered} {t.scoutsCovered === 1 ? 'scout' : 'scouts'}</dd>

						{#each METRIC_FIELDS as m (m.key)}
							{@const s = t.metrics?.[m.key]}
							<dt>{m.label}</dt>
							<dd class="metric" class:leader={leaders[m.key] === t.teamNumber}>
								{#if !s || s.n === 0}
									<span class="muted">not recorded</span>
								{:else}
									<strong class="mv">{fmt(s.mean)}</strong>
									<span class="mmeta">
										avg of {s.n}{#if s.max !== null} · max {s.max}{/if}{#if s.stdDev !== null} · ±{fmt(s.stdDev)}{/if}
									</span>
									{#if !s.confident}<span class="prov">thin sample</span>{/if}
									{#if s.trend !== null && Math.abs(s.trend) >= 0.5}
										<span class="trend" class:up={s.trend > 0}>
											{s.trend > 0 ? '▲' : '▼'}{fmt(Math.abs(s.trend))}
										</span>
									{/if}
								{/if}
							</dd>
						{/each}

						<dt>Alliance split</dt>
						<dd>
							<span class="r">{t.redCount} red</span> · <span class="b">{t.blueCount} blue</span>
						</dd>

						<dt>Breakdowns</dt>
						<dd>
							{#if t.breakdownCount > 0}
								<span class="bad">{t.breakdownCount} of {t.entryCount} matches</span>
							{:else}
								<span class="ok">none reported</span>
							{/if}
						</dd>

						<dt>Defense played</dt>
						<dd>
							{#if t.defenseCount > 0}
								{t.defenseCount} {t.defenseCount === 1 ? 'note' : 'notes'}
							{:else}
								<span class="muted">none</span>
							{/if}
						</dd>

						<dt>Discrepancies</dt>
						<dd>
							{#if t.discrepancyCount > 0}
								<span class="warn">⚠ {t.discrepancyCount} {t.discrepancyCount === 1 ? 'conflict' : 'conflicts'}</span>
							{:else}
								<span class="muted">none</span>
							{/if}
						</dd>

						<dt>Top auto pathings</dt>
						<dd>
							{#if t.autoPaths.length > 0}
								<ul class="paths">
									{#each t.autoPaths.slice(0, 4) as p (p.pathName)}
										<li><span>{p.pathName}</span><strong>{p.count}</strong></li>
									{/each}
								</ul>
							{:else}
								<span class="muted">none recorded</span>
							{/if}
						</dd>

						<dt>Strengths (latest)</dt>
						<dd class="text">
							{#each t.entries.slice(0, 3) as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
								{#if e.observations?.strengths}
									<p>+ {e.observations.strengths}</p>
								{/if}
							{/each}
							{#if t.strengthCount === 0}<span class="muted">none recorded</span>{/if}
						</dd>

						<dt>Weaknesses (latest)</dt>
						<dd class="text">
							{#each t.entries.slice(0, 3) as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
								{#if e.observations?.weaknesses}
									<p>− {e.observations.weaknesses}</p>
								{/if}
							{/each}
						</dd>

						<dt>Full match log</dt>
						<dd>
							<a href="{base}/studio/insights/team/{t.teamNumber}/">Open team page →</a>
						</dd>
					</dl>
				</section>
			{/each}
		</div>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 60rem;
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-4) 0 var(--space-2);
	}
	.back {
		font-size: var(--fs-xl);
		text-decoration: none;
		color: var(--accent);
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}
	.back:hover { background: var(--bg-subtle); }
	.back:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.muted { color: var(--text-faint); }

	.add-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		margin: var(--space-2) 0 var(--space-4);
	}
	.add-input {
		font: inherit;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		max-width: 9rem;
	}
	.add-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	.add-btn {
		font: inherit;
		font-weight: 600;
		min-height: var(--tap-min);
		padding: 0 var(--space-4);
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.add-btn:hover { background: var(--accent-hover); }
	.add-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.error { color: var(--danger); font-size: var(--fs-sm); }
	.info {
		background: var(--banner-blue-bg);
		color: var(--alliance-blue);
		border: 1px solid var(--banner-blue-border);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}
	.empty {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, minmax(0, 1fr)));
		gap: var(--space-3);
	}
	.col {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
	}
	.col-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.col-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		color: var(--accent);
		text-transform: none;
		letter-spacing: 0;
	}
	.remove {
		font: inherit;
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: var(--fs-lg);
		line-height: 1;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	.remove:hover { color: var(--danger); background: var(--bg-subtle); }
	.remove:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

	dl { margin: 0; padding: 0; }
	dt {
		margin-top: var(--space-3);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
		font-weight: 600;
	}
	dd { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-primary); }
	dd.text p { margin: var(--space-1) 0 0; line-height: 1.4; }

	/* ── metric rows ──────────────────────────────────── */
	dd.metric { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); }
	.mv { font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
	.mmeta { font-size: var(--fs-xs); color: var(--text-faint); font-variant-numeric: tabular-nums; }
	/* Leader gets a filled chip plus the word "best" via ::after — colour alone
	   would be the only signal otherwise, which fails for colourblind users. */
	dd.metric.leader {
		background: var(--accent-soft);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin-left: calc(-1 * var(--space-2));
	}
	dd.metric.leader .mv { color: var(--accent); }
	dd.metric.leader::after {
		content: 'best';
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--accent);
	}
	/* --warn and --ok were never defined tokens; both fell through to their
	   fallbacks, so "provisional" and "improving" rendered as ordinary text. */
	.prov {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--warning);
	}
	.trend { font-size: var(--fs-xs); font-variant-numeric: tabular-nums; color: var(--text-muted); }
	.trend.up { color: var(--success); }

	.r { color: var(--alliance-red); font-weight: 600; }
	.b { color: var(--alliance-blue); font-weight: 600; }
	.ok { color: var(--success); }
	.bad { color: var(--danger); font-weight: 600; }
	.warn { color: var(--warning); font-weight: 600; }
	.paths {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.paths li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--fs-sm);
	}
	a { color: var(--accent); }
</style>
