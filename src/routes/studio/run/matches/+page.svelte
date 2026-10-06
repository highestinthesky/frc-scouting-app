<script>
	// Run › Matches — the event's quals in order, how covered each one is, and
	// the per-match overrides that fix a gap.
	//
	// From the old /studio/schedule: the match list, the match modal and the
	// coverage check. The check here reads what is SAVED, because that is what
	// scouts are following; Plan › Assignments runs the same check over its
	// unsaved draft. `?match=<n>` opens a match — that is how a conflict on the
	// Assignments page lands here.

	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { session } from '$lib/session.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { addOverride, removeOverride } from '$lib/assignments.js';
	import { orphanedOverrides } from '$lib/planning-rows.js';
	import { findConflicts, matchWatchers, scoutNames } from '$lib/plan-state.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import SchedulePreview from '$lib/components/studio/SchedulePreview.svelte';
	import CoverageCheck from '$lib/components/studio/CoverageCheck.svelte';
	import MatchDetailModal from '$lib/components/studio/MatchDetailModal.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const conflicts = $derived(
		findConflicts(eventData.qmList, eventData.savedRows, eventData.overrides)
	);

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
		// Drop ?match= so a reload, or Back, does not reopen it.
		if (page.url.searchParams.has('match')) {
			goto(`${base}/studio/run/matches/`, { replaceState: true, noScroll: true, keepFocus: true });
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
	<div class="board">
		<div class="main-col">
			<SchedulePreview
				qmList={eventData.qmList}
				rollup={eventData.rollup}
				entryIndex={eventData.entryIndex}
				{overridesByMatch}
				onOpenMatch={openMatch}
				eventCode={session.eventCode}
			/>
		</div>
		<div class="side-col">
			<CoverageCheck
				coverageConflicts={conflicts}
				onOpenMatch={openMatch}
				{orphans}
				onClearOrphans={clearOrphanedOverrides}
				{busy}
			/>
		</div>
	</div>
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
	/* The list is the page; the check sits beside it on a laptop and under it on
	   anything narrower. */
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.main-col,
	.side-col {
		min-width: 0;
	}
	@media (min-width: 64rem) {
		.board {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		}
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
