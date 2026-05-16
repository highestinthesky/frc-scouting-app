<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listEntries, deleteEntry } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { exportToFile } from '$lib/export.js';
	import { importFile } from '$lib/import.js';
	import { syncState } from '$lib/sync.svelte.js';
	import {
		getCachedSchedule,
		qualMatches,
		nextUnscoutedMatch,
		allianceForTeamInMatch
	} from '$lib/tba.js';
	import { relativeTime } from '$lib/format.js';

	let entries = $state([]);
	let loading = $state(true);
	let exporting = $state(false);
	let importing = $state(false);
	let lastExport = $state('');
	let lastImport = $state('');
	let exportError = $state('');
	let importError = $state('');
	let fileInput = $state();

	/** Cached qual matches for the current event — populated on mount and
	 *  refreshed when the sync layer brings new schedule data down. */
	let qmList = $state([]);
	/** Wallclock refreshed once a minute so "in 8 min" labels stay current. */
	let now = $state(new Date());

	async function refresh() {
		entries = await listEntries();
	}

	async function refreshSchedule() {
		const cached = session.eventCode
			? await getCachedSchedule(session.eventCode)
			: null;
		qmList = cached ? qualMatches(cached.matches) : [];
	}

	onMount(async () => {
		await Promise.all([refresh(), refreshSchedule()]);
		loading = false;
		const tickHandle = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(tickHandle);
	});

	// Re-read entries whenever the sync layer brings new peer rows.
	$effect(() => {
		syncState.inboundChanges; // tracked dependency
		if (!loading) refresh();
	});

	// Re-read the schedule cache when the event code changes, and (best-effort)
	// after each successful sync tick so a freshly-pulled schedule shows up
	// without a manual refresh.
	$effect(() => {
		syncState.lastSyncedAt;
		session.eventCode;
		if (!loading) refreshSchedule();
	});

	// ── next-match suggestion for the home banner ──────────────────────────────

	/** {match, teams} for the soonest match where any of my teams plays and
	 *  hasn't been recorded yet; null if nothing pending. */
	const nextSuggestion = $derived.by(() => {
		const teams = session.effectiveTeams;
		const overrides = session.overrides ?? [];
		if (!qmList.length || (!teams.length && !overrides.length)) return null;
		return nextUnscoutedMatch(qmList, entries, {
			assignedTeams: teams,
			overrides,
			scoutName: session.scoutName
		});
	});

	const nextMatchTime = $derived(
		nextSuggestion?.match
			? nextSuggestion.match.predicted_time ?? nextSuggestion.match.time ?? null
			: null
	);

	function homeBannerHref() {
		if (!nextSuggestion) return `${base}/new/`;
		const { match, teams } = nextSuggestion;
		// If only one of my teams is in the match, pre-fill that team + the
		// schedule-correct alliance. Otherwise route to /new and let the
		// banner there do the multi-team chooser.
		if (teams.length === 1) {
			const t = teams[0];
			const color = allianceForTeamInMatch(match, t);
			const qp = new URLSearchParams({
				match: String(match.match_number),
				team: String(t),
				...(color ? { color } : {})
			});
			return `${base}/new/?${qp.toString()}`;
		}
		return `${base}/new/`;
	}

	// ── live entry counter ─────────────────────────────────────────────────────

	/** Entries that belong to the current event code (for the pace counter). */
	const eventEntries = $derived(
		session.eventCode
			? entries.filter((e) => e.eventCode === session.eventCode)
			: entries
	);

	/** Entries recorded today (local calendar date). */
	const todayEntries = $derived.by(() => {
		const today = new Date().toDateString();
		return eventEntries.filter((e) => new Date(e.createdAt).toDateString() === today);
	});

	// ── actions ────────────────────────────────────────────────────────────────

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

	{#if nextSuggestion}
		{@const teams = nextSuggestion.teams}
		{@const m = nextSuggestion.match}
		{@const singleColor = teams.length === 1 ? allianceForTeamInMatch(m, teams[0]) : null}
		<a class="home-next" data-color={singleColor} href={homeBannerHref()}>
			<div class="next-body">
				<strong class="next-label">Next match</strong>
				<span class="next-detail">
					Q{m.match_number}
					{#if teams.length === 1}
						· Team {teams[0]}
						{#if singleColor} · {singleColor}{/if}
					{:else}
						· {teams.length} of your teams
					{/if}
					{#if nextMatchTime}
						<span class="next-time">· {relativeTime(nextMatchTime, now)}</span>
					{/if}
				</span>
			</div>
			<span class="next-go">Scout →</span>
		</a>
	{/if}

	{#if loading}
		<p class="muted">Loading…</p>

	{:else if entries.length === 0}
		<div class="empty">
			<p>No entries yet.</p>
			<p class="muted">Tap <strong>+ New entry</strong> to scout your first robot, or import a file a teammate shared with you.</p>
			<label class="import empty-import" aria-label="Import scouting files">
				<input type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={doImport} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import data'}</span>
			</label>
			{#if lastImport}<p class="muted small">{lastImport}</p>{/if}
			{#if importError}<p class="error small">{importError}</p>{/if}
		</div>

	{:else}
		<!-- ── Pace counter ──────────────────────────────────────────── -->
		<p class="pace">
			{eventEntries.length} {eventEntries.length === 1 ? 'entry' : 'entries'} this event
			{#if todayEntries.length > 0}
				· <strong>{todayEntries.length}</strong> today
			{/if}
		</p>

		<div class="export-bar">
			<label class="import" aria-label="Import scouting files">
				<input bind:this={fileInput} type="file" accept=".scout,.json,application/json,application/octet-stream" multiple onchange={doImport} disabled={importing} />
				<span>{importing ? 'Importing…' : 'Import data'}</span>
			</label>
			<button class="export" onclick={doExport} disabled={exporting}>
				{exporting ? 'Exporting…' : `Export ${entries.length} entries`}
			</button>
			{#if lastImport}<small class="muted">{lastImport}</small>{/if}
			{#if importError}<small class="error">{importError}</small>{/if}
			{#if lastExport}<small class="muted">{lastExport}</small>{/if}
			{#if exportError}<small class="error">{exportError}</small>{/if}
		</div>

		<ul class="entries">
			{#each entries as e (e.id)}
				<li class="entry" data-color={e.allianceColor}>
					<div class="row">
						<!-- Tapping the identity area navigates to the edit page -->
						<a class="entry-link" href="{base}/edit/?id={e.id}" aria-label="Edit entry Q{e.matchNumber} · Team {e.teamNumber}">
							<span class="match">Q{e.matchNumber}</span>
							<span class="team">Team {e.teamNumber}</span>
							<span class="alliance">{e.allianceColor}</span>
						</a>
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
						<span class="edit-hint">Tap name/match to edit</span>
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
		margin: 1rem 0 0.75rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.muted { color: var(--text-faint); }
	.error { color: var(--danger); }
	.primary {
		display: inline-block;
		padding: 0.55rem 1rem;
		background: var(--accent);
		color: var(--on-accent);
		text-decoration: none;
		border-radius: 0.4rem;
		font-weight: 600;
	}

	/* ── next-match banner ───────────────────────────────────────── */
	.home-next {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 0.85rem;
		margin: 0 0 1rem;
		border-radius: 0.5rem;
		border: 1.5px solid var(--banner-info-border);
		background: var(--banner-info-bg);
		color: inherit;
		text-decoration: none;
	}
	.home-next[data-color='red'] {
		background: var(--banner-red-bg);
		border-color: var(--banner-red-border);
	}
	.home-next[data-color='blue'] {
		background: var(--banner-blue-bg);
		border-color: var(--banner-blue-border);
	}
	.home-next:hover { filter: brightness(0.98); }
	.next-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.next-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.next-detail {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.next-time {
		font-weight: 400;
		color: var(--text-muted);
		margin-left: 0.15rem;
	}
	.next-go {
		font-weight: 700;
		color: var(--accent);
		font-size: 0.9rem;
		white-space: nowrap;
	}

	/* ── pace counter ─────────────────────────────────────────────── */
	.pace {
		margin: 0 0 0.75rem;
		font-size: 0.88rem;
		color: var(--text-muted);
	}
	.pace strong { color: var(--accent); }

	/* ── export bar ───────────────────────────────────────────────── */
	.export-bar {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}
	.export {
		align-self: flex-start;
		padding: 0.5rem 0.9rem;
		background: var(--bg-card);
		border: 1px solid var(--accent);
		color: var(--accent);
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
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		color: var(--text-primary);
		font: inherit;
		font-weight: 600;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.import:hover { background: var(--bg-subtle); }
	.import input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.export:hover { background: var(--accent-soft); }
	.export:disabled { opacity: 0.6; cursor: progress; }

	/* ── entry list ───────────────────────────────────────────────── */
	.empty { margin-top: 3rem; text-align: center; }
	.entries {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.entry {
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.4rem;
		padding: 0.7rem 0.85rem;
		background: var(--bg-card);
	}
	.entry[data-color='red'] { border-left-color: #c0392b; }
	.entry[data-color='blue'] { border-left-color: #2c5cb0; }

	/* ── tappable entry link ──────────────────────────────────────── */
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.95rem;
	}
	.entry-link {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex: 1 1 0;
		min-width: 0;
		text-decoration: none;
		color: inherit;
		border-radius: 0.25rem;
		padding: 0.1rem 0.2rem;
		margin: -0.1rem -0.2rem;
	}
	.entry-link:hover { background: var(--bg-subtle); }
	.entry-link:focus-visible { outline: 2px solid var(--accent); }
	.match { font-weight: 700; color: var(--accent); }
	.team { font-weight: 600; }
	.alliance {
		text-transform: capitalize;
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.delete {
		background: transparent;
		border: none;
		font-size: 1.4rem;
		line-height: 1;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0.1rem 0.5rem;
		flex-shrink: 0;
	}
	.delete:hover { color: var(--danger); }

	.entry p {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
		line-height: 1.35;
	}
	.entry p strong {
		display: inline-block;
		width: 1rem;
		color: var(--accent);
	}
	.entry p.brokedown { color: var(--danger); font-weight: 600; }
	.entry p.brokedown strong { color: var(--danger); }

	.empty .empty-import { display: inline-block; margin-top: 1rem; align-self: center; }
	.empty .small { font-size: 0.85rem; margin-top: 0.5rem; }

	.timestamp {
		display: block;
		margin-top: 0.45rem;
		font-size: 0.8rem;
	}
	.edit-hint {
		margin-left: 0.4rem;
		color: var(--text-faint);
		font-style: italic;
	}
</style>
