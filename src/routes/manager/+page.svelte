<script>
	import { onMount } from 'svelte';
	import { summarize } from '$lib/aggregate.js';
	import { importFile } from '$lib/import.js';
	import { exportToFile, exportToCsv } from '$lib/export.js';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';

	let summary = $state(null);
	let loading = $state(true);
	let importing = $state(false);
	let exporting = $state(false);
	let exportingCsv = $state(false);
	let importMessage = $state('');
	let importError = $state('');
	let exportMessage = $state('');
	let fileInput = $state();

	// Toolbar
	let teamQuery = $state('');
	let sortBy = $state('entries');

	// Filter chips — null means "all"
	let eventFilter = $state(null);
	let scoutFilter = $state(null);
	let allianceFilter = $state('all'); // 'all' | 'red' | 'blue'

	// Per-team UI state
	let expanded = $state(new Set());
	let showAllEntries = $state(new Set()); // teams whose entries are fully expanded

	// ─── helpers ───────────────────────────────────────────────────────────────

	/** Format a createdAt ISO string as relative time ("now", "5m", "3h", "2d"). */
	function relTime(iso) {
		if (!iso) return '—';
		const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		const days = Math.floor(hrs / 24);
		if (days < 7) return `${days}d`;
		return new Date(iso).toLocaleDateString();
	}

	/** Did the robot break down? Handles both v1 (failures text) and v2 (brokeDown bool). */
	function entryBrokeDown(e) {
		const obs = e.observations;
		if (!obs) return false;
		if (typeof obs.brokeDown === 'boolean') return obs.brokeDown;
		return typeof obs.failures === 'string' && obs.failures.trim().length > 0;
	}

	/**
	 * Recompute all per-team stats from a (possibly filtered) subset of entries.
	 * Returns null if the subset is empty so the caller can drop the team.
	 */
	function recompute(teamNumber, entries) {
		if (entries.length === 0) return null;
		const ordered = entries
			.slice()
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		const redCount = entries.filter((e) => e.allianceColor === 'red').length;
		const blueCount = entries.filter((e) => e.allianceColor === 'blue').length;
		const breakdownCount = entries.filter(entryBrokeDown).length;
		const defenseCount = entries.filter((e) => Boolean(e.observations?.defense?.trim())).length;
		const strengthCount = entries.filter((e) => Boolean(e.observations?.strengths?.trim())).length;
		const autoPathCounts = new Map();
		for (const e of entries) {
			const k = e.observations?.autoPathing?.trim();
			if (k) autoPathCounts.set(k, (autoPathCounts.get(k) ?? 0) + 1);
		}
		const autoPaths = [...autoPathCounts.entries()]
			.map(([pathName, count]) => ({ pathName, count }))
			.sort((a, b) => b.count - a.count || a.pathName.localeCompare(b.pathName));
		const rawStrengths =
			ordered.map((e) => e.observations?.strengths?.trim()).find(Boolean) ?? '';
		return {
			teamNumber,
			entryCount: entries.length,
			matchesCovered: new Set(entries.map((e) => e.matchNumber)).size,
			scoutsCovered: new Set(entries.map((e) => e.scoutName)).size,
			redCount,
			blueCount,
			breakdownCount,
			defenseCount,
			strengthCount,
			autoPathEntryCount: autoPaths.reduce((s, p) => s + p.count, 0),
			autoPathCount: autoPaths.length,
			autoPaths,
			latestCreatedAt: ordered[0]?.createdAt ?? null,
			strengthsPreview:
				rawStrengths.length > 80 ? rawStrengths.slice(0, 80) + '…' : rawStrengths,
			entries: ordered
		};
	}

	// ─── filter chip cycling ───────────────────────────────────────────────────

	function cycleEvent() {
		if (!summary) return;
		const evts = summary.events;
		if (!eventFilter || !evts.includes(eventFilter)) {
			eventFilter = evts[0] ?? null;
		} else {
			const i = evts.indexOf(eventFilter);
			eventFilter = i >= evts.length - 1 ? null : evts[i + 1];
		}
	}

	function cycleScout() {
		if (!summary) return;
		const scouts = summary.scouts;
		if (!scoutFilter || !scouts.includes(scoutFilter)) {
			scoutFilter = scouts[0] ?? null;
		} else {
			const i = scouts.indexOf(scoutFilter);
			scoutFilter = i >= scouts.length - 1 ? null : scouts[i + 1];
		}
	}

	function cycleAlliance() {
		if (allianceFilter === 'all') allianceFilter = 'red';
		else if (allianceFilter === 'red') allianceFilter = 'blue';
		else allianceFilter = 'all';
	}

	function clearFilters() {
		teamQuery = '';
		eventFilter = null;
		scoutFilter = null;
		allianceFilter = 'all';
	}

	// ─── derived team list ─────────────────────────────────────────────────────

	const filtersActive = $derived(!!eventFilter || !!scoutFilter || allianceFilter !== 'all');

	const filteredTeams = $derived.by(() => {
		if (!summary) return [];

		let teams;
		if (!filtersActive) {
			// No active filters — use pre-computed stats from summarize() directly.
			teams = summary.teams.slice();
		} else {
			// At least one filter is active — recompute each team's stats from the
			// filtered entry subset and drop teams that end up with zero entries.
			teams = summary.teams
				.map((t) => {
					let sub = t.entries;
					if (eventFilter) sub = sub.filter((e) => e.eventCode === eventFilter);
					if (scoutFilter) sub = sub.filter((e) => e.scoutName === scoutFilter);
					if (allianceFilter !== 'all')
						sub = sub.filter((e) => e.allianceColor === allianceFilter);
					return recompute(t.teamNumber, sub);
				})
				.filter(Boolean);
		}

		// Team number search
		const q = teamQuery.trim();
		if (q) teams = teams.filter((t) => String(t.teamNumber).includes(q));

		// Sort
		return teams.slice().sort((a, b) => {
			if (sortBy === 'recent')
				return new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt);
			if (sortBy === 'auto-paths')
				return (
					b.autoPathEntryCount - a.autoPathEntryCount ||
					b.autoPathCount - a.autoPathCount
				);
			if (sortBy === 'breakdowns')
				return b.breakdownCount - a.breakdownCount || b.entryCount - a.entryCount;
			if (sortBy === 'defense')
				return b.defenseCount - a.defenseCount || b.entryCount - a.entryCount;
			// default: most entries
			return b.entryCount - a.entryCount || a.teamNumber - b.teamNumber;
		});
	});

	/** Teams with fewer than 3 entries — the manager may want to send a scout. */
	const thinCoverageTeams = $derived(filteredTeams.filter((t) => t.entryCount < 3));

	// ─── expand / collapse ─────────────────────────────────────────────────────

	function toggle(teamNumber) {
		if (expanded.has(teamNumber)) {
			expanded.delete(teamNumber);
			showAllEntries.delete(teamNumber);
			showAllEntries = new Set(showAllEntries);
		} else {
			expanded.add(teamNumber);
		}
		expanded = new Set(expanded);
	}

	function expandAllEntries(teamNumber) {
		showAllEntries.add(teamNumber);
		showAllEntries = new Set(showAllEntries);
	}

	// ─── data loading ──────────────────────────────────────────────────────────

	async function refresh() {
		summary = await summarize();
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	// Re-aggregate whenever the sync layer pulls in peer rows.
	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});

	// ─── import / export ───────────────────────────────────────────────────────

	async function handleFiles(e) {
		const files = [...(e.target.files ?? [])];
		if (files.length === 0) return;
		importing = true;
		importError = '';
		importMessage = '';
		let totalInserted = 0;
		let totalSkipped = 0;
		const lines = [];
		try {
			for (const file of files) {
				try {
					const result = await importFile(file);
					totalInserted += result.inserted;
					totalSkipped += result.skipped;
					lines.push(`${file.name}: +${result.inserted}, ${result.skipped} dup(s)`);
				} catch (err) {
					lines.push(`${file.name}: ${err.message}`);
					importError = err.message;
				}
			}
			importMessage = `${totalInserted} new ${totalInserted === 1 ? 'entry' : 'entries'} imported, ${totalSkipped} duplicate${totalSkipped === 1 ? '' : 's'} skipped.\n${lines.join('\n')}`;
			await refresh();
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}

	async function exportScout() {
		if (!summary || summary.totalEntries === 0) return;
		exporting = true;
		exportMessage = '';
		importError = '';
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

	async function doExportCsv() {
		if (!summary || summary.totalEntries === 0) return;
		exportingCsv = true;
		exportMessage = '';
		importError = '';
		try {
			const { filename, count } = await exportToCsv({
				exportedBy: session.scoutName || 'manager',
				eventCode: session.eventCode || (summary.events[0] ?? null)
			});
			exportMessage = `Exported ${count} entries → ${filename}`;
		} catch (err) {
			importError = err.message ?? String(err);
		} finally {
			exportingCsv = false;
		}
	}
</script>

<svelte:head>
	<title>Manager · FRC Scout</title>
</svelte:head>

<main>
	<!-- ── Header ───────────────────────────────────────────────────── -->
	<header class="page-head">
		<h1>Manager</h1>
		{#if summary}
			<div class="updated">
				{summary.totalEntries} entries · last {relTime(summary.lastCreatedAt)} ago
			</div>
		{/if}
	</header>

	{#if loading}
		<p class="muted">Loading…</p>

	{:else if summary.totalEntries === 0}
		<!-- ── Empty state ─────────────────────────────────────────────── -->
		<div class="empty">
			<p>No entries yet.</p>
			<p class="muted">Import <code>.scout</code> files your scouts shared to start analysis.</p>
			<label class="btn secondary import-btn">
				<input
					type="file"
					accept=".scout,.json,application/json,application/octet-stream"
					multiple
					onchange={handleFiles}
					disabled={importing}
				/>
				<span>{importing ? 'Importing…' : 'Import scout files'}</span>
			</label>
			{#if importMessage}<pre class="info">{importMessage}</pre>{/if}
			{#if importError}<p class="error">{importError}</p>{/if}
		</div>

	{:else}
		<!-- ── Stats grid ──────────────────────────────────────────────── -->
		<section class="stats">
			<div class="stat"><small>Entries</small><span>{summary.totalEntries}</span></div>
			<div class="stat"><small>Teams</small><span>{summary.teamCount}</span></div>
			<div class="stat"><small>Matches</small><span>{summary.matchCount}</span></div>
			<div class="stat"><small>Scouts</small><span>{summary.scoutCount}</span></div>
		</section>

		<!-- ── Toolbar ─────────────────────────────────────────────────── -->
		<div class="toolbar">
			<input
				class="search"
				type="text"
				inputmode="numeric"
				placeholder="Find team #"
				bind:value={teamQuery}
			/>
			<select class="sort-select" bind:value={sortBy} aria-label="Sort teams by">
				<option value="entries">Most entries</option>
				<option value="recent">Most recent</option>
				<option value="auto-paths">Most auto paths</option>
				<option value="breakdowns">Most breakdowns</option>
				<option value="defense">Most defense notes</option>
			</select>
			<div class="toolbar-btns">
				<label class="btn secondary import-btn">
					<input
						bind:this={fileInput}
						type="file"
						accept=".scout,.json,application/json,application/octet-stream"
						multiple
						onchange={handleFiles}
						disabled={importing}
					/>
					<span>{importing ? 'Importing…' : 'Import'}</span>
				</label>
				<button
					class="btn primary"
					onclick={exportScout}
					disabled={exporting || summary.totalEntries === 0}
				>
					{exporting ? 'Exporting…' : 'Export .scout'}
				</button>
				<button
					class="btn csv"
					onclick={doExportCsv}
					disabled={exportingCsv || summary.totalEntries === 0}
				>
					{exportingCsv ? 'Exporting…' : 'Export CSV'}
				</button>
			</div>
		</div>

		<!-- ── Filter chips ────────────────────────────────────────────── -->
		<!--
			Each chip cycles through its values on click. Active chips are
			highlighted. The derived filteredTeams list recomputes per-team stats
			whenever any filter changes.
		-->
		<div class="chips">
			<button
				class="chip {eventFilter ? 'active' : ''}"
				onclick={cycleEvent}
				title="Tap to cycle through events"
			>
				{eventFilter ? `Event: ${eventFilter}` : 'All events'}
			</button>
			<button
				class="chip {scoutFilter ? 'active' : ''}"
				onclick={cycleScout}
				title="Tap to cycle through scouts"
			>
				{scoutFilter ? `Scout: ${scoutFilter}` : 'All scouts'}
			</button>
			<button
				class="chip {allianceFilter !== 'all' ? 'active alliance-' + allianceFilter : ''}"
				onclick={cycleAlliance}
				title="Tap to cycle through alliances"
			>
				{allianceFilter === 'all'
					? 'Both alliances'
					: allianceFilter === 'red'
					? 'Red only'
					: 'Blue only'}
			</button>
		</div>

		<!-- ── Messages ────────────────────────────────────────────────── -->
		{#if importMessage}<pre class="info">{importMessage}</pre>{/if}
		{#if exportMessage}<p class="info single">{exportMessage}</p>{/if}
		{#if importError}<p class="error">{importError}</p>{/if}

		<!-- ── Thin coverage hint ──────────────────────────────────────── -->
		<!--
			Only shown when no filters are active so it reflects the true
			coverage picture rather than a filtered slice.
		-->
		{#if thinCoverageTeams.length > 0 && !filtersActive && !teamQuery}
			<div class="coverage-hint">
				<strong
					>{thinCoverageTeams.length} team{thinCoverageTeams.length === 1
						? ''
						: 's'} with thin coverage</strong
				>
				(fewer than 3 entries): {thinCoverageTeams.map((t) => t.teamNumber).join(', ')}
			</div>
		{/if}

		<!-- ── Team list ───────────────────────────────────────────────── -->
		{#if filteredTeams.length === 0}
			<div class="no-results">
				<p>No teams match these filters.</p>
				<button class="btn secondary" onclick={clearFilters}>Clear filters</button>
			</div>
		{:else}
			<ul class="teams">
				{#each filteredTeams as t (t.teamNumber)}
					{@const isOpen = expanded.has(t.teamNumber)}
					{@const thin = t.entryCount < 3}
					<li class="team {isOpen ? 'open' : ''}">

						<!-- ── Header row (always visible, click to expand) ──── -->
						<button
							class="team-row"
							onclick={() => toggle(t.teamNumber)}
							aria-expanded={isOpen}
						>
							<div class="left">
								<strong class="team-num">Team {t.teamNumber}</strong>
								{#if thin}
									<div class="bar thin-bar" aria-hidden="true"></div>
								{:else}
									<div class="bar" aria-hidden="true">
										<span class="red" style="flex:{t.redCount}"></span>
										<span class="blue" style="flex:{t.blueCount}"></span>
									</div>
								{/if}
								<span class="counts">
									{#if thin}<em class="thin-label">thin coverage · </em>{/if}{t.entryCount}
									{t.entryCount === 1 ? 'entry' : 'entries'} · {t.matchesCovered}
									{t.matchesCovered === 1 ? 'match' : 'matches'} · {t.scoutsCovered}
									{t.scoutsCovered === 1 ? 'scout' : 'scouts'}
								</span>
							</div>
							<div class="right">
								{#if t.breakdownCount > 0}
									<span class="badge bad"
										>{t.breakdownCount}
										{t.breakdownCount === 1 ? 'breakdown' : 'breakdowns'}</span
									>
								{/if}
								{#if t.defenseCount > 0}
									<span class="badge">{t.defenseCount} defense</span>
								{/if}
								{#if t.autoPathEntryCount > 0}
									<span class="badge path"
										>{t.autoPathEntryCount} auto {t.autoPathEntryCount === 1
											? 'path'
											: 'paths'}</span
									>
								{/if}
								<span class="age">{relTime(t.latestCreatedAt)}</span>
								<span class="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
							</div>
						</button>

						<!-- ── Strengths preview (collapsed rows only) ──────── -->
						{#if !isOpen && t.strengthsPreview}
							<p class="strength-preview">
								<span class="preview-label">Strengths:</span>{t.strengthsPreview}
							</p>
						{/if}

						<!-- ── Expanded body ──────────────────────────────────── -->
						{#if isOpen}
							{#if t.autoPathCount > 0}
								<div class="paths-block">
									<h3>Auto paths ({t.autoPathEntryCount})</h3>
									<ul class="path-list">
										{#each t.autoPaths as p (p.pathName)}
											<li><span>{p.pathName}</span><strong>{p.count}</strong></li>
										{/each}
									</ul>
								</div>
							{/if}

							{@const showAll = showAllEntries.has(t.teamNumber)}
							{@const displayEntries = showAll ? t.entries : t.entries.slice(0, 6)}
							<ul class="team-entries">
								{#each displayEntries as e (e.id ?? `${e.matchNumber}-${e.scoutName}-${e.createdAt}`)}
									<li class="team-entry" data-color={e.allianceColor}>
										<div class="hdr">
											<strong>Q{e.matchNumber}</strong>
											<span class="alliance">{e.allianceColor}</span>
											<span class="by">by {e.scoutName}</span>
										</div>
										{#if e.observations?.autoPathing}<p><strong>→</strong> {e.observations.autoPathing}</p>{/if}
										{#if e.observations?.strengths}<p><strong>+</strong> {e.observations.strengths}</p>{/if}
										{#if e.observations?.weaknesses}<p><strong>−</strong> {e.observations.weaknesses}</p>{/if}
										{#if e.observations?.defense}<p><strong>D</strong> {e.observations.defense}</p>{/if}
										{#if e.observations?.brokeDown === true}<p class="brokedown"><strong>!</strong> Broke down</p>{/if}
										{#if e.observations?.comments}<p><strong>·</strong> {e.observations.comments}</p>{/if}
										<!-- v1 compat: show legacy failures text if brokeDown field not present -->
										{#if e.observations?.failures && e.observations?.brokeDown === undefined}
											<p><strong>!</strong> {e.observations.failures}</p>
										{/if}
									</li>
								{/each}

								<!-- "Show all" expander — only shown when entries are capped -->
								{#if !showAll && t.entries.length > 6}
									<li class="more-row">
										<button
											class="show-more"
											onclick={() => expandAllEntries(t.teamNumber)}
										>
											+ {t.entries.length - 6} more
											{t.entries.length - 6 === 1 ? 'entry' : 'entries'}
										</button>
									</li>
								{/if}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 38rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	/* ── header ───────────────────────────────────────────────────── */
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

	/* ── empty ────────────────────────────────────────────────────── */
	.empty {
		background: #f7f7f7;
		border: 1px solid #e5e5e5;
		border-radius: 0.5rem;
		padding: 1rem;
	}

	/* ── stats grid ───────────────────────────────────────────────── */
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}
	.stat {
		background: #f5f6f9;
		border: 1px solid #d9deea;
		border-radius: 0.5rem;
		padding: 0.65rem 0.75rem;
	}
	.stat small {
		display: block;
		color: #555;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.stat span { font-size: 1.3rem; font-weight: 700; }

	/* ── toolbar ──────────────────────────────────────────────────── */
	.toolbar {
		margin-top: 0.75rem;
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.search {
		flex: 1 1 8rem;
		max-width: 13rem;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid #ccc;
		border-radius: 0.4rem;
	}
	.search:focus { outline: 2px solid #0b3d91; border-color: #0b3d91; outline-offset: 1px; }
	.sort-select {
		font: inherit;
		font-size: 0.88rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid #ccc;
		border-radius: 0.4rem;
		background: white;
		cursor: pointer;
	}
	.toolbar-btns {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-left: auto;
	}

	/* ── buttons ──────────────────────────────────────────────────── */
	.btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		padding: 0.55rem 0.85rem;
		border-radius: 0.4rem;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn.primary { background: #0b3d91; color: white; border-color: #0b3d91; }
	.btn.primary:hover { background: #0a3480; }
	.btn.primary:disabled { opacity: 0.6; cursor: progress; }
	.btn.secondary { background: white; border-color: #ccc; color: #222; }
	.btn.secondary:hover { background: #f5f5f5; }
	.btn.csv { background: #f0fff4; border-color: #86efac; color: #166534; }
	.btn.csv:hover { background: #dcfce7; }
	.btn.csv:disabled { opacity: 0.6; cursor: progress; }
	/* file-input overlay for label-based upload buttons */
	.import-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	/* ── filter chips ─────────────────────────────────────────────── */
	.chips {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.chip {
		background: #f0f0f0;
		border: 1px solid #ddd;
		border-radius: 999px;
		padding: 0.3rem 0.65rem;
		color: #555;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.chip:hover { background: #e5e5e5; }
	.chip.active { background: #e8effc; color: #0b3d91; border-color: #bccbea; font-weight: 600; }
	.chip.alliance-red { background: #fef2f2; color: #991b1b; border-color: #fca5a5; font-weight: 600; }
	.chip.alliance-blue { background: #eff6ff; color: #1d4ed8; border-color: #93c5fd; font-weight: 600; }

	/* ── messages ─────────────────────────────────────────────────── */
	.info {
		background: #eaf3ff;
		color: #1c3a78;
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0 0;
		white-space: pre-wrap;
		font: inherit;
		font-size: 0.85rem;
	}
	.info.single { white-space: normal; }
	.error {
		background: #fdecea;
		color: #842029;
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0 0;
		font-size: 0.88rem;
	}

	/* ── thin coverage hint ───────────────────────────────────────── */
	.coverage-hint {
		margin-top: 0.65rem;
		padding: 0.5rem 0.75rem;
		background: #fffbeb;
		border: 1px solid #fcd34d;
		border-radius: 0.4rem;
		font-size: 0.86rem;
		color: #78350f;
	}

	/* ── no results ───────────────────────────────────────────────── */
	.no-results {
		margin-top: 2.5rem;
		text-align: center;
		color: #555;
	}
	.no-results p { margin-bottom: 0.75rem; }

	/* ── team list ────────────────────────────────────────────────── */
	.teams {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.team {
		border: 1px solid #d8d8d8;
		border-radius: 0.55rem;
		background: #fff;
		overflow: hidden;
	}
	.team-row {
		width: 100%;
		border: none;
		background: transparent;
		padding: 0.7rem 0.8rem 0.45rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.55rem;
		text-align: left;
		cursor: pointer;
		font: inherit;
		flex-wrap: wrap;
	}
	.team-row:hover { background: #fafafa; }
	.left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 0;
		min-width: 0;
		flex-wrap: wrap;
	}
	.team-num { font-size: 1rem; white-space: nowrap; }
	.bar {
		width: 3rem;
		height: 0.6rem;
		background: #ececec;
		border-radius: 999px;
		overflow: hidden;
		display: flex;
		flex-shrink: 0;
	}
	.thin-bar { background: #ddd; }
	.bar .red { background: #e24b4a; }
	.bar .blue { background: #378add; }
	.counts { color: #666; font-size: 0.82rem; }
	.thin-label { color: #b45309; font-style: italic; font-size: 0.82rem; }
	.right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
		flex-shrink: 0;
	}

	/* ── badges ───────────────────────────────────────────────────── */
	.badge {
		background: #f0ede5;
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		color: #444;
		font-size: 0.78rem;
		white-space: nowrap;
	}
	.badge.bad { background: #fef2f2; color: #991b1b; }
	.badge.path { background: #f3e8ff; color: #6b21a8; }
	.age { color: #888; font-size: 0.78rem; }
	.chev { color: #aaa; font-size: 0.85rem; }

	/* ── strengths preview ────────────────────────────────────────── */
	.strength-preview {
		margin: 0;
		padding: 0 0.8rem 0.6rem;
		font-size: 0.87rem;
		color: #555;
		line-height: 1.4;
	}
	.preview-label {
		font-weight: 600;
		color: #0b3d91;
		margin-right: 0.3rem;
	}

	/* ── expanded: auto paths ─────────────────────────────────────── */
	.paths-block {
		margin: 0 0.55rem 0.4rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #dfd6ff;
		background: #f7f3ff;
		border-radius: 0.4rem;
	}
	.paths-block h3 { margin: 0; font-size: 0.88rem; }
	.path-list {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.path-list li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	/* ── expanded: entry list ─────────────────────────────────────── */
	.team-entries {
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		border-top: 1px solid #e5e5e5;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.team-entry {
		background: #fafafa;
		border-radius: 0.4rem;
		padding: 0.55rem 0.7rem;
		border-left: 3px solid #ccc;
	}
	.team-entry[data-color='red'] { border-left-color: #e24b4a; }
	.team-entry[data-color='blue'] { border-left-color: #378add; }
	.hdr {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 0.9rem;
	}
	.alliance { text-transform: capitalize; color: #666; }
	.by { margin-left: auto; font-size: 0.78rem; color: #888; }
	.team-entry p { margin: 0.2rem 0 0; font-size: 0.88rem; line-height: 1.35; }
	.team-entry p strong {
		display: inline-block;
		width: 1rem;
		color: #0b3d91;
	}
	.team-entry p.brokedown { color: #991b1b; font-weight: 600; }
	.team-entry p.brokedown strong { color: #991b1b; }

	/* ── show more ────────────────────────────────────────────────── */
	.more-row { text-align: center; padding-top: 0.1rem; }
	.show-more {
		background: none;
		border: none;
		color: #0b3d91;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.show-more:hover { color: #0a3480; }

	/* ── responsive ───────────────────────────────────────────────── */
	@media (max-width: 600px) {
		.stats { grid-template-columns: repeat(2, 1fr); }
		.search { max-width: 100%; flex-basis: 100%; }
		.toolbar-btns { margin-left: 0; }
	}
</style>
