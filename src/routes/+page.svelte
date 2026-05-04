<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listEntries, deleteEntry } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { exportToFile } from '$lib/export.js';
	import { importFile } from '$lib/import.js';

	let entries = $state([]);
	let loading = $state(true);
	let exporting = $state(false);
	let importing = $state(false);
	let lastExport = $state('');
	let lastImport = $state('');
	let exportError = $state('');
	let importError = $state('');
	let fileInput = $state();

	async function refresh() {
		entries = await listEntries();
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	async function remove(id, summary) {
		if (!confirm(`Delete entry: ${summary}?`)) return;
		await deleteEntry(id);
		await refresh();
	}

	async function doExport() {
		if (entries.length === 0) {
			exportError = 'Nothing to export yet.';
			return;
		}
		exportError = '';
		exporting = true;
		try {
			const { filename, count } = await exportToFile({
				kind: 'scout-export',
				exportedBy: session.scoutName,
				eventCode: session.eventCode
			});
			lastExport = `Exported ${count} entries → ${filename}`;
		} catch (err) {
			exportError = err.message ?? String(err);
		} finally {
			exporting = false;
		}
	}

	async function doImport(e) {
		const files = [...(e.target.files ?? [])];
		if (files.length === 0) return;
		importing = true;
		importError = '';
		lastImport = '';
		let totalInserted = 0;
		let totalSkipped = 0;
		try {
			for (const file of files) {
				const result = await importFile(file);
				totalInserted += result.inserted;
				totalSkipped += result.skipped;
			}
			await refresh();
			lastImport = `Imported ${totalInserted} new entr${totalInserted === 1 ? 'y' : 'ies'} (${totalSkipped} duplicate${totalSkipped === 1 ? '' : 's'} skipped).`;
		} catch (err) {
			importError = err.message ?? String(err);
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<svelte:head>
	<title>FRC Scout</title>
</svelte:head>

<main>
	<div class="top">
		<h1>Entries</h1>
		<a class="primary" href="{base}/new/">+ New entry</a>
	</div>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if entries.length === 0}
		<div class="empty">
			<p>No entries yet.</p>
			<p class="muted">Tap <strong>+ New entry</strong> to scout your first robot.</p>
		</div>
	{:else}
		<div class="export-bar">
			<label class="import" aria-label="Import scouting files">
				<input bind:this={fileInput} type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={doImport} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import data'}</span>
			</label>
			<button class="export" onclick={doExport} disabled={exporting}>
				{exporting ? 'Exporting…' : `Export ${entries.length} entries`}
			</button>
			{#if lastImport}
				<small class="muted">{lastImport}</small>
			{/if}
			{#if importError}
				<small class="error">{importError}</small>
			{/if}
			{#if lastExport}
				<small class="muted">{lastExport}</small>
			{/if}
			{#if exportError}
				<small class="error">{exportError}</small>
			{/if}
		</div>

		<ul class="entries">
			{#each entries as e (e.id)}
				<li class="entry" data-color={e.allianceColor}>
					<div class="row">
						<span class="match">Q{e.matchNumber}</span>
						<span class="team">Team {e.teamNumber}</span>
						<span class="alliance">{e.allianceColor}</span>
						<button
							class="delete"
							aria-label="Delete entry"
							onclick={() => remove(e.id, `Q${e.matchNumber} · Team ${e.teamNumber}`)}
						>
							×
						</button>
					</div>
					{#if e.observations}
						{#if e.observations.strengths}
							<p><strong>+</strong> {e.observations.strengths}</p>
						{/if}
						{#if e.observations.weaknesses}
							<p><strong>−</strong> {e.observations.weaknesses}</p>
						{/if}
						{#if e.observations.defense}
							<p><strong>D</strong> {e.observations.defense}</p>
						{/if}
						{#if e.observations.brokeDown === true}
							<p class="brokedown"><strong>!</strong> Broke down</p>
						{/if}
						{#if e.observations.comments}
							<p><strong>·</strong> {e.observations.comments}</p>
						{/if}
						{#if e.observations.failures && e.observations.brokeDown === undefined}
							<p><strong>!</strong> {e.observations.failures}</p>
						{/if}
					{/if}
					<small class="muted timestamp">
						{e.scoutName} · {new Date(e.createdAt).toLocaleString()}
					</small>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 38rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 1rem 0 1.25rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.muted { color: #777; }
	.error { color: #c0392b; }
	.primary {
		display: inline-block;
		padding: 0.55rem 1rem;
		background: #0b3d91;
		color: white;
		text-decoration: none;
		border-radius: 0.4rem;
		font-weight: 600;
	}
	.export-bar {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}
	.export {
		align-self: flex-start;
		padding: 0.5rem 0.9rem;
		background: white;
		border: 1px solid #0b3d91;
		color: #0b3d91;
		font: inherit;
		font-weight: 600;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.import {
		position: relative;
		display: inline-block;
		align-self: flex-start;
		padding: 0.5rem 0.9rem;
		background: white;
		border: 1px solid #ccc;
		color: #333;
		font: inherit;
		font-weight: 600;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.import:hover { background: #f5f5f5; }
	.import input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.export:hover { background: #f0f4fc; }
	.export:disabled { opacity: 0.6; cursor: progress; }
	.empty {
		margin-top: 3rem;
		text-align: center;
	}
	.entries {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.entry {
		border: 1px solid #e0e0e0;
		border-left: 4px solid #999;
		border-radius: 0.4rem;
		padding: 0.7rem 0.85rem;
		background: white;
	}
	.entry[data-color='red'] { border-left-color: #c0392b; }
	.entry[data-color='blue'] { border-left-color: #2c5cb0; }
	.row {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		font-size: 0.95rem;
	}
	.match {
		font-weight: 700;
		color: #0b3d91;
	}
	.team { font-weight: 600; }
	.alliance {
		text-transform: capitalize;
		color: #666;
		font-size: 0.85rem;
	}
	.delete {
		margin-left: auto;
		background: transparent;
		border: none;
		font-size: 1.4rem;
		line-height: 1;
		color: #999;
		cursor: pointer;
		padding: 0.1rem 0.5rem;
	}
	.delete:hover { color: #c0392b; }
	.entry p {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
		line-height: 1.35;
	}
	.entry p strong {
		display: inline-block;
		width: 1rem;
		color: #0b3d91;
	}
	.entry p.brokedown { color: #8e2c2c; font-weight: 600; }
	.entry p.brokedown strong { color: #8e2c2c; }
	.timestamp {
		display: block;
		margin-top: 0.45rem;
		font-size: 0.8rem;
	}
</style>
