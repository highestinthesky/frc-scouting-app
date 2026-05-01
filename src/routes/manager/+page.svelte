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
		{ value: 'failures', label: 'most failures' },
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
			if (sortBy === 'failures') return b.failureCount - a.failureCount || b.entryCount - a.entryCount;
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
		</div>
	{:else}
		<section class="stats">
			<div class="stat"><small>Entries</small><span>{summary.totalEntries}</span></div>
			<div class="stat"><small>Teams</small><span>{summary.teamCount}</span></div>
			<div class="stat"><small>Matches</small><span>{summary.matchCount}</span></div>
			<div class="stat"><small>Scouts</small><span>{summary.scoutCount}</span></div>
		</section>

		<input class="filter" placeholder="Find team #" bind:value={teamQuery} />

		<select class="sort" bind:value={sortBy}>
			{#each sortOptions as o}
				<option value={o.value}>Sort: {o.label}</option>
			{/each}
		</select>

		<section class="actions">
			<label class="btn import-btn">
				<input bind:this={fileInput} type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={handleFiles} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import'}</span>
			</label>
			<button class="btn" onclick={exportCombined} disabled={exporting || !summary || summary.totalEntries === 0}>{exporting ? 'Exporting…' : 'Export .scout'}</button>
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
				<li class="team {expanded.has(t.teamNumber) ? 'open' : ''}">
					<button class="team-row" onclick={() => toggle(t.teamNumber)} aria-expanded={expanded.has(t.teamNumber)}>
						<div class="left">
							<strong>Team {t.teamNumber}</strong>
							<div class="bar"><span class="red" style={`width:${(t.redCount / t.entryCount) * 100}%`}></span><span class="blue" style={`width:${(t.blueCount / t.entryCount) * 100}%`}></span></div>
							<span class="counts">{t.entryCount} entries · {t.matchesCovered} matches · {t.scoutsCovered} scouts</span>
						</div>
						<div class="right">
							{#if t.failureCount > 0}<span class="badge bad">{t.failureCount} failure{t.failureCount === 1 ? '' : 's'}</span>{/if}
							{#if t.defenseCount > 0}<span class="badge">{t.defenseCount} defense</span>{/if}
							<span class="age">{minutesAgo(t.latestCreatedAt)}</span>
							<span class="chev">{expanded.has(t.teamNumber) ? '▾' : '▸'}</span>
						</div>
					</button>
					<p class="preview">Strengths preview: {preview(t.strengthsPreview)}</p>

					{#if expanded.has(t.teamNumber)}
						<ul class="team-entries">
							{#each t.entries.slice(0, 3) as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
								<li class="team-entry" data-color={e.allianceColor}>
									<div class="hdr"><strong>Q{e.matchNumber}</strong><span class="alliance">{e.allianceColor}</span><span class="muted by">by {e.scoutName}</span></div>
									{#if e.observations?.strengths}<p><strong>+</strong> {e.observations.strengths}</p>{/if}
									{#if e.observations?.weaknesses}<p><strong>−</strong> {e.observations.weaknesses}</p>{/if}
									{#if e.observations?.defense}<p><strong>D</strong> {e.observations.defense}</p>{/if}
									{#if e.observations?.failures}<p><strong>!</strong> {e.observations.failures}</p>{/if}
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
	main { max-width: 64rem; margin: 1.2rem auto; padding: 0 1rem 4rem; font-family: system-ui, -apple-system, sans-serif; }
	.page-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; }
	h1 { margin: 0; font-size: 2rem; }
	.updated { color: #555; font-size: 1.2rem; }
	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.8rem; }
	.stat { background: #efede8; border-radius: 0.75rem; padding: 1rem; }
	.stat small { display: block; color: #444; font-size: 1.05rem; }
	.stat span { font-size: 2.1rem; font-weight: 700; }
	.filter, .sort { margin-top: 0.9rem; width: 100%; border-radius: 0.65rem; border: 1px solid #ccc; padding: 0.8rem 1rem; font-size: 1.1rem; }
	.actions { margin-top: 0.8rem; display: flex; gap: 0.6rem; }
	.btn { border: 1px solid #b8b8b8; border-radius: 0.65rem; background: #fff; padding: 0.65rem 1.15rem; font: inherit; cursor: pointer; }
	.import-btn { position: relative; display: inline-block; }
	.import-btn input { position: absolute; inset: 0; opacity: 0; }
	.chips { display: flex; gap: 0.5rem; margin-top: 0.9rem; }
	.chip { background: #eceae4; border-radius: 1rem; padding: 0.35rem 0.75rem; color: #444; }
	.chip.active { background: #cddcf0; color: #1d4f99; }
	.teams { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.7rem; }
	.team { border: 1px solid #d1d1d1; border-radius: 0.9rem; background: #fff; overflow: hidden; }
	.team-row { width: 100%; border: none; background: transparent; padding: 0.9rem 1rem 0.55rem; display: flex; justify-content: space-between; gap: 1rem; text-align: left; cursor: pointer; font: inherit; }
	.left { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
	.left strong { font-size: 2rem; }
	.bar { width: 4.4rem; height: 1.3rem; background: #ececec; border-radius: 0.3rem; overflow: hidden; display: flex; }
	.red { background: #e14c4c; }
	.blue { background: #3c84d6; }
	.counts { color: #444; font-size: 2rem; }
	.right { display: flex; align-items: center; gap: 0.6rem; }
	.badge { background: #ecebe5; border-radius: 0.7rem; padding: 0.2rem 0.65rem; color: #444; }
	.badge.bad { background: #f6e8e8; color: #8e2c2c; }
	.age { color: #666; }
	.preview { margin: 0; padding: 0 1rem 0.85rem; color: #333; font-size: 1.3rem; }
	.team-entries { list-style: none; margin: 0; padding: 0.6rem; border-top: 1px solid #ddd; display: flex; flex-direction: column; gap: 0.5rem; }
	.team-entry { background: #fafafa; border-radius: 0.6rem; padding: 0.7rem 0.9rem; border-left: 4px solid #999; }
	.team-entry[data-color='red'] { border-left-color: #e14c4c; }
	.team-entry[data-color='blue'] { border-left-color: #3c84d6; }
	.hdr { display: flex; gap: 0.5rem; font-size: 1.7rem; }
	.by { margin-left: auto; }
	.team-entry p { margin: 0.25rem 0 0; font-size: 1.1rem; }
	.more { text-align: center; color: #666; padding-top: 0.2rem; }
	.error { background: #fdecea; color: #842029; padding: 0.6rem 0.75rem; border-radius: 0.4rem; margin: 0.5rem 0; }
	.info { background: #eaf3ff; color: #1c3a78; padding: 0.6rem 0.75rem; border-radius: 0.4rem; margin: 0.5rem 0; white-space: pre-wrap; }
</style>
