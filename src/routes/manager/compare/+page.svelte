<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
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
		<a class="back" href="{base}/manager/" aria-label="Back to manager">←</a>
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
			<p class="info">
				No entries on file for: {missing.join(', ')}.
				They'll appear here as soon as a scout records something for them.
			</p>
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
							<a href="{base}/manager/team/{t.teamNumber}/">Open team page →</a>
						</dd>
					</dl>
				</section>
			{/each}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 60rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0 0.5rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.muted { color: var(--text-faint); }

	.add-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0.5rem 0 1rem;
	}
	.add-input {
		font: inherit;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		max-width: 9rem;
	}
	.add-btn {
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 0.85rem;
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.error { color: var(--danger); font-size: 0.85rem; }
	.info {
		background: #eaf3ff;
		color: #1c3a78;
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		font-size: 0.86rem;
	}
	.empty {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.75rem;
	}
	.col {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		padding: 0.75rem 0.85rem 0.5rem;
	}
	.col-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
	}
	.col-head h2 { margin: 0; font-size: 1.05rem; color: var(--accent); text-transform: none; letter-spacing: 0; }
	.remove {
		font: inherit;
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: 1.05rem;
		line-height: 1;
		padding: 0.1rem 0.4rem;
	}
	.remove:hover { color: var(--danger); }

	dl { margin: 0; padding: 0; }
	dt {
		margin-top: 0.55rem;
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
		font-weight: 600;
	}
	dd {
		margin: 0.15rem 0 0;
		font-size: 0.88rem;
		color: var(--text-primary);
	}
	dd.text p { margin: 0.2rem 0 0; line-height: 1.4; }

	.r { color: #b91c1c; font-weight: 600; }
	.b { color: #1d4ed8; font-weight: 600; }
	.ok { color: #166534; }
	.bad { color: #991b1b; font-weight: 600; }
	.warn { color: #92400e; font-weight: 600; }
	.paths { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
	.paths li { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; }
	a { color: var(--accent); }
</style>
