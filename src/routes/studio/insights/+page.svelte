<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { allMetricStats, hasAnyMetrics, readMetric, fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { exportToCsv } from '$lib/csv.js';
	import { session } from '$lib/session.svelte.js';
	import { rowScout, sameScout, scoutRef } from '$lib/scout-identity.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import Select from '$lib/components/Select.svelte';
	import Button from '$lib/components/Button.svelte';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Toolbar from '$lib/components/studio/Toolbar.svelte';
	import Table from '$lib/components/studio/Table.svelte';
	import PublicRating from '$lib/components/studio/PublicRating.svelte';

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

	// Team, Entries, Matches, Scouts, one per metric, Flags, Last, and the
	// expander. Derived rather than written as a number because the metric count
	// is data — a season retune adds a column and a hardcoded colspan would tear
	// the detail row out of alignment with nothing failing.
	const COLS = 7 + METRIC_FIELDS.length;

	// ─── the second-opinion comparison ────────────────────────────────────────
	//
	// Compares whichever metric the table is currently sorted by, so the ranking
	// being checked is the one the manager is actually looking at. Falling back to
	// a fixed metric would compare something they cannot see.
	const compareMetric = $derived.by(() => {
		const key = sortBy.startsWith('metric:') ? sortBy.slice(7) : METRIC_FIELDS[0]?.key;
		return METRIC_FIELDS.find((m) => m.key === key) ?? METRIC_FIELDS[0] ?? null;
	});

	// Our own number per team: the mean, and null when there is no reading. Null
	// rather than 0 — a team we have not measured has not been judged, and
	// ranking it last would be an opinion we do not hold.
	const compareRows = $derived.by(() =>
		compareMetric
			? filteredTeams.map((t) => {
					const stat = t.metrics?.[compareMetric.key];
					return { team: t.teamNumber, ours: stat && stat.n > 0 ? stat.mean : null };
				})
			: []
	);

	// The season, from the event code TBA already keys on: "2026onsum" -> 2026.
	const seasonYear = $derived.by(() => {
		const m = /^(\d{4})/.exec(String(session.eventCode ?? ''));
		return m ? Number(m[1]) : null;
	});


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
			scoutsCovered: new Set(entries.map((e) => rowScout(e).key)).size,
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
					if (scoutFilter)
						sub = sub.filter((e) => sameScout(rowScout(e), scoutRef(scoutFilter)));
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
	<title>Insights · FRC Scout</title>
</svelte:head>

<main>
	<PageHead
		title="Insights"
		sub={summary
			? `${summary.totalEntries} entries · last ${relTime(summary.lastCreatedAt)} ago`
			: ''}
	>
		{#snippet actions()}
			<Button href="{base}/studio/insights/compare/">Compare</Button>
			<Button href="{base}/studio/insights/picklist/">Picklist</Button>
			<Button
				variant="primary"
				onclick={doExportCsv}
				disabled={exportingCsv || !summary || summary.totalEntries === 0}
			>
				{exportingCsv ? 'Exporting…' : 'Export CSV'}
			</Button>
		{/snippet}
	</PageHead>

	{#if loading}
		<p class="muted">Loading…</p>

	{:else if summary.totalEntries === 0}
		<!-- ── Empty state ─────────────────────────────────────────────── -->
		<Panel tone="quiet">
			<p class="empty-title">No entries yet.</p>
			<p class="muted">Scout entries appear here as they sync in.</p>
		</Panel>

	{:else}
		<Stats>
			<Stat label="Entries" value={summary.totalEntries} />
			<Stat label="Teams" value={summary.teamCount} />
			<Stat label="Matches" value={summary.matchCount} />
			<Stat
				label="Scouts"
				value={summary.scoutCount}
				note={thinCoverageTeams.length > 0
					? `${thinCoverageTeams.length} thin`
					: ''}
				tone={thinCoverageTeams.length > 0 ? 'warn' : 'default'}
			/>
		</Stats>

		<!-- ── Toolbar ─────────────────────────────────────────────────── -->
		<div class="tools">
			<Toolbar>
				<input
					class="search"
					type="text"
					inputmode="numeric"
					placeholder="Find team #"
					bind:value={teamQuery}
				/>
				<Select
					label="Sort by"
					inline
					bind:value={sortBy}
					options={[
						{ value: 'entries', label: 'Most entries' },
						{ value: 'recent', label: 'Most recent' },
						...METRIC_FIELDS.map((m) => ({
							value: `metric:${m.key}`,
							label: `${m.higherIsBetter === false ? 'Fewest' : 'Best'} ${m.label.toLowerCase()}`
						})),
						{ value: 'auto-paths', label: 'Most auto paths' },
						{ value: 'breakdowns', label: 'Most breakdowns' },
						{ value: 'defense', label: 'Most defense notes' }
					]}
				/>
			</Toolbar>
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

		<!-- ── Teams ───────────────────────────────────────────────────────
		     A table, not a stack of cards.

		     The cards came from a phone, where one team at a time is all that
		     fits. The job on this page is comparison — "which of these scores
		     more" is a question you answer by reading DOWN a column — and a card
		     puts every team's numbers in a different place on the screen. Four
		     teams filled the viewport that now holds twenty rows.

		     The metrics become columns for the same reason. They were a wrapped
		     strip inside each card, so comparing two teams' cycle counts meant
		     finding the cell twice, in two different positions.
		-->
		{#if filteredTeams.length === 0}
			<Panel tone="quiet">
				<p class="empty-title">No teams match these filters.</p>
				<Button onclick={clearFilters}>Clear filters</Button>
			</Panel>
		{:else}
			<Panel flush>
				<Table>
					{#snippet head()}
						<tr>
							<th>Team</th>
							<th data-num>Entries</th>
							<th data-num>Matches</th>
							<th data-num>Scouts</th>
							{#each METRIC_FIELDS as m (m.key)}
								<th data-num>{m.label}</th>
							{/each}
							<th>Flags</th>
							<th data-num>Last</th>
							<th><span class="sr-only">Expand</span></th>
						</tr>
					{/snippet}

					{#each filteredTeams as t (t.teamNumber)}
						{@const isOpen = expanded.has(t.teamNumber)}
						{@const thin = t.entryCount < 3}
						<tr>
							<td>
								<div class="team-cell">
									<!-- The number is a link to the full match log, and the
									     chevron at the end of the row expands in place. Those were
									     one control before: the row expanded, and the link to the
									     full log was INSIDE the thing you had to expand. -->
									<a class="team-num" href="{base}/studio/insights/team/{t.teamNumber}/">
										{t.teamNumber}
									</a>
									{#if thin}
										<div class="bar thin-bar" aria-hidden="true"></div>
									{:else}
										<div class="bar" aria-hidden="true">
											<span class="red" style="flex:{t.redCount}"></span>
											<span class="blue" style="flex:{t.blueCount}"></span>
										</div>
									{/if}
								</div>
							</td>
							<td data-num>
								<span class:thin-count={thin} title={thin ? 'Fewer than 3 entries' : undefined}>
									{t.entryCount}
								</span>
							</td>
							<td data-num>{t.matchesCovered}</td>
							<td data-num>{t.scoutsCovered}</td>

							<!-- Blank is not zero. n === 0 means this metric was never
							     recorded for this team — an entry predating the field, or a
							     scout who left it empty — and rendering that as 0 is the
							     corruption readMetric() exists to prevent. An em dash says
							     "no reading"; 0 would say "they scored none". -->
							{#each METRIC_FIELDS as m (m.key)}
								{@const s = t.metrics[m.key]}
								<td data-num>
									{#if s.n > 0}
										<span
											class="metric"
											class:provisional={!s.confident}
											title="n={s.n}{s.max !== null ? ` · max ${s.max}` : ''}{s.confident
												? ''
												: ' · fewer than 3 readings'}"
										>
											{fmt(s.mean)}
										</span>
									{:else}
										<span class="blank" title="Not recorded">—</span>
									{/if}
								</td>
							{/each}

							<td>
								<div class="flags">
									{#if t.discrepancyCount > 0}
										<span class="badge warn" title="Scouts disagree on whether this team broke down in some matches">
											⚠ {t.discrepancyCount}
										</span>
									{/if}
									{#if t.breakdownCount > 0}
										<span class="badge bad" title="{t.breakdownCount} breakdowns">
											{t.breakdownCount} broke
										</span>
									{/if}
									{#if t.defenseCount > 0}
										<span class="badge" title="{t.defenseCount} defense notes">
											{t.defenseCount} def
										</span>
									{/if}
									{#if t.autoPathEntryCount > 0}
										<span class="badge path" title="{t.autoPathEntryCount} entries with an auto path">
											{t.autoPathEntryCount} auto
										</span>
									{/if}
									{#if t.uniqueStrengths?.length > 0}
										<span class="badge good" title={t.uniqueStrengths.join(' · ')}>
											+{t.uniqueStrengths.length}
										</span>
									{/if}
								</div>
							</td>
							<td data-num class="age">{relTime(t.latestCreatedAt)}</td>
							<td>
								<button
									class="expander"
									onclick={() => toggle(t.teamNumber)}
									aria-expanded={isOpen}
									aria-label="{isOpen ? 'Collapse' : 'Expand'} team {t.teamNumber}"
								>
									<span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
								</button>
							</td>
						</tr>

						{#if isOpen}
							{@const showAll = showAllEntries.has(t.teamNumber)}
							{@const displayEntries = showAll ? t.entries : t.entries.slice(0, 6)}
							<tr data-detail>
								<td colspan={COLS}>
									<div class="detail">
										{#if t.uniqueStrengths?.length > 0}
											<section class="detail-block strengths">
												<h3>Strengths</h3>
												<ul class="plain">
													{#each t.uniqueStrengths as s (s)}
														<li>+ {s}</li>
													{/each}
												</ul>
											</section>
										{/if}

										{#if t.autoPathCount > 0}
											<section class="detail-block">
												<h3>Auto paths ({t.autoPathEntryCount})</h3>
												<ul class="plain path-list">
													{#each t.autoPaths as p (p.pathName)}
														<li><span>{p.pathName}</span><strong>{p.count}</strong></li>
													{/each}
												</ul>
											</section>
										{/if}

										<section class="detail-block entries">
											<h3>Match log</h3>
											<ul class="plain team-entries">
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
											</ul>
											{#if !showAll && t.entries.length > 6}
												<button class="show-more" onclick={() => expandAllEntries(t.teamNumber)}>
													+ {t.entries.length - 6}
													{t.entries.length - 6 === 1 ? 'more entry' : 'more entries'}
												</button>
											{/if}
											<a class="full-view-link" href="{base}/studio/insights/team/{t.teamNumber}/">
												Full match log →
											</a>
										</section>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</Table>
			</Panel>

			<div class="second-opinion">
				<PublicRating
					rows={compareRows}
					metricLabel={compareMetric?.label ?? 'your numbers'}
					year={seasonYear}
				/>
			</div>
		{/if}
	{/if}
</main>

<style>
	/* What is left after Panel, Stat, Stats, Toolbar and Table took their share.
	   This page had 92 rules; four shapes repeated made up most of them, and the
	   remainder is genuinely about teams and entries rather than about boxes. */

	.muted {
		color: var(--text-faint);
		font-size: var(--fs-md);
	}
	.empty-title {
		margin: 0 0 var(--space-2);
		font-weight: 600;
	}

	.tools {
		margin: var(--space-4) 0 var(--space-3);
	}
	.search {
		flex: 0 1 13rem;
		min-width: 0;
		font: inherit;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.search:focus-visible {
		outline: 2px solid var(--accent);
		border-color: var(--accent);
		outline-offset: 1px;
	}

	/* ── filter chips ─────────────────────────────────── */
	.chips {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
	}
	.chip {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		min-height: var(--tap-min);
		padding: 0 var(--space-4);
		color: var(--text-muted);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.chip:hover {
		background: var(--bg-elev);
		color: var(--text-primary);
	}
	.chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.chip.active {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: var(--accent);
		font-weight: 600;
	}
	.chip.alliance-red {
		background: var(--banner-red-bg);
		color: var(--alliance-red);
		border-color: var(--banner-red-border);
		font-weight: 600;
	}
	.chip.alliance-blue {
		background: var(--banner-blue-bg);
		color: var(--alliance-blue);
		border-color: var(--banner-blue-border);
		font-weight: 600;
	}

	/* ── messages ─────────────────────────────────────── */
	.info,
	.error {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin: 0 0 var(--space-3);
		font-size: var(--fs-sm);
		white-space: pre-wrap;
	}
	.info {
		background: var(--banner-info-bg);
		border: 1px solid var(--banner-info-border);
		color: var(--accent);
	}
	.info.single {
		white-space: normal;
	}
	.error {
		background: var(--danger-bg);
		border: 1px solid var(--banner-red-border);
		color: var(--danger);
	}

	/* Names the thin teams. The table says WHICH rows are thin by colouring the
	   count, and the Scouts stat says how many — this is the one that says who,
	   without making anyone scan 40 rows for amber. */
	.coverage-hint {
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		color: var(--warning);
	}

	/* ── the team row ─────────────────────────────────── */
	.team-cell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.team-num {
		font-weight: 700;
		font-size: var(--fs-md);
		font-variant-numeric: tabular-nums;
		color: var(--accent);
		text-decoration: none;
		white-space: nowrap;
	}
	.team-num:hover {
		text-decoration: underline;
	}
	/* Red/blue split of the entries recorded on this team. A mark, not a
	   sentence, so the alliance tokens are used at their non-text floor. */
	.bar {
		width: 2.5rem;
		height: 0.5rem;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		overflow: hidden;
		display: flex;
		flex-shrink: 0;
	}
	.bar .red {
		background: var(--alliance-red);
	}
	.bar .blue {
		background: var(--alliance-blue);
	}
	.thin-bar {
		background: var(--bg-subtle);
	}
	/* Colour is not the only signal — the count carries a title, and the Scouts
	   stat above the table names the number of thin teams in words. */
	.thin-count {
		color: var(--warning);
		font-weight: 600;
	}

	.metric {
		font-weight: 600;
	}
	/* Fewer than three readings: shown, but visibly held at arm's length. */
	.metric.provisional {
		opacity: 0.55;
		font-weight: 400;
	}
	.blank {
		color: var(--text-faint);
	}
	.age {
		color: var(--text-faint);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}

	.flags {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.badge {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 2px var(--space-2);
		color: var(--text-muted);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.badge.bad {
		background: var(--danger-bg);
		border-color: var(--banner-red-border);
		color: var(--danger);
	}
	.badge.path {
		background: var(--accent-soft);
		border-color: var(--banner-info-border);
		color: var(--accent);
	}
	.badge.good {
		background: var(--success-bg);
		border-color: var(--success-border);
		color: var(--success);
	}
	.badge.warn {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning);
	}

	.expander {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-muted);
		font: inherit;
		cursor: pointer;
	}
	.expander:hover {
		background: var(--bg-elev);
		color: var(--text-primary);
	}
	.expander:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* ── the expanded detail ──────────────────────────── */
	/* Three columns on a laptop, because the detail is three independent lists
	   and stacking them put the match log below two folds of whitespace. */
	.detail {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.detail-block h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.detail-block.entries {
		grid-column: 1 / -1;
	}
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--fs-sm);
	}
	.strengths .plain {
		color: var(--success);
	}
	.path-list li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.team-entries {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
		gap: var(--space-2);
	}
	.team-entry {
		background: var(--bg-card);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--border-strong);
	}
	.team-entry[data-color='red'] {
		border-left-color: var(--alliance-red);
	}
	.team-entry[data-color='blue'] {
		border-left-color: var(--alliance-blue);
	}
	.hdr {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		font-size: var(--fs-sm);
	}
	.alliance {
		text-transform: capitalize;
		color: var(--text-muted);
	}
	.by {
		margin-left: auto;
		font-size: var(--fs-xs);
		color: var(--text-faint);
	}
	.team-entry p {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
		line-height: 1.4;
	}
	.team-entry p strong {
		display: inline-block;
		width: 1rem;
		color: var(--accent);
	}
	.team-entry p.brokedown {
		color: var(--danger);
		font-weight: 600;
	}
	.team-entry p.brokedown strong {
		color: var(--danger);
	}
	.entry-counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.entry-counts .ec em {
		font-style: normal;
		color: var(--text-muted);
	}
	.ec-sep {
		color: var(--text-faint);
	}

	.show-more,
	.full-view-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-2);
		margin-top: var(--space-2);
		background: none;
		border: none;
		color: var(--accent);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
	}
	.show-more:hover,
	.full-view-link:hover {
		text-decoration: underline;
	}
	.show-more:focus-visible,
	.full-view-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.second-opinion {
		margin-top: var(--space-5);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
