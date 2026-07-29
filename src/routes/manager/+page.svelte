<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { allMetricStats, hasAnyMetrics, readMetric, fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { exportToCsv } from '$lib/csv.js';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';

	let summary = $state(null);
	let loading = $state(true);
	let exportingCsv = $state(false);
	let exportMessage = $state('');
	let exportError = $state('');

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
		// Unique strengths: deduplicated across entries, most recent first.
		const uniqueStrengths = [];
		const _seenLower = new Set();
		for (const e of ordered) {
			const s = e.observations?.strengths?.trim();
			if (!s) continue;
			const lower = s.toLowerCase();
			if (!_seenLower.has(lower)) {
				_seenLower.add(lower);
				uniqueStrengths.push(s);
			}
		}
		// Discrepancies — scouts in the same match+alliance disagreeing on brokeDown.
		const matchGroups = new Map();
		for (const e of entries) {
			const k = `${e.eventCode}/${e.matchNumber}/${e.allianceColor}`;
			if (!matchGroups.has(k)) matchGroups.set(k, []);
			matchGroups.get(k).push(e);
		}
		const discrepancies = [];
		for (const [, group] of matchGroups) {
			if (group.length < 2) continue;
			const breakdowns = new Set(group.map(entryBrokeDown));
			if (breakdowns.size > 1) {
				discrepancies.push({
					matchNumber: group[0].matchNumber,
					eventCode: group[0].eventCode,
					allianceColor: group[0].allianceColor,
					entries: group
				});
			}
		}
		const metrics = allMetricStats(entries);
		return {
			teamNumber,
			entryCount: entries.length,
			metrics,
			hasMetrics: hasAnyMetrics(metrics),
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
			uniqueStrengths,
			discrepancies,
			discrepancyCount: discrepancies.length,
			entries: ordered
		};
	}

	/** Metrics actually recorded on one entry, for the expanded per-match list. */
	function recordedCounts(entry) {
		return METRIC_FIELDS.map((m) => ({
			key: m.key,
			label: m.label,
			value: readMetric(entry, m.key)
		})).filter((c) => c.value !== null);
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
			// Metric sorts are prefixed "metric:" so adding a counter to
			// form-config.js adds a sort option without touching this code.
			if (sortBy.startsWith('metric:')) {
				const key = sortBy.slice(7);
				const sa = a.metrics?.[key];
				const sb = b.metrics?.[key];
				// Teams with no reading sink to the bottom regardless of direction —
				// "unknown" should never outrank a real measurement.
				if (sa?.mean === null || sa?.mean === undefined) return 1;
				if (sb?.mean === null || sb?.mean === undefined) return -1;
				const better = sa.higherIsBetter === false ? sa.mean - sb.mean : sb.mean - sa.mean;
				return better || b.entryCount - a.entryCount;
			}
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

	// ─── CSV export ────────────────────────────────────────────────────────────

	async function doExportCsv() {
		if (!summary || summary.totalEntries === 0) return;
		exportingCsv = true;
		exportMessage = '';
		exportError = '';
		try {
			const { filename, count } = await exportToCsv({
				eventCode: session.eventCode || (summary.events[0] ?? null)
			});
			exportMessage = `Exported ${count} entries → ${filename}`;
		} catch (err) {
			exportError = err.message ?? String(err);
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
			<p class="muted">Scout entries appear here as they sync in.</p>
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
				{#each METRIC_FIELDS as m (m.key)}
					<option value="metric:{m.key}">
						{m.higherIsBetter === false ? 'Fewest' : 'Best'} {m.label.toLowerCase()}
					</option>
				{/each}
				<option value="auto-paths">Most auto paths</option>
				<option value="breakdowns">Most breakdowns</option>
				<option value="defense">Most defense notes</option>
			</select>
			<div class="toolbar-btns">
				<a class="btn secondary" href="{base}/manager/compare/">Compare</a>
				<a class="btn secondary" href="{base}/manager/picklist/">Picklist</a>
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
		{#if exportMessage}<p class="info single">{exportMessage}</p>{/if}
		{#if exportError}<p class="error">{exportError}</p>{/if}

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
								{#if t.discrepancyCount > 0}
									<span class="badge warn" title="Scouts disagree on whether this team broke down in some matches">
										⚠ {t.discrepancyCount} {t.discrepancyCount === 1 ? 'conflict' : 'conflicts'}
									</span>
								{/if}
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

						<!-- ── Metric strip ─────────────────────────────────── -->
						{#if t.hasMetrics}
							<div class="metric-strip">
								{#each METRIC_FIELDS as m (m.key)}
									{@const s = t.metrics[m.key]}
									{#if s.n > 0}
										<div class="ms-cell" class:provisional={!s.confident}>
											<small class="ms-label">{m.label}</small>
											<span class="ms-mean">{fmt(s.mean)}</span>
											<small class="ms-meta">
												n={s.n}{#if s.max !== null} · max {s.max}{/if}
											</small>
										</div>
									{/if}
								{/each}
							</div>
						{/if}

						<!-- ── Strengths preview (collapsed rows only) ──────── -->
						{#if !isOpen && t.strengthsPreview}
							<p class="strength-preview">
								<span class="preview-label">Strengths:</span>{t.strengthsPreview}
							</p>
						{/if}

						<!-- ── Expanded body ──────────────────────────────────── -->
						{#if isOpen}
							<div class="full-view-row">
								<a class="full-view-link" href="{base}/manager/team/{t.teamNumber}/">Full match log →</a>
							</div>
							{#if t.uniqueStrengths?.length > 0}
								<div class="paths-block strengths-block">
									<h3>Strengths</h3>
									<ul class="strength-list">
										{#each t.uniqueStrengths as s (s)}
											<li>+ {s}</li>
										{/each}
									</ul>
								</div>
							{/if}

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
										{#if recordedCounts(e).length > 0}
											<p class="entry-counts">
												{#each recordedCounts(e) as c, i (c.key)}
													<span class="ec"><em>{c.label}</em> {c.value}</span
													>{#if i < recordedCounts(e).length - 1}<span class="ec-sep">·</span>{/if}
												{/each}
											</p>
										{/if}
										{#if e.observations?.autoPathing}<p><strong>→</strong> {e.observations.autoPathing}</p>{/if}
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
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
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
	.updated { color: var(--text-faint); font-size: 0.9rem; }
	.muted { color: var(--text-faint); font-size: 0.95rem; }

	/* ── empty ────────────────────────────────────────────────────── */
	.empty {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
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
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.65rem 0.75rem;
	}
	.stat small {
		display: block;
		color: var(--text-muted);
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
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
	}
	.search:focus { outline: 2px solid var(--accent); border-color: var(--accent); outline-offset: 1px; }
	.sort-select {
		font: inherit;
		font-size: 0.88rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
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
	.btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
	.btn.primary:hover { background: var(--accent-hover); }
	.btn.primary:disabled { opacity: 0.6; cursor: progress; }
	.btn.secondary { background: var(--bg-card); border-color: var(--border-strong); color: var(--text-primary); }
	.btn.secondary:hover { background: var(--bg-subtle); }
	.btn.csv { background: var(--success-bg); border-color: var(--success-border); color: var(--success); }
	.btn.csv:hover { filter: brightness(1.04); }
	.btn.csv:disabled { opacity: 0.6; cursor: progress; }
	/* file-input overlay for label-based upload buttons */

	/* ── filter chips ─────────────────────────────────────────────── */
	.chips {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.chip {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.3rem 0.65rem;
		color: var(--text-muted);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.chip:hover { background: var(--bg-elev); }
	.chip.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }
	.chip.alliance-red { background: var(--banner-red-bg); color: var(--alliance-red); border-color: var(--banner-red-border); font-weight: 600; }
	.chip.alliance-blue { background: var(--banner-blue-bg); color: var(--alliance-blue); border-color: var(--banner-blue-border); font-weight: 600; }

	/* ── messages ─────────────────────────────────────────────────── */
	.info {
		background: var(--banner-blue-bg);
		color: var(--accent);
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0 0;
		white-space: pre-wrap;
		font: inherit;
		font-size: 0.85rem;
		border: 1px solid var(--banner-blue-border);
	}
	.info.single { white-space: normal; }
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin: 0.5rem 0 0;
		font-size: 0.88rem;
	}

	/* ── thin coverage hint ───────────────────────────────────────── */
	.coverage-hint {
		margin-top: 0.65rem;
		padding: 0.5rem 0.75rem;
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: 0.4rem;
		font-size: 0.86rem;
		color: var(--warning);
	}

	/* ── metric strip ─────────────────────────────────────────────── */
	.metric-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0 0.8rem 0.6rem;
	}
	.ms-cell {
		flex: 1 1 5rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		padding: 0.4rem 0.5rem;
		border-radius: 0.4rem;
		background: var(--bg-subtle);
	}
	/* Fewer than 3 readings — shown, but visibly held at arm's length. */
	.ms-cell.provisional { opacity: 0.62; }
	.ms-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ms-mean {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.ms-meta {
		font-size: 0.68rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.entry-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.45rem;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	.entry-counts .ec em {
		font-style: normal;
		color: var(--text-muted);
	}
	.ec-sep { color: var(--text-faint); }

	/* ── no results ───────────────────────────────────────────────── */
	.no-results {
		margin-top: 2.5rem;
		text-align: center;
		color: var(--text-muted);
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
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: var(--bg-card);
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
	.team-row:hover { background: var(--bg-page); }
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
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 999px;
		overflow: hidden;
		display: flex;
		flex-shrink: 0;
	}
	.thin-bar { background: var(--bg-subtle); }
	.bar .red { background: #e24b4a; }
	.bar .blue { background: #378add; }
	.counts { color: var(--text-muted); font-size: 0.82rem; }
	.thin-label { color: var(--warning); font-style: italic; font-size: 0.82rem; }
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
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		color: var(--text-primary);
		font-size: 0.78rem;
		white-space: nowrap;
	}
	.badge.bad { background: var(--danger-bg); color: var(--danger); }
	.badge.path { background: var(--accent-soft); color: var(--accent); }
	.badge.warn { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
	.age { color: var(--text-faint); font-size: 0.78rem; }
	.chev { color: var(--text-faint); font-size: 0.85rem; }

	/* ── strengths preview ────────────────────────────────────────── */
	.strength-preview {
		margin: 0;
		padding: 0 0.8rem 0.6rem;
		font-size: 0.87rem;
		color: var(--text-muted);
		line-height: 1.4;
	}
	.preview-label {
		font-weight: 600;
		color: var(--accent);
		margin-right: 0.3rem;
	}

	/* ── expanded: strengths block ─────────────────────────────────
	   Theme-driven so it reads in both light and dark mode. */
	.strengths-block {
		border-color: var(--success-border);
		background: var(--success-bg);
		color: var(--success);
	}
	.strength-list {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--success);
	}

	/* ── expanded: auto paths ───────────────────────────────────────
	   Theme-driven lavender block; flips cleanly in dark mode. */
	.paths-block {
		margin: 0 0.55rem 0.4rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--banner-info-border);
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 0.4rem;
	}
	.paths-block h3 { margin: 0; font-size: 0.88rem; color: var(--accent); }
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
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.team-entry {
		background: var(--bg-page);
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
	.alliance { text-transform: capitalize; color: var(--text-muted); }
	.by { margin-left: auto; font-size: 0.78rem; color: var(--text-faint); }
	.team-entry p { margin: 0.2rem 0 0; font-size: 0.88rem; line-height: 1.35; }
	.team-entry p strong {
		display: inline-block;
		width: 1rem;
		color: var(--accent);
	}
	.team-entry p.brokedown { color: var(--danger); font-weight: 600; }
	.team-entry p.brokedown strong { color: var(--danger); }

	/* ── full-view link ───────────────────────────────────────────── */
	.full-view-row {
		padding: 0.4rem 0.8rem 0;
		text-align: right;
	}
	.full-view-link {
		font-size: 0.82rem;
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
	}
	.full-view-link:hover { text-decoration: underline; }

	/* ── show more ────────────────────────────────────────────────── */
	.more-row { text-align: center; padding-top: 0.1rem; }
	.show-more {
		background: none;
		border: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.show-more:hover { color: var(--accent-hover); }

	/* ── responsive ───────────────────────────────────────────────── */
	@media (max-width: 600px) {
		.stats { grid-template-columns: repeat(2, 1fr); }
		.search { max-width: 100%; flex-basis: 100%; }
		.toolbar-btns { margin-left: 0; }
	}
</style>
