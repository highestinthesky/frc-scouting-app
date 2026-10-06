<script>
	// Run › Matches — is this event being scouted, and where is it not.
	//
	// Three surfaces used to answer that: the schedule page's match list, its
	// CoverageCheck, and all of /studio/coverage. They read the same schedule and
	// the same entries. Now it is one list with Coverage's numbers above it, a
	// filter for the matches with gaps or conflicts, and each conflict written on
	// the row it happens in, beside the Edit that fixes it. Coverage's other half,
	// By scout, is on Run › Scouts.
	//
	// The conflict check reads what is SAVED, because that is what scouts are
	// following; Plan › Assignments runs it over its unsaved draft.
	//
	//     ?show=gaps | conflicts   the filter — /studio/coverage lands on gaps
	//     ?match=<n>               opens a match; a conflict on Assignments
	//                              lands here this way

	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { session } from '$lib/session.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { addOverride, removeOverride } from '$lib/assignments.js';
	import { orphanedOverrides } from '$lib/planning-rows.js';
	import { findConflicts, matchWatchers, scoutNames } from '$lib/plan-state.js';
	import { matchCoverage, gapMatches } from '$lib/coverage.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Button from '$lib/components/Button.svelte';
	import MatchList from '$lib/components/studio/MatchList.svelte';
	import MatchDetailModal from '$lib/components/studio/MatchDetailModal.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const conflicts = $derived(
		findConflicts(eventData.qmList, eventData.savedRows, eventData.overrides)
	);
	const conflictsByMatch = $derived.by(() => {
		const map = new Map();
		for (const c of conflicts) {
			const arr = map.get(c.match) ?? [];
			arr.push(c);
			map.set(c.match, arr);
		}
		return map;
	});

	// ── coverage, from what was /studio/coverage ──────────────────────────

	const rollup = $derived(eventData.rollup);
	const pct = $derived(
		rollup.teamMatchesTotal === 0
			? null
			: Math.round((rollup.teamMatchesScouted / rollup.teamMatchesTotal) * 100)
	);
	const gaps = $derived(gapMatches(eventData.qmList, eventData.entryIndex));

	// ── the filter ─────────────────────────────────────────────────────────

	const FILTERS = /** @type {const} */ (['all', 'gaps', 'conflicts']);
	const show = $derived.by(() => {
		const v = page.url.searchParams.get('show');
		return FILTERS.includes(/** @type {any} */ (v)) ? v : 'all';
	});
	const allRows = $derived(
		eventData.qmList.map((match) => ({ match, cov: matchCoverage(match, eventData.entryIndex) }))
	);
	const rows = $derived(
		show === 'gaps'
			? gaps
			: show === 'conflicts'
				? allRows.filter(({ match }) => conflictsByMatch.has(match.match_number))
				: allRows
	);
	const counts = $derived({ all: allRows.length, gaps: gaps.length, conflicts: conflictsByMatch.size });
	const filterLabel = { all: 'All', gaps: 'Gaps', conflicts: 'Conflicts' };

	/** This page's URL with one query parameter changed (null removes it). */
	function withParam(name, value) {
		const u = new URL(page.url);
		if (value == null) u.searchParams.delete(name);
		else u.searchParams.set(name, value);
		return `${u.pathname}${u.search}`;
	}

	/**
	 * Overrides addressed to somebody who is not on this event. Rows already in
	 * the database from an earlier season or test, outliving the scout they were
	 * written for — nine were found on production this way.
	 */
	const orphans = $derived(
		orphanedOverrides(
			eventData.overrides,
			eventData.savedRows.map((r) => ({ scout_name: r.scout_name })),
			eventData.profiles
		)
	);

	const overridesByMatch = $derived.by(() => {
		const map = new Map();
		for (const o of eventData.overrides) {
			const arr = map.get(o.match_number) ?? [];
			arr.push(o);
			map.set(o.match_number, arr);
		}
		return map;
	});

	const reminderScouts = $derived(scoutNames(eventData.savedRows));

	// ── the match modal ────────────────────────────────────────────────────

	/** Match number open in the modal; null = closed. Seeded from ?match=. */
	let editingMatch = $state(/** @type {number|null} */ (null));
	$effect(() => {
		const n = Number(page.url.searchParams.get('match'));
		if (Number.isInteger(n) && n > 0) openMatch(n);
	});

	/** Per-match new-override form state, keyed by match number. */
	let overrideDraft = $state(/** @type {Record<string, {scout: string, team: string}>} */ ({}));

	// Creates the draft, so it is called from openMatch and the save handler —
	// never from the template, where writing state is an error
	// (state_unsafe_mutation) and aborts the render.
	function draftFor(matchNumber) {
		const key = String(matchNumber);
		if (!overrideDraft[key]) overrideDraft[key] = { scout: '', team: '' };
		return overrideDraft[key];
	}

	function openMatch(n) {
		editingMatch = n;
		draftFor(n);
	}

	function closeMatch() {
		editingMatch = null;
		// Drop ?match= so a reload, or Back, does not reopen it. Only that: the
		// filter the manager was looking at stays.
		if (page.url.searchParams.has('match')) {
			goto(withParam('match', null), { replaceState: true, noScroll: true, keepFocus: true });
		}
	}

	$effect(() => {
		if (editingMatch == null || typeof window === 'undefined') return;
		const onKey = (e) => {
			if (e.key === 'Escape') closeMatch();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const editingMatchObj = $derived(
		editingMatch == null
			? null
			: (eventData.qmList.find((m) => m.match_number === editingMatch) ?? null)
	);
	const editingMatchCoverage = $derived(
		matchWatchers(editingMatchObj, eventData.savedRows, eventData.overrides)
	);

	async function saveOverride(matchNumber) {
		err = '';
		msg = '';
		const d = draftFor(matchNumber);
		if (!d.scout?.trim() || !Number(d.team)) {
			err = 'Pick both a scout and a team.';
			return;
		}
		try {
			busy = true;
			await addOverride(
				session.eventCode,
				{ matchNumber, scoutName: d.scout.trim(), teamNumber: Number(d.team) },
				eventData.profiles
			);
			d.scout = '';
			d.team = '';
			await eventData.refreshOverrides();
			msg = `Override added for Q${matchNumber}.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function deleteOverride(id) {
		err = '';
		msg = '';
		try {
			busy = true;
			await removeOverride(session.eventCode, id);
			await eventData.refreshOverrides();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function clearOrphanedOverrides() {
		const names = new Set(orphans.map((o) => o.scout.toLowerCase()));
		const doomed = eventData.overrides.filter((o) =>
			names.has(String(o.scout_name ?? '').trim().toLowerCase())
		);
		const ok = await dialog.confirm({
			title: `Remove ${doomed.length} override${doomed.length === 1 ? '' : 's'}?`,
			body:
				`They are addressed to ${orphans.map((o) => o.scout).join(', ')}, ` +
				`who are not on this event.\n\n` +
				`Assignments are untouched — this removes only the per-match overrides.`,
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		busy = true;
		err = '';
		try {
			for (const o of doomed) await removeOverride(session.eventCode, o.id);
			await eventData.refreshOverrides();
			msg = `${doomed.length} orphaned override${doomed.length === 1 ? '' : 's'} removed.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	/** The entry form, pre-filled for one seat in a match. */
	function newEntryHref(row) {
		const params = new URLSearchParams({
			match: String(row.match),
			team: String(row.team),
			color: row.color
		});
		return `${base}/scouting/new/?${params.toString()}`;
	}
</script>

<svelte:head><title>Matches · Run · FRC Scout</title></svelte:head>

<PageHead title="Run" />
<SubNav mode="run" current="Matches" />

{#if !session.eventCode}
	<Panel tone="quiet">
		<p class="muted">Choose an event from the event button in the bar above first.</p>
	</Panel>
{:else if !eventData.localReady}
	<p class="muted">Loading…</p>
{:else if !eventData.qmList.length}
	<Panel tone="quiet">
		<p class="muted">
			No schedule on this device for {session.eventCode} yet. Fetch and publish one from
			<a href="{base}/studio/plan/schedule/">Plan › Schedule</a>.
		</p>
	</Panel>
{:else}
	<Stats>
		<Stat
			label="Recorded"
			value={pct === null ? '—' : `${pct}%`}
			note="{rollup.teamMatchesScouted} of {rollup.teamMatchesTotal} robot-matches"
		/>
		<!-- Labels short enough for two columns on a phone, where Coverage's
		     longer ones were cut to "ROBOT-MATCHES …"; the note carries the rest. -->
		<Stat
			label="Fully covered"
			value={rollup.matchesComplete}
			note="of {rollup.matchesTotal} matches"
		/>
		<!-- Toned, and the note carries the same fact in words. Colour alone is
		     not a signal everyone receives. -->
		<Stat
			label="Gaps"
			value={gaps.length}
			note="matches started, not finished"
			tone={gaps.length > 0 ? 'warn' : 'default'}
		/>
		<Stat
			label="Conflicts"
			value={conflicts.length}
			note="a scout with two robots in one match"
			tone={conflicts.length > 0 ? 'warn' : 'default'}
		/>
	</Stats>

	<!-- Overrides addressed to somebody who is not on this event. Reported, not
	     deleted: a manager's planning is not tidied away from under them. They do
	     nothing today, and the key is a lowercased name, so they REACTIVATE the
	     day someone with a matching name is added. -->
	{#if orphans.length > 0}
		{@const orphanRows = orphans.reduce((n, o) => n + o.count, 0)}
		<div class="orphans" role="note">
			<p class="orph-head">
				<strong>{orphanRows}</strong>
				{orphanRows === 1 ? 'override' : 'overrides'} addressed to
				{orphans.length === 1 ? 'someone' : 'people'} not on this event:
				{orphans.map((o) => `${o.scout} (${o.count})`).join(' · ')}
			</p>
			<p class="orph-why">
				They do nothing now, and would start overriding a real assignment if anyone with a
				matching name joins.
			</p>
			<Button variant="danger" disabled={busy} onclick={clearOrphanedOverrides}>
				Remove {orphanRows === 1 ? 'it' : 'them'}
			</Button>
		</div>
	{/if}

	<nav class="filter" aria-label="Show matches">
		{#each FILTERS as f (f)}
			<a
				href={withParam('show', f === 'all' ? null : f)}
				class:on={show === f}
				aria-current={show === f ? 'true' : undefined}
				data-sveltekit-noscroll
				data-sveltekit-replacestate
			>
				{filterLabel[f]} <span class="n">{counts[f]}</span>
			</a>
		{/each}
	</nav>

	<MatchList
		{rows}
		{conflictsByMatch}
		{overridesByMatch}
		onOpenMatch={openMatch}
		eventCode={session.eventCode}
		title={show === 'gaps' ? 'Gaps' : show === 'conflicts' ? 'Conflicts' : 'Every qual'}
		hint={show === 'gaps' && gaps.length > 0
			? 'Someone recorded part of these and not the rest — the most likely place a scout drifted off their assignment.'
			: ''}
		empty={show === 'gaps'
			? 'Nothing started is unfinished.'
			: show === 'conflicts'
				? 'Nobody has two robots in one match.'
				: 'No matches.'}
	/>
{/if}

{#if msg}<p class="banner ok" role="status">{msg}</p>{/if}
{#if err}<p class="banner err" role="alert">{err}</p>{/if}

{#if editingMatchObj && overrideDraft[String(editingMatchObj.match_number)]}
	<MatchDetailModal
		m={editingMatchObj}
		draft={overrideDraft[String(editingMatchObj.match_number)]}
		overrideList={eventData.overrides}
		entryIndex={eventData.entryIndex}
		{editingMatchCoverage}
		{reminderScouts}
		{busy}
		onClose={closeMatch}
		onDeleteOverride={deleteOverride}
		onSaveOverride={saveOverride}
		hrefFor={newEntryHref}
	/>
{/if}

<style>
	/* The filter is a segmented control like the sub-nav, one level down and
	   lighter: a choice of what the list shows, not of where you are. */
	.filter {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-4) 0 var(--space-3);
	}
	.filter a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		color: var(--text-muted);
		font-size: var(--fs-sm);
		font-weight: 600;
		text-decoration: none;
	}
	.filter a:hover {
		color: var(--text-primary);
	}
	/* The accent and a heavier border, never colour alone. */
	.filter a.on {
		color: var(--accent);
		border-color: var(--accent);
		border-width: 2px;
		padding: 0 calc(var(--space-3) - 1px);
	}
	.filter .n {
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}
	.filter a.on .n {
		color: inherit;
	}
	.orphans {
		margin-top: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		color: var(--warning);
	}
	.orph-head {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.orph-why {
		margin: var(--space-1) 0 var(--space-3);
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-md);
		margin: 0;
	}
	.muted a {
		color: var(--accent);
	}
	.banner {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-top: var(--space-4);
		font-size: var(--fs-md);
	}
	.banner.ok {
		background: var(--success-bg);
		color: var(--success);
		border: 1px solid var(--success-border);
	}
	.banner.err {
		background: var(--danger-bg);
		color: var(--danger);
		border: 1px solid var(--danger);
	}
</style>
