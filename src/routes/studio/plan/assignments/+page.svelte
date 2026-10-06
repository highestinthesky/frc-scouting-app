<script>
	// Plan › Assignments — who watches which teams, for the whole event.
	//
	// The editor from the old /studio/schedule, with the coverage check beside it
	// computed over the UNSAVED draft, so a manager sees a clash the moment they
	// type it. Run › Matches shows the same check over what is saved, which is
	// what scouts are actually following; a conflict row there opens the match to
	// fix it with an override, and a conflict row here goes there.

	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { getSetting, setSetting } from '$lib/db.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { replaceAssignments, replaceOverrides, autoAssignTeams } from '$lib/assignments.js';
	import { parseTeams, findConflicts } from '$lib/plan-state.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import AssignScouts from '$lib/components/studio/AssignScouts.svelte';
	import CoverageCheck from '$lib/components/studio/CoverageCheck.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	/** Editor rows: {scout_name, teamsText}, so a team list is typed as text. */
	let assignRows = $state(/** @type {{scout_name: string, teamsText: string}[]} */ ([]));

	/**
	 * Overrides staged by the last auto-assign run, written on Save. Null means
	 * auto-assign has not run since the last save, and Save leaves the existing
	 * overrides alone.
	 */
	let pendingOverrides = $state(/** @type {any[]|null} */ (null));

	const conflicts = $derived(
		findConflicts(eventData.qmList, assignRows, pendingOverrides ?? eventData.overrides)
	);

	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	// ── loading, and the unsaved draft ─────────────────────────────────────
	//
	// Typing a roster into the editor is ten minutes of work, and it used to
	// evaporate on any refresh — a dropped phone, a reclaimed tab, a
	// fat-fingered pull-to-refresh. The draft is mirrored into IndexedDB on every
	// keystroke and restored on load. Local only: an unsaved draft is one
	// person's work in progress, not something to push at teammates mid-edit.

	let draftRestored = $state(false);
	let draftSavedAt = $state(/** @type {number|null} */ (null));
	/** Guards the mirror so the initial load does not overwrite a draft. */
	let draftReady = $state(false);
	/** The event the editor was last filled for. Plain, not tracked. */
	let filledFor = '';

	const draftKey = () => `assignDraft:${(session.eventCode ?? '').trim().toLowerCase()}`;
	const rowsEqual = (a, b) =>
		a.length === b.length &&
		a.every(
			(r, i) =>
				r.scout_name.trim() === b[i].scout_name.trim() &&
				r.teamsText.trim() === b[i].teamsText.trim()
		);

	// Fill the editor once per event, when the saved assignments have arrived.
	// Not on every change to them: a save refreshes the shared data, and
	// refilling then would throw away whatever the manager typed since.
	$effect(() => {
		const code = eventData.code;
		const ready = eventData.remoteReady;
		if (!code || !ready || filledFor === code) return;
		untrack(() => void fill(code));
	});

	async function fill(code) {
		filledFor = code;
		draftReady = false;
		draftRestored = false;
		draftSavedAt = null;
		pendingOverrides = null;
		assignRows = eventData.savedRows.length
			? eventData.savedRows.map((r) => ({ ...r }))
			: [{ scout_name: '', teamsText: '' }];
		// A draft wins only if it actually differs from what is saved — otherwise
		// every visit would claim to have restored something.
		try {
			const draft = await getSetting(draftKey());
			if (draft?.rows?.length && !rowsEqual(draft.rows, assignRows)) {
				assignRows = draft.rows.map((r) => ({
					scout_name: String(r.scout_name ?? ''),
					teamsText: String(r.teamsText ?? '')
				}));
				draftRestored = true;
				draftSavedAt = draft.savedAt ?? null;
			} else if (draft) {
				await clearDraft();
			}
		} catch (_e) {
			/* no draft, or unreadable — carry on with the saved copy */
		}
		draftReady = true;
	}

	$effect(() => {
		// Read every field so the effect re-runs on any edit to any row.
		const snapshot = assignRows.map((r) => ({ scout_name: r.scout_name, teamsText: r.teamsText }));
		if (!draftReady || !session.eventCode) return;
		// Debounced: every keystroke as its own async write can land out of order
		// and leave a stale snapshot as the final value.
		const key = draftKey();
		const id = setTimeout(() => {
			setSetting(key, { rows: snapshot, savedAt: Date.now() }).catch(() => {});
		}, 400);
		return () => clearTimeout(id);
	});

	async function clearDraft() {
		draftRestored = false;
		draftSavedAt = null;
		try {
			await setSetting(draftKey(), null);
		} catch (_e) {
			/* a draft we cannot clear is not worth failing a save over */
		}
	}

	/** Throw the draft away and go back to what is saved. */
	async function discardDraft() {
		await clearDraft();
		await eventData.refreshAssignments().catch(() => {});
		await fill(eventData.code);
		msg = 'Draft discarded — showing the saved assignments.';
	}

	// ── editing ────────────────────────────────────────────────────────────

	function addAssignRow() {
		assignRows = [...assignRows, { scout_name: '', teamsText: '' }];
	}

	function removeAssignRow(idx) {
		assignRows = assignRows.filter((_, i) => i !== idx);
		if (assignRows.length === 0) assignRows = [{ scout_name: '', teamsText: '' }];
	}

	async function autoAssign() {
		err = '';
		msg = '';
		const qmList = eventData.qmList;
		const names = assignRows.map((r) => r.scout_name.trim()).filter(Boolean);
		if (names.length === 0) {
			err = 'Add at least one scout name first, then auto-assign.';
			return;
		}
		if (!qmList.length) {
			err = 'Fetch the schedule from TBA first (Plan › Schedule) — auto-assign needs the match list.';
			return;
		}

		// Hand the algorithm what is already in the editor. With it, scouts keep
		// the teams they already have and only what must move, moves — a scout
		// going home should not mean everyone else gets a new list between
		// matches. Without it (first run, all cells blank) it plans from scratch.
		const current = new Map();
		for (const r of assignRows) {
			const name = r.scout_name.trim();
			const teams = parseTeams(r.teamsText);
			if (name && teams.length) current.set(name, teams);
		}

		const preview = autoAssignTeams(qmList, names, { current, generateOverrides: false });
		const ok = await dialog.confirm({
			title: preview.churn.incremental
				? `Rebalance across ${names.length} scout${names.length === 1 ? '' : 's'}?`
				: `Auto-assign across ${names.length} scout${names.length === 1 ? '' : 's'}?`,
			body: preview.churn.incremental
				? `${preview.churn.moved} of ${preview.teamCount} teams change hands; ` +
					`${preview.churn.kept} stay where they are.\n\n` +
					`Every per-match override for this event is replaced so the plan stays ` +
					`internally consistent.\n\n` +
					`Nothing is saved until you tap Save assignments.`
				: `Every team at ${session.eventCode} is distributed across the scouts above.\n\n` +
					`This replaces the team lists in the editor AND every per-match override ` +
					`for this event.\n\n` +
					`Nothing is saved until you tap Save assignments.`,
			confirmLabel: preview.churn.incremental ? 'Rebalance' : 'Auto-assign'
		});
		if (!ok) return;

		const plan = autoAssignTeams(qmList, names, { current });
		assignRows = [...plan.assignments.entries()]
			.map(([scout_name, teams]) => ({ scout_name, teamsText: teams.join(', ') }))
			.sort((a, b) => a.scout_name.localeCompare(b.scout_name));
		pendingOverrides = plan.overrides;

		// Report coverage — the share of team-matches somebody is actually
		// watching — rather than a count of placement clashes, which looked
		// reassuringly small while a fifth of the event went unscouted.
		const pct = Math.round(plan.coverage.pct);
		const moved = plan.churn.incremental
			? `${plan.churn.moved} team${plan.churn.moved === 1 ? '' : 's'} moved, ` +
				`${plan.churn.kept} unchanged — `
			: `Distributed ${plan.teamCount} teams across ${plan.scoutCount} ` +
				`scout${plan.scoutCount === 1 ? '' : 's'} — `;
		msg = plan.ceiling.limited
			? `${moved}${pct}% of team-matches covered. Six robots play at once, so ` +
				`${plan.scoutCount} scout${plan.scoutCount === 1 ? '' : 's'} can't exceed ` +
				`${Math.round(plan.ceiling.pct)}% however they're arranged — add more ` +
				`scouts to go higher. Review, then Save.`
			: `${moved}${pct}% of team-matches covered, using ${plan.overrides.length} ` +
				`per-match override${plan.overrides.length === 1 ? '' : 's'}. Review, then Save.`;
	}

	async function saveAssignments() {
		busy = true;
		err = '';
		msg = '';
		try {
			const rows = [];
			for (const r of assignRows) {
				const name = r.scout_name.trim();
				if (!name) continue;
				for (const t of new Set(parseTeams(r.teamsText))) {
					rows.push({ scout_name: name, team_number: t });
				}
			}
			const roster = eventData.profiles;
			const inserted = await replaceAssignments(session.eventCode, rows, { roster });

			// Only touch the overrides table when auto-assign staged something — a
			// plain edit-and-save must not wipe hand-authored overrides added from
			// the match modal.
			let overrideNote = '';
			if (pendingOverrides) {
				const n = await replaceOverrides(session.eventCode, pendingOverrides, { roster });
				pendingOverrides = null;
				overrideNote = ` and ${n} per-match override${n === 1 ? '' : 's'}`;
				await eventData.refreshOverrides();
			}
			await eventData.refreshAssignments();
			await clearDraft();
			msg = `Saved ${inserted} assignment row${inserted === 1 ? '' : 's'}${overrideNote}.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	function openMatch(n) {
		goto(`${base}/studio/run/matches/?match=${n}`);
	}
</script>

<svelte:head><title>Assignments · Plan · FRC Scout</title></svelte:head>

<PageHead title="Plan" />
<SubNav mode="plan" current="Assignments" />

{#if !session.eventCode}
	<Panel tone="quiet">
		<p class="muted">Choose an event from the event button in the bar above first.</p>
	</Panel>
{:else if !eventData.remoteReady}
	<p class="muted">Loading assignments…</p>
{:else}
	{#if eventData.remoteError}
		<!-- Saving over assignments that could not be read would replace them
		     with whatever this editor happens to hold, so the editor is locked
		     until the read succeeds. -->
		<p class="banner err" role="alert">
			Could not load the saved assignments, so editing is paused: {eventData.remoteError}
		</p>
	{/if}
	<div class="board">
		<AssignScouts
			{assignRows}
			roster={eventData.profiles}
			busy={busy || Boolean(eventData.remoteError)}
			qmList={eventData.qmList}
			{now}
			{draftRestored}
			{draftSavedAt}
			pendingOverrideCount={pendingOverrides?.length ?? 0}
			onAddRow={addAssignRow}
			onRemoveRow={removeAssignRow}
			onAutoAssign={autoAssign}
			onSave={saveAssignments}
			onDiscardDraft={discardDraft}
		/>
		<CoverageCheck coverageConflicts={conflicts} onOpenMatch={openMatch} {busy} />
	</div>
{/if}

{#if msg}<p class="banner ok" role="status">{msg}</p>{/if}
{#if err}<p class="banner err" role="alert">{err}</p>{/if}

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-md);
		margin: 0;
	}
	.banner {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin: var(--space-4) 0 0;
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
