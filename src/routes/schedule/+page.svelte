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
		removeOverride
	} from '$lib/assignments.js';
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

	// ─── shared state ──────────────────────────────────────────────────────

	/** Cached schedule for the current event: { cachedAt, matches } | null. */
	let cached = $state(null);
	let entries = $state([]);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const qmList = $derived(cached ? qualMatches(cached.matches) : []);

	// Effective teams the scout is watching = manager-assigned ∪ local extras.
	const effectiveTeams = $derived(session.effectiveTeams);

	// Upcoming matches for the scout's assigned teams (already-recorded ones
	// are kept in the list but shown muted, so the scout has a sense of pace).
	const myUpcoming = $derived.by(() => {
		if (!qmList.length || !effectiveTeams.length) return [];
		const teamSet = new Set(effectiveTeams);
		const doneKey = new Set(entries.map((e) => `${e.matchNumber}:${e.teamNumber}`));
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
					done: doneKey.has(`${m.match_number}:${t}`),
					// TBA fills predicted_time as Unix seconds; actual_time once played.
					predictedTime: m.predicted_time ?? m.time ?? null,
					actualTime: m.actual_time ?? null
				});
			}
		}
		return out;
	});

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
		const overrideKey = (m, s) => `${m}:${String(s ?? '').trim().toLowerCase()}`;
		const overrideMap = new Map();
		for (const o of overrideList) {
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
			msg = `Saved ${inserted} assignment row${inserted === 1 ? '' : 's'}.`;
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
			<section>
				<h2>Publish schedule</h2>
				<p class="muted">
					You fetch the match schedule from The Blue Alliance, then publish it
					so every scout on <code>{session.eventCode}</code> can pull it without
					needing their own TBA key.
				</p>

				<label class="field">
					<span class="label">TBA event key</span>
					<small class="help">
						The Blue Alliance's canonical key for this event (e.g.
						<strong>2027nyny</strong>). Can differ from your team's event code —
						scouts only ever type the code. Leave blank to use
						<code>{session.eventCode}</code> as the key.
					</small>
					<input
						type="text"
						bind:value={tbaEventKey}
						placeholder={session.eventCode}
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
					/>
				</label>

				<p class="key-summary">
					Your code: <strong>{session.eventCode}</strong>
					<span class="key-sep">·</span>
					TBA key: <strong>{(tbaEventKey || '').trim() || session.eventCode}</strong>
				</p>

				<label class="field">
					<span class="label">TBA API key</span>
					<small class="help">
						Free key at <strong>thebluealliance.com/account</strong> → Read API
						Keys. Stored only on this device.
					</small>
					<input
						type="password"
						bind:value={tbaApiKey}
						placeholder="Paste your TBA read API key"
						autocomplete="off"
						autocapitalize="none"
					/>
				</label>

				<div class="actions-row">
					<button class="primary" disabled={busy || !tbaApiKey} onclick={fetchFromTba}>
						{busy ? '…' : '1. Fetch from TBA'}
					</button>
					<button
						class="primary"
						disabled={busy || !cached}
						onclick={publishToTeammates}
					>
						{busy ? '…' : '2. Publish to teammates'}
					</button>
					<button class="secondary-btn" disabled={busy || !cached} onclick={clearLocalCache}>
						Clear local cache
					</button>
				</div>

				{#if cached}
					<p class="muted small">
						Local cache: {qmList.length} qual matches · fetched
						{relativeTime(cached.cachedAt, now)}
						({new Date(cached.cachedAt).toLocaleString()})
						{#if cached.fetchedBy} by {cached.fetchedBy}{/if}
					</p>
				{:else}
					<p class="muted small">No schedule fetched yet.</p>
				{/if}
			</section>

			<section>
				<h2>Manager passphrase</h2>
				<p class="muted">
					Once set, publishing the schedule and editing assignments requires this
					passphrase. Scouts never need it.
				</p>

				{#if !passphraseSetRemote}
					<p class="muted small">
						No passphrase set for <code>{session.eventCode}</code> yet. The first
						manager device to set one wins.
					</p>
					<label class="field">
						<span class="label">New passphrase</span>
						<input type="password" bind:value={pwInput} autocomplete="new-password" />
					</label>
					<label class="field">
						<span class="label">Confirm</span>
						<input type="password" bind:value={pwInput2} autocomplete="new-password" />
					</label>
					<button class="primary" disabled={busy || !pwInput} onclick={setPassphrase}>
						Set passphrase
					</button>
				{:else if passphraseLocallyKnown}
					<p class="muted small ok-inline">
						✓ Passphrase active on this device. You can publish and edit
						assignments.
					</p>
					<div class="actions-row">
						<button class="secondary-btn" onclick={forgetPassphrase}>Forget on this device</button>
						<button class="secondary-btn danger-btn" onclick={resetScheduling} disabled={busy}>
							Reset scheduling for this event
						</button>
					</div>

					<details class="rotate-block">
						<summary>Change passphrase</summary>
						<p class="muted small">
							Pick a new passphrase. Other manager devices will need it before
							they can publish or edit assignments again.
						</p>
						<label class="field">
							<span class="label">New passphrase</span>
							<input type="password" bind:value={rotateNew} autocomplete="new-password" />
						</label>
						<label class="field">
							<span class="label">Confirm</span>
							<input type="password" bind:value={rotateNew2} autocomplete="new-password" />
						</label>
						<button class="primary" disabled={busy || !rotateNew} onclick={rotatePassphrase}>
							Rotate
						</button>
					</details>
				{:else}
					<p class="muted small">
						A passphrase is set for this event. Enter it to publish from this
						device.
					</p>
					<label class="field">
						<span class="label">Passphrase</span>
						<input type="password" bind:value={verifyInput} autocomplete="current-password" />
					</label>
					<button class="primary" disabled={busy || !verifyInput} onclick={verifyAndStorePassphrase}>
						Verify
					</button>

					<details class="forgot-block" bind:open={showForgotHelp}>
						<summary>Forgot the passphrase?</summary>
						<p class="muted small">
							There's no in-app recovery for a fully-lost passphrase. An
							admin needs to clear the event's row in Supabase Studio, after
							which the next device to set a passphrase wins.
						</p>
						<p class="muted small">
							From Supabase Studio → SQL Editor, run:
						</p>
						<pre class="sql-snippet"><code>DELETE FROM public.event_meta
WHERE event_code = '{session.eventCode}';</code></pre>
						<p class="muted small">
							Then come back here, set a fresh passphrase, and re-publish.
						</p>
					</details>
				{/if}
			</section>

			<section>
				<h2>Assign scouts</h2>
				<p class="muted">
					One row per scout. Team numbers are comma- or space-separated. Saving
					replaces the entire assignment list on the server.
				</p>
				{#each assignRows as r, i}
					<div class="assign-row">
						<input
							class="scout-name"
							placeholder="Scout name"
							bind:value={r.scout_name}
						/>
						<input
							class="team-list"
							placeholder="e.g. 1234, 5678, 9012"
							bind:value={r.teamsText}
							inputmode="numeric"
						/>
						<button
							type="button"
							class="row-x"
							aria-label="Remove row"
							onclick={() => removeAssignRow(i)}
						>
							×
						</button>
					</div>
				{/each}
				<div class="actions-row">
					<button class="secondary-btn" onclick={addAssignRow}>+ Add scout</button>
					<button class="primary" disabled={busy} onclick={saveAssignments}>
						{busy ? 'Saving…' : 'Save assignments'}
					</button>
				</div>
			</section>
			<!-- ── Scouts in this event ────────────────────────────────── -->
			<section>
				<h2>Scouts in this event</h2>
				<p class="muted">
					Anyone who has either been assigned teams above or recorded an entry
					for <code>{session.eventCode}</code>. Entries are pulled on the sync
					tick, so a scout who's currently offline may not appear until they
					reconnect.
				</p>
				{#if scoutsInEvent.length === 0}
					<p class="muted small">Nobody yet. Add assignments above or wait for a scout to record their first entry.</p>
				{:else}
					<ul class="roster">
						{#each scoutsInEvent as s (s.name)}
							<li class="roster-row">
								<span class="rs-name">{s.name}</span>
								<span class="rs-tags">
									{#if s.assigned}<span class="rs-tag assigned">assigned</span>{/if}
									{#if s.recording}<span class="rs-tag recording">{s.count} {s.count === 1 ? 'entry' : 'entries'}</span>{/if}
									{#if !s.assigned && s.recording}<span class="rs-tag warn">not assigned</span>{/if}
								</span>
								{#if s.lastEntry}
									<span class="rs-last">last {relativeTime(s.lastEntry, now)}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Coverage check ──────────────────────────────────────── -->
			<section>
				<h2>Coverage check</h2>
				<p class="muted">
					Spots a single scout assigned to two-plus teams in the same match. Click the
					match number to jump to the schedule row, where you can add a per-match
					override that picks one team for this match only.
				</p>
				{#if coverageConflicts.length === 0}
					<p class="muted small ok-inline">✓ No conflicts.</p>
				{:else}
					<ul class="conflict-list">
						{#each coverageConflicts as c (c.match + ':' + c.scout)}
							<li class="conflict-row">
								<button type="button" class="cf-match" onclick={() => openMatch(c.match)}>Q{c.match}</button>
								<span class="cf-scout">{c.scout}</span>
								<span class="cf-teams">{c.teams.join(' · ')}</span>
								{#if c.hasOverride}
									<span class="cf-tag">override active, still overlaps</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Send reminder (manager) ───────────────────────────── -->
			<section>
				<h2>Send reminder</h2>
				<p class="muted">
					Posts a banner to the targeted scout (or everyone) until they dismiss
					it. Expires automatically after 2 hours. Scouts also get an automatic
					banner 15 minutes before any match where one of their assigned teams
					plays — no action needed for those.
				</p>

				<div class="reminder-form">
					<label class="field">
						<span class="label">Recipient</span>
						<select bind:value={reminderTarget}>
							<option value="">Everyone</option>
							{#each reminderScouts as name}
								<option value={name}>{name}</option>
							{/each}
						</select>
					</label>

					<label class="field reminder-match">
						<span class="label">Match (optional)</span>
						<input
							type="number"
							bind:value={reminderMatch}
							placeholder="e.g. 15"
							inputmode="numeric"
						/>
					</label>

					<label class="field reminder-msg">
						<span class="label">Message</span>
						<input
							type="text"
							bind:value={reminderText}
							placeholder="e.g. Q15 starts in 5 min — get to position"
							maxlength="200"
						/>
					</label>

					<button class="primary" disabled={busy || !reminderText.trim()} onclick={sendReminder}>
						{busy ? '…' : 'Send reminder'}
					</button>
				</div>

				{#if recentReminders.length > 0}
					<h3 class="reminder-active-head">Active reminders</h3>
					<ul class="reminder-list">
						{#each recentReminders as r (r.id)}
							<li class="reminder-row">
								<div class="rr-body">
									<span class="rr-target">
										{r.scout_name ? `→ ${r.scout_name}` : '→ everyone'}
									</span>
									{#if r.match_number}<span class="rr-match">Q{r.match_number}</span>{/if}
									<span class="rr-msg">{r.message}</span>
								</div>
								<button
									type="button"
									class="rr-x"
									aria-label="Delete reminder"
									onclick={() => removeReminder(r.id)}
								>✕</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Schedule preview (manager) ──────────────────────────── -->
			{#if cached && qmList.length}
				<section>
					<h2>Schedule preview</h2>
					<p class="muted small">
						{qmList.length} qual matches. Use this to spot-check the fetch before publishing.
					</p>
					<ol class="sched-preview">
						{#each qmList as m (m.match_number)}
							{@const matchTime = m.actual_time ?? m.predicted_time ?? m.time ?? null}
							{@const red = (m.alliances?.red?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
							{@const blue = (m.alliances?.blue?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
							{@const myOv = overridesByMatch.get(m.match_number) ?? []}
							<li class="sched-li" id={`match-${m.match_number}`}>
								<div class="sched-row">
									<span class="sp-match">Q{m.match_number}</span>
									<span class="sp-side red">{red.join(' · ')}</span>
									<span class="sp-vs">vs</span>
									<span class="sp-side blue">{blue.join(' · ')}</span>
									{#if matchTime}
										<span class="sp-time">{timeOfDay(matchTime)}</span>
									{/if}
									<button
										type="button"
										class="sp-edit"
										onclick={() => openMatch(m.match_number)}
										aria-label={`Edit Q${m.match_number}`}
									>
										✎ Edit
										{#if myOv.length > 0}<span class="ov-pill">{myOv.length}</span>{/if}
									</button>
								</div>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
		{:else}
			<!-- ── Scout view ───────────────────────────────────────────── -->

			<section>
				<h2>Your teams</h2>
				<p class="muted">
					Teams you're watching today. Manager-assigned teams appear here
					automatically; you can also add extras yourself if you're filling in.
				</p>

				{#if effectiveTeams.length === 0}
					<p class="muted small">
						No teams yet. Either the manager hasn't assigned you, or your scout
						name on this device doesn't match the one they used.
						Your name: <strong>{session.scoutName || '(not set)'}</strong>.
					</p>
				{:else}
					<div class="team-chips">
						{#each effectiveTeams as t}
							{@const isLocal = (session.localExtraTeams ?? []).includes(t)}
							<span class="team-chip" class:local={isLocal}>
								{t}
								{#if isLocal}
									<button
										type="button"
										class="chip-x"
										aria-label="Remove team {t}"
										onclick={() => removeLocalTeam(t)}
									>×</button>
								{/if}
							</span>
						{/each}
					</div>
				{/if}

				<div class="add-team">
					<input
						type="number"
						bind:value={newTeamInput}
						placeholder="Add team (e.g. 1234)"
						inputmode="numeric"
					/>
					<button class="secondary-btn" disabled={!newTeamInput} onclick={addLocalTeam}>
						Add
					</button>
				</div>

				<div class="actions-row" style="margin-top: 0.6rem;">
					<button class="secondary-btn" disabled={busy} onclick={refreshFromServer}>
						{busy ? '…' : 'Refresh from manager'}
					</button>
				</div>

				{#if cached}
					<p class="muted small freshness">
						Schedule pulled {relativeTime(cached.cachedAt, now)}
						{#if cached.fetchedBy} (published by {cached.fetchedBy}){/if}
						· {qmList.length} qual matches
					</p>
				{/if}
			</section>
		{/if}

		<!-- ── Upcoming matches: scout-only ─────────────────────────────
			Managers already see every match in the Schedule preview block
			above; this section is filtered to the device's assigned teams,
			which is empty for a manager device and just adds confusion.
		-->
		{#if !role.isManager}
		<section>
			<h2>Upcoming matches</h2>
			{#if !cached}
				<p class="muted small">
					{#if role.isManager}
						Fetch and publish to populate this list.
					{:else}
						No schedule pulled yet. Tap “Refresh from manager” above once your
						manager has published.
					{/if}
				</p>
			{:else if !effectiveTeams.length}
				<p class="muted small">Add at least one team above to see your matches.</p>
			{:else if myUpcoming.length === 0}
				<p class="muted small">None of your teams appear in the qual schedule.</p>
			{:else}
				<ul class="upcoming">
					{#each myUpcoming as row (row.match + ':' + row.team)}
						{@const matchTime = row.actualTime ?? row.predictedTime}
						<li class="upcoming-row" data-color={row.color} class:done={row.done}>
							<a href={newEntryHref(row)} class="upcoming-link">
								<span class="up-match">Q{row.match}</span>
								<span class="up-team">Team {row.team}</span>
								<span class="up-color">{row.color}</span>
								{#if matchTime}
									<span class="up-time">
										{timeOfDay(matchTime)}
										<span class="up-rel">· {relativeTime(matchTime, now)}</span>
									</span>
								{/if}
								{#if row.done}<span class="up-done">✓ scouted</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
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
		{@const m = editingMatchObj}
		{@const matchTime = m.actual_time ?? m.predicted_time ?? m.time ?? null}
		{@const matchOverrides = overrideList.filter((o) => o.match_number === m.match_number)}
		{@const teamsRed = (m.alliances?.red?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
		{@const teamsBlue = (m.alliances?.blue?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')))}
		{@const draft = draftFor(m.match_number)}
		<div
			class="modal-backdrop"
			role="presentation"
			onclick={(e) => { if (e.target === e.currentTarget) closeMatch(); }}
		>
			<div
				class="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="match-editor-title"
			>
				<header class="modal-head">
					<h2 id="match-editor-title">
						Q{m.match_number}
						{#if matchTime}<span class="mh-time">· {timeOfDay(matchTime)}</span>{/if}
					</h2>
					<button type="button" class="modal-x" onclick={closeMatch} aria-label="Close">✕</button>
				</header>

				<div class="modal-body">
					<!-- Coverage map: for each team, who's watching it. -->
					<section class="mb-section">
						<h3 class="mb-h">Coverage</h3>
						<ul class="mb-coverage">
							{#each editingMatchCoverage as row (row.color + ':' + row.team)}
								<li class="mb-team" data-color={row.color}>
									<span class="mb-color-tag">{row.color}</span>
									<span class="mb-team-num">{row.team}</span>
									<span class="mb-watchers">
										{#if row.watchers.length === 0}
											<em class="mb-none">no scout</em>
										{:else}
											{#each row.watchers as w, i}
												{w.scout}{#if w.viaOverride} <small class="mb-override-tag">(override)</small>{/if}{#if i < row.watchers.length - 1}, {/if}
											{/each}
										{/if}
									</span>
									<a
										class="mb-scout"
										href={newEntryHref({ match: m.match_number, team: row.team, color: row.color })}
									>Scout →</a>
								</li>
							{/each}
						</ul>
					</section>

					<!-- Active overrides for this match. -->
					<section class="mb-section">
						<h3 class="mb-h">
							Overrides
							{#if matchOverrides.length > 0}<span class="ov-pill">{matchOverrides.length}</span>{/if}
						</h3>
						{#if matchOverrides.length === 0}
							<p class="muted small">
								No overrides for this match. Base assignments apply.
							</p>
						{:else}
							<ul class="mb-overrides">
								{#each matchOverrides as o (o.id)}
									<li class="mb-or-row">
										<span><strong>{o.scout_name}</strong> watches <strong>{o.team_number}</strong></span>
										<button
											type="button"
											class="ov-x"
											aria-label="Remove override"
											onclick={() => deleteOverride(o.id)}
											disabled={busy}
										>✕</button>
									</li>
								{/each}
							</ul>
						{/if}

						<!-- Add an override for this match. -->
						<div class="mb-form">
							<label class="mb-field">
								<span class="mb-label">Scout</span>
								<select bind:value={draft.scout}>
									<option value="">…</option>
									{#each reminderScouts as name}
										<option value={name}>{name}</option>
									{/each}
								</select>
							</label>
							<label class="mb-field">
								<span class="mb-label">Watches team</span>
								<select bind:value={draft.team}>
									<option value="">…</option>
									{#each [...teamsRed, ...teamsBlue] as t}
										<option value={String(t)}>{t}</option>
									{/each}
								</select>
							</label>
							<button
								type="button"
								class="primary mb-add"
								disabled={busy || !draft.scout || !draft.team}
								onclick={() => saveOverride(m.match_number)}
							>Add override</button>
						</div>
					</section>
				</div>

				<footer class="modal-foot">
					<button type="button" class="secondary-btn" onclick={closeMatch}>Done</button>
				</footer>
			</div>
		</div>
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
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.muted.small { font-size: 0.82rem; }
	.ok-inline { color: var(--success); }
	code {
		background: var(--bg-subtle);
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
	.help { color: var(--text-faint); font-size: 0.82rem; }
	.key-summary {
		margin: 0 0 0.9rem;
		padding: 0.4rem 0.6rem;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.key-summary strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
	.key-sep { opacity: 0.5; margin: 0 0.35rem; }
	input {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}

	button.primary,
	button.secondary-btn {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary {
		background: var(--accent);
		color: var(--on-accent);
		border: none;
	}
	button.primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	button.secondary-btn {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
	}
	button.secondary-btn:hover { background: var(--bg-subtle); }
	button.secondary-btn:disabled { opacity: 0.6; cursor: progress; }

	.actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}

	.banner {
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
		font-size: 0.9rem;
	}
	.banner.ok { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.banner.err { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger); }

	.freshness {
		margin-top: 0.6rem;
		font-style: italic;
		font-size: 0.8rem;
	}

	.danger-btn {
		color: var(--danger);
		border-color: var(--danger);
	}
	.danger-btn:hover { background: var(--danger-bg); }

	.rotate-block, .forgot-block {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--bg-subtle);
	}
	.rotate-block summary, .forgot-block summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.rotate-block[open], .forgot-block[open] {
		padding-bottom: 0.75rem;
	}
	.rotate-block[open] summary, .forgot-block[open] summary {
		margin-bottom: 0.5rem;
	}

	.sql-snippet {
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: 0.3rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.8rem;
		overflow-x: auto;
		margin: 0.4rem 0;
	}
	.sql-snippet code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: none;
		padding: 0;
	}

	/* ── manager: assignment editor ─────────────────────────────────── */
	.assign-row {
		display: grid;
		grid-template-columns: 1fr 2fr auto;
		gap: 0.4rem;
		margin-bottom: 0.45rem;
	}
	.scout-name, .team-list {
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
		min-width: 0;
	}
	.row-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.4rem;
	}
	.row-x:hover { color: var(--danger); }

	/* ── scout: team chips ──────────────────────────────────────────── */
	.team-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
	.team-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid var(--accent);
		font-weight: 700;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.9rem;
	}
	.team-chip.local {
		background: var(--bg-subtle);
		color: var(--text-primary);
		border-color: var(--border-strong);
		font-weight: 600;
	}
	.chip-x {
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.chip-x:hover { color: var(--danger); }
	.add-team {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.add-team input { flex: 1 1 0; min-width: 0; }

	/* ── upcoming matches list ──────────────────────────────────────── */
	.upcoming {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.upcoming-row {
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.4rem;
		background: var(--bg-card);
	}
	.upcoming-row[data-color='red'] { border-left-color: var(--alliance-red); }
	.upcoming-row[data-color='blue'] { border-left-color: var(--alliance-blue); }
	.upcoming-row.done { opacity: 0.55; }
	.upcoming-link {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.55rem 0.75rem;
		color: inherit;
		text-decoration: none;
		flex-wrap: wrap;
	}
	.upcoming-link:hover { background: var(--bg-subtle); }
	.up-match { font-weight: 700; color: var(--accent); min-width: 3rem; }
	.up-team { font-weight: 600; }
	.up-color { color: var(--text-muted); text-transform: capitalize; font-size: 0.85rem; }
	.up-time {
		color: var(--text-muted);
		font-size: 0.82rem;
		margin-left: auto;
		white-space: nowrap;
	}
	.up-rel { color: var(--text-faint); font-size: 0.78rem; }
	.up-done {
		color: var(--success);
		font-size: 0.8rem;
		font-weight: 600;
	}

	/* ── manager: send reminder ─────────────────────────────────── */
	.reminder-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		align-items: end;
	}
	.reminder-form .field { margin-bottom: 0; }
	.reminder-form .reminder-msg { grid-column: 1 / -1; }
	.reminder-form select {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.reminder-form .primary { grid-column: 1 / -1; justify-self: start; }

	.reminder-active-head {
		margin: 1rem 0 0.4rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.reminder-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.reminder-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		font-size: 0.85rem;
	}
	.rr-body { flex: 1 1 0; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: baseline; }
	.rr-target { color: var(--text-muted); font-size: 0.78rem; }
	.rr-match { font-weight: 700; color: var(--accent); }
	.rr-msg { color: var(--text-primary); }
	.rr-x {
		background: transparent;
		border: none;
		font-size: 1rem;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0 0.3rem;
	}
	.rr-x:hover { color: var(--danger); }

	@media (max-width: 28rem) {
		.reminder-form { grid-template-columns: 1fr; }
	}

	/* ── manager: full-schedule preview ─────────────────────────── */
	.sched-preview {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.sched-row {
		display: grid;
		/* match · red · vs · blue · time · edit — an explicit column per cell so
		   the Edit button never auto-flows into the narrow match column (which
		   used to clip its label). */
		grid-template-columns: 2.5rem minmax(0, 1fr) auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 0.3rem;
		background: var(--bg-card);
		font-size: 0.85rem;
	}
	.sp-match { font-weight: 700; color: var(--accent); }
	.sp-side { font-variant-numeric: tabular-nums; }
	.sp-side.red { color: var(--alliance-red); text-align: right; }
	.sp-side.blue { color: var(--alliance-blue); text-align: left; }
	.sp-vs {
		color: var(--text-faint);
		font-size: 0.75rem;
		text-transform: uppercase;
	}
	.sp-time {
		color: var(--text-muted);
		font-size: 0.78rem;
		white-space: nowrap;
	}
	@media (max-width: 28rem) {
		.sched-row {
			grid-template-columns: 2.5rem 1fr auto;
			grid-template-rows: auto auto;
			row-gap: 0.15rem;
			column-gap: 0.55rem;
		}
		.sp-vs { display: none; }
		.sp-side.red { grid-row: 1; grid-column: 2; text-align: left; }
		.sp-side.blue { grid-row: 2; grid-column: 2; text-align: left; }
		.sp-match { grid-row: 1 / span 2; }
		.sp-time {
			grid-row: 1;
			grid-column: 3;
			align-self: center;
			justify-self: end;
		}
		.sp-edit {
			grid-row: 2;
			grid-column: 3;
			justify-self: end;
		}
	}

	.sched-li { list-style: none; }
	.sp-edit {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		padding: 0.4rem 0.75rem;
		border-radius: 0.35rem;
		cursor: pointer;
		align-self: center;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		white-space: nowrap;
		min-height: 1.85rem;
	}
	.sp-edit:hover { color: var(--accent); border-color: var(--accent); }
	.ov-pill {
		display: inline-block;
		padding: 0 0.4rem;
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
	}
	.ov-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: 0.9rem;
	}
	.ov-x:hover { color: var(--danger); }

	/* ── match-detail modal ─────────────────────────────────────── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 50;
		animation: fadein 0.12s ease-out;
	}
	@keyframes fadein {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	.modal-card {
		background: var(--bg-card);
		color: var(--text-primary);
		border-radius: 0.6rem;
		border: 1px solid var(--border);
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
		width: 100%;
		max-width: 30rem;
		max-height: calc(100vh - 2rem);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.modal-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.modal-head h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-primary);
		flex: 1 1 0;
		min-width: 0;
	}
	.mh-time {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 0.9rem;
		margin-left: 0.4rem;
	}
	.modal-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
		line-height: 1;
		border-radius: 0.25rem;
	}
	.modal-x:hover { color: var(--text-primary); background: var(--bg-subtle); }

	.modal-body {
		padding: 0.5rem 1rem 1rem;
		overflow-y: auto;
	}
	.mb-section { margin-top: 0.9rem; }
	.mb-section:first-child { margin-top: 0.3rem; }
	.mb-h {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: 0 0 0.4rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.mb-coverage {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.mb-team {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.35rem;
		background: var(--bg-card);
		font-size: 0.88rem;
	}
	.mb-team[data-color='red'] { border-left-color: var(--alliance-red); }
	.mb-team[data-color='blue'] { border-left-color: var(--alliance-blue); }
	.mb-color-tag {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
		min-width: 2.4rem;
	}
	.mb-team-num { font-weight: 700; min-width: 3.5rem; }
	.mb-watchers { color: var(--text-muted); flex: 1 1 0; min-width: 0; }
	.mb-none { color: var(--text-faint); font-style: italic; }
	.mb-override-tag {
		color: var(--accent);
		font-weight: 600;
		font-size: 0.75rem;
	}
	.mb-scout {
		flex-shrink: 0;
		font-size: 0.76rem;
		font-weight: 700;
		text-decoration: none;
		color: var(--accent);
		border: 1px solid var(--border-strong);
		border-radius: 0.3rem;
		padding: 0.18rem 0.5rem;
		white-space: nowrap;
	}
	.mb-scout:hover { border-color: var(--accent); background: var(--accent-soft); }

	.mb-overrides {
		list-style: none;
		padding: 0;
		margin: 0 0 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.mb-or-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--bg-subtle);
		padding: 0.4rem 0.55rem;
		border-radius: 0.35rem;
		font-size: 0.88rem;
	}

	.mb-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		align-items: end;
		margin-top: 0.4rem;
	}
	.mb-field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.mb-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.mb-field select {
		font: inherit;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.35rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.mb-add {
		grid-column: 1 / -1;
		justify-self: start;
		padding: 0.45rem 0.9rem;
	}

	.modal-foot {
		padding: 0.65rem 1rem;
		border-top: 1px solid var(--border);
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 28rem) {
		.modal-card { max-width: 100%; }
		.mb-form { grid-template-columns: 1fr; }
	}

	/* ── scouts roster ──────────────────────────────────────────── */
	.roster {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.roster-row {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.4rem 0.6rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		font-size: 0.88rem;
	}
	.rs-name { font-weight: 700; }
	.rs-tags { display: flex; gap: 0.35rem; flex-wrap: wrap; }
	.rs-tag {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rs-tag.assigned { background: var(--accent-soft); color: var(--accent); }
	.rs-tag.recording { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.rs-tag.warn { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
	.rs-last { margin-left: auto; color: var(--text-muted); font-size: 0.8rem; }

	/* ── coverage check ─────────────────────────────────────────── */
	.conflict-list {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.conflict-row {
		display: flex;
		gap: 0.45rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.4rem 0.6rem;
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: 0.35rem;
		font-size: 0.85rem;
		color: var(--warning);
	}
	.cf-match {
		font: inherit;
		font-weight: 700;
		color: var(--warning);
		background: transparent;
		border: none;
		border-bottom: 1px dotted currentColor;
		padding: 0;
		cursor: pointer;
	}
	.cf-match:hover { color: var(--accent); border-bottom-color: var(--accent); }
	.cf-scout { font-weight: 600; }
	.cf-teams { font-variant-numeric: tabular-nums; }
	.cf-tag {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-style: italic;
	}
</style>
