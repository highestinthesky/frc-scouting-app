<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { rowScout, scoutRef } from '$lib/scout-identity.js';
	import { listEntries, getSetting, setSetting } from '$lib/db.js';
	import {
		fetchAndCacheSchedule,
		publishSchedule,
		pullSchedule,
		getCachedSchedule,
		getPublishedTbaEventKey,
		clearScheduleCache,
		qualMatches,
		teamsInMatch,
		nextUnscoutedMatch
	} from '$lib/tba.js';
	import {
		listAssignments,
		replaceAssignments,
		listOverrides,
		addOverride,
		removeOverride,
		replaceOverrides,
		autoAssignTeams
	} from '$lib/assignments.js';
	import {
		buildEntryIndex,
		matchCoverage,
		scheduleRollup,
		coverageLevel,
		teamStatus
	} from '$lib/coverage.js';
	import {
		resetEventData
	} from '$lib/event-meta.js';
	import {
		createReminder,
		deleteReminder,
		listReminders
	} from '$lib/reminders.js';
	import { reminders as reminderStore } from '$lib/reminders.svelte.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import PublishSchedule from '$lib/components/studio/PublishSchedule.svelte';
	import AssignScouts from '$lib/components/studio/AssignScouts.svelte';
	import ScoutRoster from '$lib/components/studio/ScoutRoster.svelte';
	import CoverageCheck from '$lib/components/studio/CoverageCheck.svelte';
	import ReminderPanel from '$lib/components/studio/ReminderPanel.svelte';
	import SchedulePreview from '$lib/components/studio/SchedulePreview.svelte';
	import MatchDetailModal from '$lib/components/studio/MatchDetailModal.svelte';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';

	// ─── shared state ──────────────────────────────────────────────────────

	/** Cached schedule for the current event: { cachedAt, matches } | null. */
	let cached = $state(null);
	let entries = $state([]);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const qmList = $derived(cached ? qualMatches(cached.matches) : []);
	// Whether the manager surfaces render at all. auth owns it — see
	// showsManagerTools, which replaced a local self-asserted role toggle that
	// revealed buttons for anyone who ticked it.
	const isManager = $derived(auth.showsManagerTools);
	// Who authored a reminder or a schedule publish. Same reasoning as the app
	// bar badge in +layout.svelte: the account name when one exists, because
	// attributing a manager action to whatever name this device happened to have
	// typed is how "who published this?" became unanswerable.
	// The account, full stop. There is no signed-out manager any more, so the
	// fallback to session.scoutName would only ever produce a typed name where an
	// account exists — which is how "who published this?" became unanswerable.
	const managerName = $derived(auth.displayName || auth.profile?.username || '');

	// ── live coverage (shared with home + manager analytics) ────────────────
	// Index of which (match, team) cells have at least one entry. A teammate's
	// entry counts too, so coverage reflects the whole team's effort, not just
	// this device's. Recomputes whenever entries change (sync tick bumps them).
	const entryIndex = $derived(buildEntryIndex(entries, session.eventCode));
	const rollup = $derived(scheduleRollup(qmList, entryIndex));

	// Re-tick once a minute so the "in 8 min" labels stay accurate without a
	// manual refresh. $state assignment is what triggers the derived rerun.
	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	// ─── manager-only state ────────────────────────────────────────────────

	let tbaApiKey = $state(session.tbaApiKey);
	// Canonical TBA event key to fetch from (e.g. "2027nyny"), decoupled from
	// the team's sync event code (e.g. "2027nyc"). Empty falls back to the code.
	let tbaEventKey = $state(session.tbaEventKey);

	// Rotation + reset state
	let showForgotHelp = $state(false);

	// Send-reminder state
	let reminderTarget = $state(''); // '' = broadcast; otherwise scout name
	let reminderMatch = $state('');
	let reminderText = $state('');
	let recentReminders = $state(/** @type {any[]} */ ([]));

	// Distinct scout names from current assignments — populates the target picker.
	const reminderScouts = $derived.by(() => {
		const names = new Set();
		for (const r of assignRows) {
			const n = r.scout_name.trim();
			if (n) names.add(n);
		}
		return [...names].sort((a, b) => a.localeCompare(b));
	});

	// ── overrides + coverage check ──────────────────────────────────────────

	/** Server-pulled override rows; refreshed by reload() and after edits. */
	let overrideList = $state(/** @type {any[]} */ ([]));
	/**
	 * The account roster, so a typed scout name can be written with the account it
	 * belongs to. Empty is a normal state — nobody signed in, or the roster read
	 * failed — and every write still carries the name with a null account, exactly
	 * as it does today. Resolution improves the data when it can; it never stands
	 * between a manager and saving an assignment.
	 */
	let roster = $state(/** @type {any[]} */ ([]));
	/** Per-match new-override form state, keyed by match_number → {scout, team}. */
	let overrideDraft = $state(/** @type {Record<string, {scout: string, team: string}>} */ ({}));

	/**
	 * Coverage check: for each qual match, group assigned (and base-resolved)
	 * teams by scout. Flag scouts assigned to 2+ teams in the same match.
	 * Item-5 spec: silent display only.
	 */
	const coverageConflicts = $derived.by(() => {
		if (!qmList.length || !assignRows.length) return [];
		// Build base scout → teams map from the current editor state (not the
		// server, so the manager sees conflicts immediately as they edit).
		const baseByScout = new Map();
		for (const r of assignRows) {
			const name = r.scout_name.trim();
			if (!name) continue;
			const teams = (r.teamsText || '')
				.split(/[\s,]+/)
				.map((s) => Number(s.replace(/[^0-9]/g, '')))
				.filter((n) => Number.isFinite(n) && n > 0);
			if (teams.length === 0) continue;
			const prev = baseByScout.get(name) ?? new Set();
			for (const t of teams) prev.add(t);
			baseByScout.set(name, prev);
		}
		// Build overrides map: { 'match:scout(lower)' → Set<teams> }
		//
		// Staged overrides from an unsaved auto-assign run count here. Otherwise
		// auto-assign would report full coverage while Coverage check below still
		// listed the clashes those very overrides resolve — two numbers on one
		// screen disagreeing about the same plan.
		const effectiveOverrides = pendingOverrides ?? overrideList;
		const overrideKey = (m, s) => `${m}:${String(s ?? '').trim().toLowerCase()}`;
		const overrideMap = new Map();
		for (const o of effectiveOverrides) {
			const k = overrideKey(o.match_number, o.scout_name);
			const set = overrideMap.get(k) ?? new Set();
			set.add(Number(o.team_number));
			overrideMap.set(k, set);
		}
		const conflicts = [];
		for (const m of qmList) {
			const playing = new Set();
			for (const arr of [m.alliances?.red?.team_keys ?? [], m.alliances?.blue?.team_keys ?? []]) {
				for (const k of arr) {
					const n = parseInt(String(k).replace(/^frc/, ''), 10);
					if (Number.isFinite(n)) playing.add(n);
				}
			}
			for (const [scout, baseSet] of baseByScout) {
				const overrides = overrideMap.get(overrideKey(m.match_number, scout));
				const effective = overrides && overrides.size > 0
					? [...overrides].filter((t) => playing.has(t))
					: [...baseSet].filter((t) => playing.has(t));
				if (effective.length >= 2) {
					conflicts.push({
						match: m.match_number,
						scout,
						teams: effective.sort((a, b) => a - b),
						hasOverride: Boolean(overrides && overrides.size > 0)
					});
				}
			}
		}
		return conflicts;
	});

	/**
	 * Roster derived from local entries + the assignment editor state.
	 * For the manager to confirm who's been recording and who they've
	 * assigned. Pure client-side, no extra Supabase call — entries are
	 * already pulled by the sync layer.
	 */
	const scoutsInEvent = $derived.by(() => {
		// Grouped on the identity key, not the typed text. This panel exists to
		// answer "who is recording and who have I assigned", and keying on the raw
		// string answered it with one row for "Ning" and another for "ning" —
		// making a scout look unassigned while their entries piled up under a
		// second name. The label keeps whatever spelling arrived first.
		const map = new Map();
		const get = (ref) => {
			if (!map.has(ref.key))
				map.set(ref.key, {
					name: ref.label,
					assigned: false,
					recording: false,
					count: 0,
					lastEntry: null
				});
			return map.get(ref.key);
		};
		for (const r of assignRows) {
			const ref = scoutRef(r.scout_name);
			if (!ref.key) continue;
			get(ref).assigned = true;
		}
		for (const e of entries) {
			const ref = rowScout(e);
			if (!ref.key) continue;
			const info = get(ref);
			info.recording = true;
			info.count += 1;
			if (!info.lastEntry || e.createdAt > info.lastEntry) info.lastEntry = e.createdAt;
		}
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	// ── match-detail modal ────────────────────────────────────────────────

	/** Match number currently open in the modal; null = closed. */
	let editingMatch = $state(/** @type {number|null} */ (null));

	function openMatch(n) {
		editingMatch = n;
		// Reset the per-match draft so the form starts empty each time.
		const k = String(n);
		if (!overrideDraft[k]) overrideDraft[k] = { scout: '', team: '' };
	}
	function closeMatch() { editingMatch = null; }

	// ESC closes the modal.
	$effect(() => {
		if (editingMatch == null || typeof window === 'undefined') return;
		const onKey = (e) => { if (e.key === 'Escape') closeMatch(); };
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	/** The full match object currently being edited. */
	const editingMatchObj = $derived(
		editingMatch == null ? null : qmList.find((m) => m.match_number === editingMatch) ?? null
	);

	/**
	 * For the modal: each of the 6 teams in this match, with the scouts
	 * currently effectively watching it (override if any → otherwise base).
	 * Helps the manager see exactly what coverage looks like.
	 */
	const editingMatchCoverage = $derived.by(() => {
		const m = editingMatchObj;
		if (!m) return [];
		const overrideRows = overrideList.filter((o) => o.match_number === m.match_number);
		// Per-(match,scout) set of override team_numbers; if a scout has any,
		// only those count as "their teams" for this match.
		const overrideByScout = new Map();
		for (const o of overrideRows) {
			const who = rowScout(o);
			const set = overrideByScout.get(who.key) ?? { displayName: who.label, teams: new Set() };
			set.teams.add(Number(o.team_number));
			overrideByScout.set(who.key, set);
		}
		// Effective scout → teams map for THIS match: override wins, else base.
		const scoutTeams = new Map();
		for (const r of assignRows) {
			const name = r.scout_name.trim();
			if (!name) continue;
			const lc = scoutRef(name).key;
			if (overrideByScout.has(lc)) {
				scoutTeams.set(name, [...overrideByScout.get(lc).teams]);
			} else {
				const base = (r.teamsText || '')
					.split(/[\s,]+/)
					.map((s) => Number(s.replace(/[^0-9]/g, '')))
					.filter((n) => Number.isFinite(n) && n > 0);
				scoutTeams.set(name, base);
			}
		}
		// Also include scouts who have an override but no base row (rare but possible).
		for (const { displayName, teams } of overrideByScout.values()) {
			if (!scoutTeams.has(displayName)) scoutTeams.set(displayName, [...teams]);
		}
		// Now compute, for each of the 6 teams in this match, who's watching it.
		const parseTeam = (key) => Number(String(key).replace(/^frc/, ''));
		const allianceRows = [];
		for (const color of ['red', 'blue']) {
			const keys = m.alliances?.[color]?.team_keys ?? [];
			for (const key of keys) {
				const t = parseTeam(key);
				if (!Number.isFinite(t)) continue;
				const watchers = [];
				for (const [scoutName, teams] of scoutTeams) {
					if (teams.includes(t)) {
						const override = overrideByScout.get(scoutRef(scoutName).key);
						watchers.push({
							scout: scoutName,
							viaOverride: Boolean(override)
						});
					}
				}
				allianceRows.push({ color, team: t, watchers });
			}
		}
		return allianceRows;
	});

	/** Overrides grouped by match for the preview row UI. */
	const overridesByMatch = $derived.by(() => {
		const map = new Map();
		for (const o of overrideList) {
			const arr = map.get(o.match_number) ?? [];
			arr.push(o);
			map.set(o.match_number, arr);
		}
		return map;
	});

	function draftFor(matchNumber) {
		const key = String(matchNumber);
		if (!overrideDraft[key]) overrideDraft[key] = { scout: '', team: '' };
		return overrideDraft[key];
	}

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
				roster
			);
			d.scout = '';
			d.team = '';
			overrideList = await listOverrides(session.eventCode);
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
			overrideList = overrideList.filter((o) => o.id !== id);
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	/** Assignment editor rows. {scout_name, teamsText} so the user can edit
	 *  the team list as a comma-separated string. We parse to numbers on save. */
	let assignRows = $state(/** @type {{scout_name: string, teamsText: string}[]} */ ([]));

	/**
	 * Overrides staged by the last auto-assign run, written on Save. Null means
	 * "auto-assign hasn't run since the last save", and Save leaves the existing
	 * overrides alone.
	 */
	let pendingOverrides = $state(/** @type {any[]|null} */ (null));

	// ── unsaved-draft persistence ───────────────────────────────────────────
	//
	// Typing a roster into the editor is ten minutes of work, and it used to
	// evaporate on any refresh — which at an event means a dropped phone, a
	// backgrounded tab the OS reclaimed, or a fat-fingered pull-to-refresh.
	// The draft is mirrored into IndexedDB on every keystroke and restored on
	// load. It is deliberately local-only: an unsaved draft is one person's
	// work-in-progress, not something to push at teammates mid-edit.

	let draftRestored = $state(false);
	let draftSavedAt = $state(/** @type {number|null} */ (null));
	/** Guards the persist effect so the initial server load doesn't overwrite a draft. */
	let draftReady = $state(false);

	const draftKey = () => `assignDraft:${(session.eventCode ?? '').trim().toLowerCase()}`;
	const rowsEqual = (a, b) =>
		a.length === b.length &&
		a.every(
			(r, i) =>
				r.scout_name.trim() === b[i].scout_name.trim() &&
				r.teamsText.trim() === b[i].teamsText.trim()
		);

	$effect(() => {
		// Read every field so the effect re-runs on any edit to any row.
		const snapshot = assignRows.map((r) => ({
			scout_name: r.scout_name,
			teamsText: r.teamsText
		}));
		if (!draftReady || !isManager || !session.eventCode) return;
		// Debounced: without this every keystroke is its own IndexedDB write, and
		// because the writes are async they can also land out of order and leave
		// a stale snapshot as the final value.
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
			/* a draft we can't clear is not worth failing a save over */
		}
	}

	/** Throw the draft away and go back to what the server has. */
	async function discardDraft() {
		await clearDraft();
		draftReady = false;
		await reload();
		msg = 'Draft discarded — showing the saved assignments.';
	}

	// ─── mount: load cached schedule, entries, assignments and the roster ──

	onMount(async () => {
		await reload();
	});

	// Pull fresh entries whenever sync brings some in. Every other data page has
	// done this since it was written; this one never did, so the coverage board,
	// the roster and the roll-up bar were frozen at page load. The comment above
	// entryIndex claimed "sync tick bumps them" and nothing bumped them. With one
	// scout that is mild staleness. With twenty streaming in it means the manager
	// spends the event looking at 9am.
	//
	// Only entries, deliberately — NOT reload(). Everything here that shows
	// coverage derives from `entries`, a single indexed local read, while reload()
	// also refetches assignments, overrides and the account roster
	// state over the network. inboundChanges increments once per ROW, so a
	// cold-start backfill would fire that hundreds of times.
	let entriesInFlight = false;
	let entriesStale = false;
	$effect(() => {
		syncState.inboundChanges; // tracked dependency
		if (!session.eventCode) return;
		if (entriesInFlight) {
			// Arrived mid-read. Remember, so the last write still wins.
			entriesStale = true;
			return;
		}
		void refreshEntries();
	});

	async function refreshEntries() {
		entriesInFlight = true;
		try {
			do {
				entriesStale = false;
				entries = await listEntries();
			} while (entriesStale);
		} finally {
			entriesInFlight = false;
		}
	}

	async function reload() {
		err = '';
		try {
			entries = await listEntries();
			cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			if (isManager && session.eventCode) {
				roster = auth.signedIn ? await auth.listProfiles().catch(() => []) : [];
				const all = await listAssignments(session.eventCode);
				// Group team_number by scout_name for the editor.
				const byScout = new Map();
				for (const r of all) {
					const list = byScout.get(r.scout_name) ?? [];
					list.push(r.team_number);
					byScout.set(r.scout_name, list);
				}
				assignRows = [...byScout.entries()]
					.map(([scout_name, teams]) => ({
						scout_name,
						teamsText: teams.sort((a, b) => a - b).join(', ')
					}))
					.sort((a, b) => a.scout_name.localeCompare(b.scout_name));
				if (assignRows.length === 0) {
					assignRows = [{ scout_name: '', teamsText: '' }];
				}
				// A draft only wins if it actually differs from what's saved —
				// otherwise every visit would claim to have restored something.
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
					/* no draft, or unreadable — carry on with the server copy */
				}
				// Pull a live list of reminders so the manager can see what's already
				// out there (and delete stale ones).
				try {
					recentReminders = await listReminders(session.eventCode);
				} catch (_e) {
					recentReminders = [];
				}
				try {
					overrideList = await listOverrides(session.eventCode);
				} catch (_e) {
					overrideList = [];
				}
				// If this manager device hasn't got a TBA key yet but a teammate
				// already published one, adopt it so re-fetching just works.
				if (!tbaEventKey) {
					const publishedKey = await getPublishedTbaEventKey(session.eventCode);
					if (publishedKey) {
						tbaEventKey = publishedKey;
						await session.update({ tbaEventKey: publishedKey });
					}
				}
			}
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			// Only start mirroring once the server load has settled, so the
			// initial assignRows write doesn't clobber the draft we just read.
			draftReady = true;
		}
	}


	// ─── manager actions ───────────────────────────────────────────────────

	/**
	 * Safety net for long-running async ops. If the operation hasn't finished
	 * in `maxMs`, force-reset `busy` to false and surface a generic error so
	 * the UI can never wedge in a "…" state. The normal try/finally below
	 * clears the timer first in the success/error path, so this only fires
	 * when something genuinely hangs (a stale service worker intercepting a
	 * fetch, an IndexedDB transaction stuck waiting on a lock, etc.).
	 */
	function armSafetyTimer(maxMs = 25_000) {
		return setTimeout(() => {
			if (busy) {
				busy = false;
				err =
					err ||
					'That took longer than expected and was cancelled. Try again, or do a hard refresh (Cmd+Shift+R) if the issue keeps happening.';
			}
		}, maxMs);
	}

	async function fetchFromTba() {
		busy = true;
		err = '';
		msg = '';
		const safety = armSafetyTimer();
		try {
			// The TBA key drives the fetch; fall back to the event code when the
			// manager hasn't entered a separate key.
			const effectiveTbaKey = (tbaEventKey || '').trim() || session.eventCode;
			const matches = await fetchAndCacheSchedule(
				session.eventCode,
				tbaApiKey || session.tbaApiKey,
				effectiveTbaKey
			);
			// Persist the keys on this device so reloads don't lose them.
			if (tbaApiKey && tbaApiKey !== session.tbaApiKey) {
				await session.update({ tbaApiKey });
			}
			if ((tbaEventKey || '').trim() !== session.tbaEventKey) {
				await session.update({ tbaEventKey: (tbaEventKey || '').trim() });
			}
			cached = await getCachedSchedule(session.eventCode);
			msg = `Fetched ${qualMatches(matches).length} qual matches from TBA (${effectiveTbaKey}). Now tap “Publish to teammates”.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			clearTimeout(safety);
			busy = false;
		}
	}

	async function publishToTeammates() {
		err = '';
		msg = '';
		let safety;
		try {
			if (!cached) throw new Error('Fetch the schedule from TBA first.');
			const qmCount = qmList.length;
			const totalCount = cached.matches.length;
			// Confirm so a stray tap (especially on the wrong event code) can't
			// silently overwrite everyone's schedule.
			const ok = await dialog.confirm({
				title: `Publish ${qmCount} qual match${qmCount === 1 ? '' : 'es'}?`,
				body:
					`${totalCount} total, for ${session.eventCode}.\n\n` +
					`This replaces the current published schedule. Scouts pull the new one within 30 seconds.`,
				confirmLabel: 'Publish'
			});
			if (!ok) return;
			busy = true;
			safety = armSafetyTimer();
			const res = await publishSchedule(session.eventCode, cached.matches, {
				fetchedBy: managerName || null,
				tbaEventKey: (tbaEventKey || '').trim() || session.eventCode
			});
			msg = `Published — teammates will pull within 30 seconds. (${new Date(res.fetchedAt).toLocaleTimeString()})`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			if (safety) clearTimeout(safety);
			busy = false;
		}
	}

	async function clearLocalCache() {
		await clearScheduleCache(session.eventCode);
		cached = null;
		msg = 'Local schedule cache cleared. (This does not delete the published schedule.)';
	}

	async function sendReminder() {
		err = '';
		msg = '';
		try {
			if (!reminderText.trim()) throw new Error('Reminder message is empty.');
			busy = true;
			const matchNum = Number(reminderMatch);
			await createReminder(session.eventCode, {
				scoutName: reminderTarget || undefined,
				matchNumber: Number.isFinite(matchNum) && matchNum > 0 ? matchNum : undefined,
				message: reminderText,
				author: managerName || null,
				roster
			});
			reminderText = '';
			reminderMatch = '';
			msg = reminderTarget
				? `Reminder sent to ${reminderTarget}.`
				: 'Reminder broadcast to every scout in this event.';
			// Refresh the local list + the global store so the banner also sees it.
			recentReminders = await listReminders(session.eventCode);
			await reminderStore.pull();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function removeReminder(id) {
		err = '';
		msg = '';
		try {
			busy = true;
			await deleteReminder(session.eventCode, id);
			recentReminders = recentReminders.filter((r) => r.id !== id);
			await reminderStore.pull();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function resetScheduling() {
		err = '';
		msg = '';
		try {
			const ok = await dialog.confirm({
				title: `Reset scheduling for ${session.eventCode}?`,
				body:
					`Removes the published schedule, assignments, overrides, reminders and shared ` +
					`picklist for this event.\n\nScout-collected entries are NOT touched.`,
				confirmLabel: 'Reset scheduling',
				danger: true
			});
			if (!ok) return;
			busy = true;
			await resetEventData(session.eventCode);
			await reload();
			msg = 'Event planning data reset. Scouting entries were kept.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	/** Parse a "1234, 5678" editor cell into team numbers. */
	function parseTeams(text) {
		return (text || '')
			.split(/[\s,]+/)
			.map((x) => Number(x.replace(/[^0-9]/g, '')))
			.filter((n) => Number.isFinite(n) && n > 0);
	}

	async function autoAssign() {
		err = '';
		msg = '';
		const names = assignRows.map((r) => r.scout_name.trim()).filter(Boolean);
		if (names.length === 0) {
			err = 'Add at least one scout name first, then auto-assign.';
			return;
		}
		if (!qmList.length) {
			err = 'Fetch the schedule from TBA first — auto-assign needs the match list.';
			return;
		}

		// Hand the algorithm what's already in the editor. With it, scouts keep
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
		// watching — rather than a count of placement clashes. The old number
		// looked reassuringly small while a fifth of the event went unscouted.
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

	function addAssignRow() {
		assignRows = [...assignRows, { scout_name: '', teamsText: '' }];
	}

	function removeAssignRow(idx) {
		assignRows = assignRows.filter((_, i) => i !== idx);
		if (assignRows.length === 0) assignRows = [{ scout_name: '', teamsText: '' }];
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
				const dedup = [...new Set(parseTeams(r.teamsText))];
				for (const t of dedup) rows.push({ scout_name: name, team_number: t });
			}
			const inserted = await replaceAssignments(session.eventCode, rows, {
				roster
			});

			// Only touch the overrides table when auto-assign actually staged
			// something — a plain edit-and-save must not wipe hand-authored
			// overrides the manager added from the match modal.
			let overrideNote = '';
			if (pendingOverrides) {
				const n = await replaceOverrides(session.eventCode, pendingOverrides, {
						roster
				});
				overrideList = await listOverrides(session.eventCode);
				pendingOverrides = null;
				overrideNote = ` and ${n} per-match override${n === 1 ? '' : 's'}`;
			}

			await clearDraft();
			msg = `Saved ${inserted} assignment row${inserted === 1 ? '' : 's'}${overrideNote}.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	// ─── pre-fill link for an upcoming row ─────────────────────────────────

	function newEntryHref(row) {
		const params = new URLSearchParams({
			match: String(row.match),
			team: String(row.team),
			color: row.color
		});
		return `${base}/scouting/new/?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>Schedule · FRC Scout</title>
</svelte:head>

<main>
	<PageHead
		title="Schedule"
		sub="Fetch the schedule, assign who watches what, and tell them."
	/>

	{#if !session.eventCode}
		<Panel tone="quiet">
			<p class="muted">
				Set an event code in <a href="{base}/settings/">Settings</a> first.
			</p>
		</Panel>
	{:else}
		<!-- Two columns, because these are six independent panels and stacking them
		     put "Send reminder" four scrolls below "Publish schedule" — on a page
		     whose whole job is doing those in sequence.

		     Publishing and assigning lead, so they hold the left column in the
		     order the work happens; the three that are checks rather than actions
		     sit beside them. -->
		<div class="board">
			<div class="col">
				<PublishSchedule
					bind:tbaEventKey
					bind:tbaApiKey
					{busy}
					{cached}
					{qmList}
					{now}
					onFetch={fetchFromTba}
					onPublish={publishToTeammates}
					onClearCache={clearLocalCache}
				/>

				<AssignScouts
					{assignRows}
					{roster}
					{busy}
					{qmList}
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

				{#if cached && qmList.length}
					<SchedulePreview
						{qmList}
						{rollup}
						{entryIndex}
						{overridesByMatch}
						onOpenMatch={openMatch}
					/>
				{/if}
			</div>

			<div class="col">
				<ScoutRoster {scoutsInEvent} {now} />

				<CoverageCheck {coverageConflicts} onOpenMatch={openMatch} />

				<ReminderPanel
					bind:reminderTarget
					bind:reminderMatch
					bind:reminderText
					{reminderScouts}
					{recentReminders}
					{busy}
					onSend={sendReminder}
					onRemove={removeReminder}
				/>
			</div>
		</div>
	{/if}

	{#if msg}<p class="banner ok">{msg}</p>{/if}
	{#if err}<p class="banner err">{err}</p>{/if}

	<!-- ── Match-detail modal ────────────────────────────────────────────
		Manager taps "Edit" on a Schedule preview row OR a Coverage conflict
		to open this. Shows the match's two alliances, who's currently
		watching each team (base assignment or active override), and an
		editor to add/remove overrides for this match.
	-->
	{#if editingMatchObj}
		<MatchDetailModal
			m={editingMatchObj}
			draft={draftFor(editingMatchObj.match_number)}
			{overrideList}
			{entryIndex}
			{editingMatchCoverage}
			{reminderScouts}
			{busy}
			onClose={closeMatch}
			onDeleteOverride={deleteOverride}
			onSaveOverride={saveOverride}
			hrefFor={newEntryHref}
		/>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · palette: Studio ([data-studio])
	 *
	 * Thin on purpose — this page is a shell around six components in
	 * lib/components/studio/, each of which carries its own styles.
	 */

	/* `main { max-width: 36rem }` used to live here, which is the roadmap's
	   diagnosis of this page in one declaration: a 576px column inside a 992px
	   area, capped for a phone it no longer runs on. Studio's layout owns width
	   now, and it owns the bottom padding too — the reservation that used to be
	   here subtracted the height of a tab bar Studio does not render. */

	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
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
