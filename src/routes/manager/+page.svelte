<script>
	import { onMount } from 'svelte';
	import { summarize } from '$lib/aggregate.js';
	import { importFile } from '$lib/import.js';
	import { exportToFile } from '$lib/export.js';
	import { session } from '$lib/session.svelte.js';

	let summary = $state(null);
	let loading = $state(true);
	let importing = $state(false);
	let exporting = $state(false);
	let importMessage = $state('');
	let importError = $state('');
	let exportMessage = $state('');
	let expanded = $state(new Set());
	let fileInput = $state();
	let teamQuery = $state('');
	let sortBy = $state('entries');

	const sortOptions = [
		{ value: 'entries', label: 'most entries' },
		{ value: 'recent', label: 'most recent update' },
		{ value: 'auto-paths', label: 'most auto path sightings' },
		{ value: 'breakdowns', label: 'most breakdowns' },
		{ value: 'defense', label: 'most defense notes' }
	];

	function minutesAgo(iso) {
		if (!iso) return '—';
		const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m`;
		const hrs = Math.floor(minutes / 60);
		if (hrs < 24) return `${hrs}h`;
		return `${Math.floor(hrs / 24)}d`;
	}

	function preview(text) {
		if (!text) return 'No strengths notes yet.';
		if (text.length <= 80) return text;
		return `${text.slice(0, 80)}…`;
	}

	async function refresh() {
		summary = await summarize();
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	async function handleFiles(e) {
		const files = [...(e.target.files ?? [])];
		if (files.length === 0) return;
		importing = true;
		importError = '';
		importMessage = '';
		let totalInserted = 0;
		let totalSkipped = 0;
		const filesProcessed = [];
		try {
			for (const file of files) {
				try {
					const result = await importFile(file);
					totalInserted += result.inserted;
					totalSkipped += result.skipped;
					filesProcessed.push(`${file.name} (+${result.inserted}, =${result.skipped})`);
				} catch (err) {
					filesProcessed.push(`${file.name}: ${err.message}`);
					importError = err.message;
				}
			}
			importMessage = `Imported: ${totalInserted} new, ${totalSkipped} duplicate(s) skipped.\n${filesProcessed.join('\n')}`;
			await refresh();
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}

	function toggle(team) {
		if (expanded.has(team)) expanded.delete(team);
		else expanded.add(team);
		expanded = new Set(expanded);
	}

	function isExpanded(teamNumber) {
		return expanded.has(teamNumber);
	}

	function percent(part, total) {
		if (!total) return 0;
		return (part / total) * 100;
	}

	async function exportCombined() {
		if (!summary || summary.totalEntries === 0) {
			importError = 'Nothing to export — import some scout files first.';
			return;
		}
		exporting = true;
		exportMessage = '';
		try {
			const { filename, count } = await exportToFile({
				kind: 'manager-export',
				exportedBy: session.scoutName || 'manager',
				eventCode: session.eventCode || (summary.events[0] ?? null)
			});
			exportMessage = `Exported ${count} entries → ${filename}`;
		} catch (err) {
			importError = err.message ?? String(err);
		} finally {
			exporting = false;
		}
	}

	const filteredTeams = $derived.by(() => {
		if (!summary) return [];
		const q = teamQuery.trim();
		let list = summary.teams.filter((t) => (q ? String(t.teamNumber).includes(q) : true));
		list = list.slice().sort((a, b) => {
			if (sortBy === 'recent') return new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt);
			if (sortBy === 'auto-paths') {
				return b.autoPathEntryCount - a.autoPathEntryCount || b.autoPathCount - a.autoPathCount;
			}
			if (sortBy === 'breakdowns') return b.breakdownCount - a.breakdownCount || b.entryCount - a.entryCount;
			if (sortBy === 'defense') return b.defenseCount - a.defenseCount || b.entryCount - a.entryCount;
			return b.entryCount - a.entryCount || a.teamNumber - b.teamNumber;
		});
		return list;
	});
</script>

<svelte:head>
	<title>Manager · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<h1>Manager</h1>
		{#if summary}
			<div class="updated">{summary.totalEntries} entries · last {minutesAgo(summary.lastCreatedAt)} ago</div>
		{/if}
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if summary.totalEntries === 0}
		<div class="empty">
			<p>No entries yet.</p>
			<p class="muted">Import <code>.scout</code> files to start analysis.</p>
			<label class="btn secondary import-btn empty-import">
				<input type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={handleFiles} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import scout files'}</span>
			</label>
			{#if importMessage}<pre class="info">{importMessage}</pre>{/if}
			{#if importError}<p class="error">{importError}</p>{/if}
		</div>
	{:else}
		<section class="stats">
			<div class="stat"><small>Entries</small><span>{summary.totalEntries}</span></div>
			<div class="stat"><small>Teams</small><span>{summary.teamCount}</span></div>
			<div class="stat"><small>Matches</small><span>{summary.matchCount}</span></div>
			<div class="stat"><small>Scouts</small><span>{summary.scoutCount}</span></div>
		</section>

		<input class="filter" placeholder="Find team #" bind:value={teamQuery} />

		<section class="sort" aria-label="Sort teams">
			{#each sortOptions as o}
				<button
					type="button"
					class="sort-btn {sortBy === o.value ? 'active' : ''}"
					onclick={() => (sortBy = o.value)}
					aria-pressed={sortBy === o.value}
				>
					{o.label}
				</button>
			{/each}
		</section>

		<section class="actions">
			<label class="btn secondary import-btn">
				<input bind:this={fileInput} type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={handleFiles} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import'}</span>
			</label>
			<button class="btn primary" onclick={exportCombined} disabled={exporting || !summary || summary.totalEntries === 0}>{exporting ? 'Exporting…' : 'Export .scout'}</button>
		</section>

		<section class="chips">
			<span class="chip active">Event: {session.eventCode || summary.events[0] || 'unknown'}</span>
			<span class="chip">All scouts</span>
			<span class="chip">Both alliances</span>
		</section>

		{#if importMessage}<pre class="info">{importMessage}</pre>{/if}
		{#if exportMessage}<p class="info">{exportMessage}</p>{/if}
		{#if importError}<p class="error">{importError}</p>{/if}

		<ul class="teams">
			{#each filteredTeams as t (t.teamNumber)}
				<li class="team {isExpanded(t.teamNumber) ? 'open' : ''}">
					<button class="team-row" onclick={() => toggle(t.teamNumber)} aria-expanded={isExpanded(t.teamNumber)}>
						<div class="left">
							<strong>Team {t.teamNumber}</strong>
							<div class="bar"><span class="red" style={`width:${percent(t.redCount, t.entryCount)}%`}></span><span class="blue" style={`width:${percent(t.blueCount, t.entryCount)}%`}></span></div>
							<span class="counts">{t.entryCount} entries · {t.matchesCovered} matches · {t.scoutsCovered} scouts</span>
						</div>
						<div class="right">
							{#if t.autoPathEntryCount > 0}<span class="badge path">{t.autoPathEntryCount} auto path{t.autoPathEntryCount === 1 ? '' : 's'}</span>{/if}
							{#if t.breakdownCount > 0}<span class="badge bad">{t.breakdownCount} breakdown{t.breakdownCount === 1 ? '' : 's'}</span>{/if}
							{#if t.defenseCount > 0}<span class="badge">{t.defenseCount} defense</span>{/if}
							<span class="age">{minutesAgo(t.latestCreatedAt)}</span>
							<span class="chev">{isExpanded(t.teamNumber) ? '▾' : '▸'}</span>
						</div>
					</button>
					<p class="preview">Strengths preview: {preview(t.strengthsPreview)}</p>

					{#if isExpanded(t.teamNumber)}
						{#if t.autoPathCount > 0}
							<div class="paths-block">
								<h3>Auto pathings ({t.autoPathEntryCount})</h3>
								<ul class="path-list">
									{#each t.autoPaths as p (p.pathName)}
										<li><span>{p.pathName}</span><strong>{p.count}</strong></li>
									{/each}
								</ul>
							</div>
						{/if}
						<ul class="team-entries">
							{#each t.entries.slice(0, 3) as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
								<li class="team-entry" data-color={e.allianceColor}>
									<div class="hdr"><strong>Q{e.matchNumber}</strong><span class="alliance">{e.allianceColor}</span><span class="muted by">by {e.scoutName}</span></div>
									{#if e.observations?.strengths}<p><strong>+</strong> {e.observations.strengths}</p>{/if}
									{#if e.observations?.weaknesses}<p><strong>−</strong> {e.observations.weaknesses}</p>{/if}
									{#if e.observations?.defense}<p><strong>D</strong> {e.observations.defense}</p>{/if}
									{#if e.observations?.brokeDown === true}<p class="brokedown"><strong>!</strong> Broke down</p>{/if}
									{#if e.observations?.comments}<p><strong>·</strong> {e.observations.comments}</p>{/if}
									{#if e.observations?.failures && e.observations?.brokeDown === undefined}<p><strong>!</strong> {e.observations.failures}</p>{/if}
								</li>
							{/each}
							{#if t.entries.length > 3}<li class="more">+ {t.entries.length - 3} more entries</li>{/if}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
		margin: 1rem 0;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.updated { color: #777; font-size: 0.9rem; }
	.muted { color: #777; font-size: 0.95rem; }

	.empty {
		background: #f7f7f7;
		border: 1px solid #e5e5e5;
		border-radius: 0.5rem;
		padding: 0.9rem 1rem;
	}
	.empty .empty-import { margin-top: 0.75rem; display: inline-block; }

	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.stat {
		background: #f5f6f9;
		border: 1px solid #d9deea;
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	.stat small { display: block; color: #555; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
	.stat span { font-size: 1.25rem; font-weight: 700; }

	.filter {
		margin-top: 0.75rem;
		width: 100%;
		border-radius: 0.4rem;
		border: 1px solid #ccc;
		padding: 0.6rem 0.7rem;
		font: inherit;
	}
	.sort {
		margin-top: 0.75rem;
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.sort-btn {
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		border: 1px solid #cfd8ec;
		background: #f4f7ff;
		color: #24427a;
		padding: 0.38rem 0.62rem;
		border-radius: 999px;
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
	}
	.sort-btn:hover {
		background: #e8eefc;
		border-color: #bccbea;
	}
	.sort-btn.active {
		background: #0b3d91;
		color: #fff;
		border-color: #0b3d91;
	}
	.actions { margin-top: 0.75rem; display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.btn {
		padding: 0.6rem 1rem;
		border-radius: 0.4rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.btn.primary {
		background: #0b3d91;
		color: white;
	}
	.btn.primary:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.btn.secondary {
		background: white;
		border-color: #ccc;
		color: #222;
	}
	.btn.secondary:hover { background: #f8f8f8; }
	.import-btn { position: relative; display: inline-block; }
	.import-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

	.chips { display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap; }
	.chip { background: #f0f0f0; border-radius: 999px; padding: 0.25rem 0.6rem; color: #555; font-size: 0.85rem; }
	.chip.active { background: #f0f4fc; color: #0b3d91; }

	.teams { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.6rem; }
	.team { border: 1px solid #d8d8d8; border-radius: 0.6rem; background: #fff; overflow: hidden; }
	.team-row {
		width: 100%;
		border: none;
		background: transparent;
		padding: 0.75rem 0.8rem 0.5rem;
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.left { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.left strong { font-size: 1.05rem; }
	.bar { width: 3.5rem; height: 0.65rem; background: #ececec; border-radius: 999px; overflow: hidden; display: flex; }
	.red { background: #e14c4c; }
	.blue { background: #3c84d6; }
	.counts { color: #666; font-size: 0.85rem; }
	.right { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; justify-content: flex-end; }
	.badge { background: #ecebe5; border-radius: 999px; padding: 0.15rem 0.5rem; color: #444; font-size: 0.8rem; }
	.badge.bad { background: #f6e8e8; color: #8e2c2c; }
	.badge.path { background: #f3e8ff; color: #6b21a8; }
	.paths-block { margin: 0 0.55rem 0.4rem; padding: 0.55rem 0.6rem; border: 1px solid #dfd6ff; background: #f7f3ff; border-radius: 0.4rem; }
	.paths-block h3 { margin: 0; font-size: 0.9rem; }
	.path-list { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.35rem; }
	.path-list li { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.88rem; }

	.age { color: #666; font-size: 0.8rem; }
	.preview { margin: 0; padding: 0 0.8rem 0.75rem; color: #333; font-size: 0.9rem; }

	.team-entries {
		list-style: none;
		margin: 0;
		padding: 0.55rem;
		border-top: 1px solid #ddd;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.team-entry { background: #fafafa; border-radius: 0.45rem; padding: 0.6rem 0.75rem; border-left: 4px solid #999; }
	.team-entry[data-color='red'] { border-left-color: #e14c4c; }
	.team-entry[data-color='blue'] { border-left-color: #3c84d6; }
	.hdr { display: flex; gap: 0.4rem; align-items: baseline; font-size: 0.92rem; }
	.alliance { text-transform: capitalize; color: #666; }
	.by { margin-left: auto; font-size: 0.8rem; }
	.team-entry p { margin: 0.25rem 0 0; font-size: 0.9rem; }
	.team-entry p.brokedown { color: #8e2c2c; font-weight: 600; }
	.more { text-align: center; color: #666; padding-top: 0.2rem; font-size: 0.85rem; }
	.error { background: #fdecea; color: #842029; padding: 0.6rem 0.75rem; border-radius: 0.4rem; margin: 0.5rem 0; }
	.info { background: #eaf3ff; color: #1c3a78; padding: 0.6rem 0.75rem; border-radius: 0.4rem; margin: 0.5rem 0; white-space: pre-wrap; }
</style>
