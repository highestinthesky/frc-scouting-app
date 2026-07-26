<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { listEntries } from '$lib/db.js';
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
		isPassphraseSet,
		setPassphrase as setPassphraseRemote,
		verifyPassphrase,
		rotatePassphrase as rotatePassphraseRemote,
		resetEventData
	} from '$lib/event-meta.js';
	import {
		createReminder,
		deleteReminder,
		listReminders
	} from '$lib/reminders.js';
	import { reminders as reminderStore } from '$lib/reminders.svelte.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';
	import PublishSchedule from '$lib/components/schedule/PublishSchedule.svelte';
	import ManagerPassphrase from '$lib/components/schedule/ManagerPassphrase.svelte';
	import AssignScouts from '$lib/components/schedule/AssignScouts.svelte';
	import ScoutRoster from '$lib/components/schedule/ScoutRoster.svelte';
	import CoverageCheck from '$lib/components/schedule/CoverageCheck.svelte';
	import ReminderPanel from '$lib/components/schedule/ReminderPanel.svelte';
	import SchedulePreview from '$lib/components/schedule/SchedulePreview.svelte';
	import MyTeams from '$lib/components/schedule/MyTeams.svelte';
	import UpcomingMatches from '$lib/components/schedule/UpcomingMatches.svelte';
	import MatchDetailModal from '$lib/components/schedule/MatchDetailModal.svelte';

	// ─── shared state ──────────────────────────────────────────────────────

	/** Cached schedule for the current event: { cachedAt, matches } | null. */
	let cached = $state(null);
	let entries = $state([]);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const qmList = $derived(cached ? qualMatches(cached.matches) : []);

	// ── live coverage (shared with home + manager analytics) ────────────────
	// Index of which (match, team) cells have at least one entry. A teammate's
	// entry counts too, so coverage reflects the whole team's effort, not just
	// this device's. Recomputes whenever entries change (sync tick bumps them).
	const entryIndex = $derived(buildEntryIndex(entries, session.eventCode));
	const rollup = $derived(scheduleRollup(qmList, entryIndex));

	// Effective teams the scout is watching = manager-assigned ∪ local extras.
	const effectiveTeams = $derived(session.effectiveTeams);

	// Upcoming matches for the scout's assigned teams (already-recorded ones
	// are kept in the list but shown muted, so the scout has a sense of pace).
	const myUpcoming = $derived.by(() => {
		if (!qmList.length || !effectiveTeams.length) return [];
		const teamSet = new Set(effectiveTeams);
		const out = [];
		for (const m of qmList) {
			const { red, blue } = teamsInMatch(m);
			const all = [...red, ...blue].filter(Number.isFinite);
			for (const t of all) {
				if (!teamSet.has(t)) continue;
				const isRed = red.includes(t);
				out.push({
					match: m.match_number,
					team: t,
					color: isRed ? 'red' : 'blue',
					done: entryIndex.has(`${m.match_number}:${t}`),
					// TBA fills predicted_time as Unix seconds; actual_time once played.
					predictedTime: m.predicted_time ?? m.time ?? null,
					actualTime: m.actual_time ?? null
				});
			}
		}
		return out;
	});

	// Progress for the scout: how many of their team-matches have an entry.
	const myProgress = $derived.by(() => ({
		total: myUpcoming.length,
		done: myUpcoming.filter((r) => r.done).length
	}));

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
	let passphraseSetRemote = $state(false);
	let passphraseLocallyKnown = $derived(Boolean(session.managerToken));
	let pwInput = $state('');
	let pwInput2 = $state('');
	let verifyInput = $state('');

	// Rotation + reset state
	let rotateNew = $state('');
	let rotateNew2 = $state('');
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
		const map = new Map();
		const get = (name) => {
			if (!map.has(name)) map.set(name, { name, assigned: false, recording: false, count: 0, lastEntry: null });
			return map.get(name);
		};
		for (const r of assignRows) {
			const n = r.scout_name.trim();
			if (!n) continue;
			get(n).assigned = true;
		}
		for (const e of entries) {
			const n = String(e.scoutName ?? '').trim();
			if (!n) continue;
			const info = get(n);
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
			const lc = String(o.scout_name).trim().toLowerCase();
			const set = overrideByScout.get(lc) ?? { displayName: o.scout_name, teams: new Set() };
			set.teams.add(Number(o.team_number));
			overrideByScout.set(lc, set);
		}
		// Effective scout → teams map for THIS match: override wins, else base.
		const scoutTeams = new Map();
		for (const r of assignRows) {
			const name = r.scout_name.trim();
			if (!name) continue;
			const lc = name.toLowerCase();
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
						const override = overrideByScout.get(scoutName.toLowerCase());
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
		if (passphraseSetRemote && !session.managerToken) {
			err = 'Verify the manager passphrase before saving overrides.';
			return;
		}
		try {
			busy = true;
			await addOverride(
				session.eventCode,
				{ matchNumber, scoutName: d.scout.trim(), teamNumber: Number(d.team) },
				session.managerToken
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
			await removeOverride(session.eventCode, id, session.managerToken);
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

	// ─── mount: load cached schedule, entries, assignments, passphrase state ─

	onMount(async () => {
		await reload();
	});

	async function reload() {
		err = '';
		try {
			entries = await listEntries();
			cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			if (role.isManager && session.eventCode) {
				passphraseSetRemote = await isPassphraseSet(session.eventCode);
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
		}
	}

	// ─── scout actions ─────────────────────────────────────────────────────

	let newTeamInput = $state('');

	async function addLocalTeam() {
		const n = Number(String(newTeamInput).replace(/[^0-9]/g, ''));
		if (!Number.isFinite(n) || n <= 0) return;
		const next = [...(session.localExtraTeams ?? []), n];
		await session.update({ localExtraTeams: next });
		newTeamInput = '';
	}

	async function removeLocalTeam(n) {
		const next = (session.localExtraTeams ?? []).filter((t) => t !== n);
		await session.update({ localExtraTeams: next });
	}

	async function refreshFromServer() {
		busy = true;
		err = '';
		msg = '';
		try {
			const pulled = await pullSchedule(session.eventCode);
			cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			msg = pulled
				? `Pulled ${qualMatches(pulled.matches).length} qual matches.`
				: 'No schedule has been published for this event yet.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
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
			if (passphraseSetRemote && !session.managerToken) {
				throw new Error('Enter and verify the manager passphrase below before publishing.');
			}
			const qmCount = qmList.length;
			const totalCount = cached.matches.length;
			// Confirm so a stray tap (especially on the wrong event code) can't
			// silently overwrite everyone's schedule.
			const ok = confirm(
				`Publish ${qmCount} qual match${qmCount === 1 ? '' : 'es'} ` +
					`(${totalCount} total) for ${session.eventCode}?\n\n` +
					`This replaces the current published schedule. Scouts pull within 30 seconds.`
			);
			if (!ok) return;
			busy = true;
			safety = armSafetyTimer();
			const res = await publishSchedule(session.eventCode, cached.matches, {
				managerToken: session.managerToken || undefined,
				fetchedBy: session.scoutName || null,
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

	async function setPassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!pwInput.trim()) throw new Error('Passphrase is empty.');
			if (pwInput !== pwInput2) throw new Error('Passphrases do not match.');
			const token = await setPassphraseRemote(session.eventCode, pwInput);
			await session.update({ managerToken: token });
			passphraseSetRemote = true;
			pwInput = '';
			pwInput2 = '';
			msg = 'Manager passphrase set. Other manager devices will need this passphrase to publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function verifyAndStorePassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!verifyInput.trim()) throw new Error('Enter the passphrase.');
			const res = await verifyPassphrase(session.eventCode, verifyInput);
			if (!res.ok) throw new Error('That passphrase is not correct.');
			await session.update({ managerToken: res.token });
			verifyInput = '';
			msg = 'Passphrase verified. You can now publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function forgetPassphrase() {
		await session.update({ managerToken: '' });
		msg = 'Forgot the passphrase on this device. Re-enter it to publish again.';
	}

	async function rotatePassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!rotateNew.trim()) throw new Error('Enter a new passphrase.');
			if (rotateNew !== rotateNew2) throw new Error('New passphrases do not match.');
			const newToken = await rotatePassphraseRemote(
				session.eventCode,
				session.managerToken,
				rotateNew
			);
			await session.update({ managerToken: newToken });
			rotateNew = '';
			rotateNew2 = '';
			msg = 'Passphrase rotated. Other manager devices will need the new passphrase before they can publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function sendReminder() {
		err = '';
		msg = '';
		try {
			if (!reminderText.trim()) throw new Error('Reminder message is empty.');
			if (passphraseSetRemote && !session.managerToken) {
				throw new Error('Verify the manager passphrase before sending.');
			}
			busy = true;
			const matchNum = Number(reminderMatch);
			await createReminder(session.eventCode, {
				scoutName: reminderTarget || undefined,
				matchNumber: Number.isFinite(matchNum) && matchNum > 0 ? matchNum : undefined,
				message: reminderText,
				author: session.scoutName || null,
				managerToken: session.managerToken
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
			await deleteReminder(session.eventCode, id, session.managerToken);
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
			if (!session.managerToken) {
				throw new Error('Enter the current passphrase on this device first.');
			}
			const ok = confirm(
				`Reset scheduling for ${session.eventCode}?\n\n` +
					`This removes the manager passphrase, the published schedule, and all ` +
					`scout assignments for this event from the server. Scout-collected ` +
					`entries are NOT touched.\n\n` +
					`After reset, the next device to set a passphrase becomes the new manager. Continue?`
			);
			if (!ok) return;
			busy = true;
			await resetEventData(session.eventCode, session.managerToken);
			await session.update({ managerToken: '' });
			await reload();
			msg = 'Scheduling reset. Set a fresh passphrase and re-publish the schedule.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	function autoAssign() {
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
		const ok = confirm(
			`Auto-assign every team at ${session.eventCode} across ${names.length} ` +
				`scout${names.length === 1 ? '' : 's'}?\n\n` +
				`This replaces the team lists in the editor AND every per-match override ` +
				`for this event, so the plan stays internally consistent.\n\n` +
				`Nothing is saved until you tap “Save assignments”.`
		);
		if (!ok) return;
		const plan = autoAssignTeams(qmList, names);
		assignRows = [...plan.assignments.entries()]
			.map(([scout_name, teams]) => ({ scout_name, teamsText: teams.join(', ') }))
			.sort((a, b) => a.scout_name.localeCompare(b.scout_name));
		pendingOverrides = plan.overrides;

		// Report coverage — the share of team-matches somebody is actually
		// watching — rather than a count of placement clashes. The old number
		// looked reassuringly small while a fifth of the event went unscouted.
		const pct = Math.round(plan.coverage.pct);
		const head =
			`Distributed ${plan.teamCount} teams across ${plan.scoutCount} ` +
			`scout${plan.scoutCount === 1 ? '' : 's'} — ${pct}% of team-matches covered`;
		msg = plan.ceiling.limited
			? `${head}. Six robots play at once, so ${plan.scoutCount} ` +
				`scout${plan.scoutCount === 1 ? '' : 's'} can't exceed ` +
				`${Math.round(plan.ceiling.pct)}% however they're arranged — add more ` +
				`scouts to go higher. Review, then Save.`
			: `${head}, using ${plan.overrides.length} per-match ` +
				`override${plan.overrides.length === 1 ? '' : 's'}. Review, then Save.`;
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
			if (passphraseSetRemote && !session.managerToken) {
				throw new Error('Verify the manager passphrase before saving assignments.');
			}
			const rows = [];
			for (const r of assignRows) {
				const name = r.scout_name.trim();
				if (!name) continue;
				const teams = (r.teamsText || '')
					.split(/[\s,]+/)
					.map((s) => Number(s.replace(/[^0-9]/g, '')))
					.filter((n) => Number.isFinite(n) && n > 0);
				const dedup = [...new Set(teams)];
				for (const t of dedup) rows.push({ scout_name: name, team_number: t });
			}
			const inserted = await replaceAssignments(session.eventCode, rows, {
				managerToken: session.managerToken
			});

			// Only touch the overrides table when auto-assign actually staged
			// something — a plain edit-and-save must not wipe hand-authored
			// overrides the manager added from the match modal.
			let overrideNote = '';
			if (pendingOverrides) {
				const n = await replaceOverrides(session.eventCode, pendingOverrides, {
					managerToken: session.managerToken
				});
				overrideList = await listOverrides(session.eventCode);
				pendingOverrides = null;
				overrideNote = ` and ${n} per-match override${n === 1 ? '' : 's'}`;
			}

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
		return `${base}/new/?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>Schedule · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/" aria-label="Back">←</a>
		<h1>Schedule</h1>
	</header>

	{#if !session.eventCode}
		<p class="muted">
			Set an event code in <a href="{base}/settings/">Settings</a> first.
		</p>
	{:else}
		<!-- ── Manager view ────────────────────────────────────────────── -->
		{#if role.isManager}
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

			<ManagerPassphrase
				bind:pwInput
				bind:pwInput2
				bind:verifyInput
				bind:rotateNew
				bind:rotateNew2
				bind:showForgotHelp
				{passphraseSetRemote}
				{passphraseLocallyKnown}
				{busy}
				onSet={setPassphrase}
				onVerify={verifyAndStorePassphrase}
				onForget={forgetPassphrase}
				onRotate={rotatePassphrase}
				onReset={resetScheduling}
			/>

			<AssignScouts
				{assignRows}
				{busy}
				{qmList}
				pendingOverrideCount={pendingOverrides?.length ?? 0}
				onAddRow={addAssignRow}
				onRemoveRow={removeAssignRow}
				onAutoAssign={autoAssign}
				onSave={saveAssignments}
			/>

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

			{#if cached && qmList.length}
				<SchedulePreview
					{qmList}
					{rollup}
					{entryIndex}
					{overridesByMatch}
					onOpenMatch={openMatch}
				/>
			{/if}
		{:else}
			<!-- ── Scout view ───────────────────────────────────────────── -->
			<MyTeams
				bind:newTeamInput
				{effectiveTeams}
				{cached}
				{qmList}
				{busy}
				{now}
				onAddTeam={addLocalTeam}
				onRemoveTeam={removeLocalTeam}
				onRefresh={refreshFromServer}
			/>
		{/if}

		<!-- ── Upcoming matches: scout-only ─────────────────────────────
			Managers already see every match in the Schedule preview block
			above; this section is filtered to the device's assigned teams,
			which is empty for a manager device and just adds confusion.
		-->
		{#if !role.isManager}
			<UpcomingMatches
				{cached}
				{effectiveTeams}
				{myUpcoming}
				{myProgress}
				{now}
				hrefFor={newEntryHref}
			/>
		{/if}
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
	main {
		max-width: 36rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.banner {
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
		font-size: 0.9rem;
	}
	.banner.ok { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.banner.err { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger); }
</style>
