<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { importFile } from '$lib/import.js';
	import { exportToFile } from '$lib/export.js';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';

	let summary = $state(null);
	let loading = $state(true);
	let importing = $state(false);
	let exporting = $state(false);
	let importMessage = $state('');
	let importError = $state('');
	let exportMessage = $state('');
	let expanded = $state(new Set());
	let fileInput;

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
			// Clear the input so re-selecting the same file fires onchange.
			if (fileInput) fileInput.value = '';
		}
	}

	function toggle(team) {
		if (expanded.has(team)) {
			expanded.delete(team);
		} else {
			expanded.add(team);
		}
		expanded = new Set(expanded); // trigger reactivity
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
</script>

<svelte:head>
	<title>Manager · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<h1>Manager</h1>
		{#if !role.isManager}
			<a class="muted" href="{base}/settings/">Switch to manager mode in Settings →</a>
		{/if}
	</header>

	<section class="actions">
		<label class="import-btn">
			<input
				bind:this={fileInput}
				type="file"
				accept=".scout,.json,application/json,application/octet-stream"
				multiple
				onchange={handleFiles}
				disabled={importing}
			/>
			<span>{importing ? 'Importing…' : 'Import scout files'}</span>
		</label>

		<button
			class="export"
			onclick={exportCombined}
			disabled={exporting || !summary || summary.totalEntries === 0}
		>
			{exporting ? 'Exporting…' : 'Export combined file'}
		</button>
	</section>

	{#if importMessage}
		<pre class="info">{importMessage}</pre>
	{/if}
	{#if exportMessage}
		<p class="info">{exportMessage}</p>
	{/if}
	{#if importError}
		<p class="error">{importError}</p>
	{/if}

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if summary.totalEntries === 0}
		<div class="empty">
			<p>No entries yet.</p>
			<p class="muted">
				Tap <strong>Import scout files</strong> to load <code>.scout</code> files
				your scouts shared with you.
			</p>
		</div>
	{:else}
		<section class="stats">
			<div class="stat"><span>{summary.totalEntries}</span><small>entries</small></div>
			<div class="stat"><span>{summary.teamCount}</span><small>teams</small></div>
			<div class="stat"><span>{summary.matchCount}</span><small>matches</small></div>
			<div class="stat"><span>{summary.scoutCount}</span><small>scouts</small></div>
		</section>

		<section class="meta">
			<p>
				<strong>Events:</strong> {summary.events.join(', ') || '—'}
			</p>
			<p>
				<strong>Scouts:</strong> {summary.scouts.join(', ') || '—'}
			</p>
		</section>

		<h2>Teams</h2>
		<ul class="teams">
			{#each summary.teams as t (t.teamNumber)}
				<li class="team">
					<button class="team-row" onclick={() => toggle(t.teamNumber)} aria-expanded={expanded.has(t.teamNumber)}>
						<span class="num">Team {t.teamNumber}</span>
						<span class="counts">
							{t.entryCount} {t.entryCount === 1 ? 'entry' : 'entries'} ·
							{t.matchesCovered} matches ·
							{t.scoutsCovered} {t.scoutsCovered === 1 ? 'scout' : 'scouts'}
						</span>
						<span class="chev">{expanded.has(t.teamNumber) ? '▾' : '▸'}</span>
					</button>
					{#if expanded.has(t.teamNumber)}
						<ul class="team-entries">
							{#each t.entries as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
								<li class="team-entry" data-color={e.allianceColor}>
									<div class="hdr">
										<strong>Q{e.matchNumber}</strong>
										<span class="alliance">{e.allianceColor}</span>
										<span class="muted by">by {e.scoutName}</span>
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
										{#if e.observations.failures}
											<p><strong>!</strong> {e.observations.failures}</p>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 42rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 1rem 0 1rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #666;
	}
	.muted { color: #777; }
	.error {
		background: #fdecea;
		color: #842029;
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0;
	}
	.info {
		background: #eaf3ff;
		color: #1c3a78;
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0;
		font-family: inherit;
		font-size: 0.9rem;
		white-space: pre-wrap;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.import-btn {
		position: relative;
		display: inline-block;
	}
	.import-btn input {
		position: absolute;
		opacity: 0;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}
	.import-btn span {
		display: inline-block;
		padding: 0.55rem 1rem;
		background: #0b3d91;
		color: white;
		border-radius: 0.4rem;
		font-weight: 600;
		cursor: pointer;
	}
	.export {
		padding: 0.55rem 1rem;
		background: white;
		border: 1px solid #0b3d91;
		color: #0b3d91;
		font: inherit;
		font-weight: 600;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.export:hover:not(:disabled) { background: #f0f4fc; }
	.export:disabled { opacity: 0.6; cursor: not-allowed; }
	.empty { margin-top: 3rem; text-align: center; }
	code {
		background: #f0f0f0;
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin: 1rem 0;
	}
	.stat {
		background: white;
		border: 1px solid #e0e0e0;
		border-radius: 0.4rem;
		padding: 0.6rem;
		text-align: center;
	}
	.stat span {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		color: #0b3d91;
	}
	.stat small { color: #777; font-size: 0.8rem; }
	.meta p { margin: 0.3rem 0; font-size: 0.9rem; }

	.teams {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.team {
		border: 1px solid #e0e0e0;
		border-radius: 0.4rem;
		background: white;
		overflow: hidden;
	}
	.team-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		padding: 0.7rem 0.85rem;
		background: transparent;
		border: none;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.team-row:hover { background: #f7f8fb; }
	.num { font-weight: 700; color: #0b3d91; min-width: 5rem; }
	.counts { color: #555; font-size: 0.9rem; flex: 1; }
	.chev { color: #999; }

	.team-entries {
		list-style: none;
		margin: 0;
		padding: 0 0.5rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.team-entry {
		padding: 0.5rem 0.7rem;
		border-left: 3px solid #999;
		background: #fafafa;
		border-radius: 0.3rem;
	}
	.team-entry[data-color='red'] { border-left-color: #c0392b; }
	.team-entry[data-color='blue'] { border-left-color: #2c5cb0; }
	.hdr { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.9rem; }
	.alliance { color: #666; text-transform: capitalize; font-size: 0.8rem; }
	.by { font-size: 0.85rem; margin-left: auto; }
	.team-entry p {
		margin: 0.3rem 0 0;
		font-size: 0.88rem;
		line-height: 1.35;
	}
	.team-entry p strong {
		display: inline-block;
		width: 1rem;
		color: #0b3d91;
	}
</style>
