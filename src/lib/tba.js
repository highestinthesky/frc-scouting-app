// The Blue Alliance (TBA) API v3 integration + central schedule sync.
//
// Two flows:
//
//   Manager flow:
//     fetchAndCacheSchedule()  → hit TBA, cache locally
//     publishSchedule()        → upload to Supabase so scouts can pull it
//
//   Scout flow:
//     pullSchedule()           → fetch the manager-published schedule from
//                                Supabase, cache locally. No TBA key needed.
//
// In both flows the cached copy in IndexedDB is what every read-side helper
// (nextUnscoutedMatch, verifyMatchTeam, etc.) consults. Network calls happen
// at fetch/publish/pull time only.
//
// TBA docs: https://www.thebluealliance.com/apidocs/v3
// Free TBA keys: https://www.thebluealliance.com/account

import { getSetting, setSetting } from './db.js';
import { createSupabaseClient, deriveSessionId } from './supabase.js';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

// ─── TBA fetch + local cache ───────────────────────────────────────────────

/**
 * Fetch the full match list for an event from TBA and cache it locally.
 * Manager-only — scouts use pullSchedule() instead.
 *
 * @param {string} eventCode  e.g. "2026cala"
 * @param {string} apiKey     TBA read API key
 * @returns {Promise<TBAMatch[]>}
 */
export async function fetchAndCacheSchedule(eventCode, apiKey) {
	if (!apiKey || !apiKey.trim()) {
		throw new Error(
			'No TBA API key set. Get a free key at thebluealliance.com/account and add it in Schedule → TBA API key.'
		);
	}
	if (!eventCode || !eventCode.trim()) {
		throw new Error('No event code set. Add one in Settings → Event code.');
	}
	const code = eventCode.trim().toLowerCase();
	const url = `${TBA_BASE}/event/${code}/matches/simple`;
	let resp;
	try {
		resp = await fetch(url, { headers: { 'X-TBA-Auth-Key': apiKey.trim() } });
	} catch (_e) {
		throw new Error('Could not reach The Blue Alliance. Check your network connection.');
	}
	if (resp.status === 401) {
		throw new Error('TBA API key not accepted (401). Check Schedule → TBA API key.');
	}
	if (resp.status === 404) {
		throw new Error(`Event "${code}" not found on The Blue Alliance. Check the event code.`);
	}
	if (!resp.ok) {
		throw new Error(`TBA request failed (${resp.status}).`);
	}
	const matches = await resp.json();
	if (!Array.isArray(matches)) {
		throw new Error('Unexpected response from TBA — expected a match array.');
	}
	await cacheSchedule(code, matches);
	return matches;
}

/** Write the schedule to IndexedDB. Used by manager fetch and scout pull. */
async function cacheSchedule(eventCode, matches, fetchedAt, fetchedBy) {
	await setSetting(`tba-schedule:${eventCode}`, {
		cachedAt: fetchedAt ?? new Date().toISOString(),
		fetchedBy: fetchedBy ?? null,
		matches
	});
}

/**
 * Read the cached schedule for an event.
 * Returns `{ cachedAt, matches }` or `null` if nothing cached.
 *
 * @param {string} eventCode
 * @returns {Promise<{cachedAt: string, matches: TBAMatch[]}|null>}
 */
export async function getCachedSchedule(eventCode) {
	if (!eventCode) return null;
	const stored = await getSetting(`tba-schedule:${eventCode.trim().toLowerCase()}`);
	if (!stored || !Array.isArray(stored.matches)) return null;
	return stored;
}

/**
 * Delete the cached schedule for an event.
 *
 * @param {string} eventCode
 */
export async function clearScheduleCache(eventCode) {
	if (!eventCode) return;
	await setSetting(`tba-schedule:${eventCode.trim().toLowerCase()}`, null);
}

// ─── Supabase publish + pull ───────────────────────────────────────────────

/**
 * Manager-only: upload the fetched schedule to Supabase so other devices in
 * the event can pull it without needing their own TBA key. Requires a valid
 * manager token (the event's passphrase hash). On a first-time event there
 * is no passphrase yet and the upload is unauthenticated (bootstrap allowed
 * by the has_manager_token() helper).
 *
 * @param {string} eventCode
 * @param {TBAMatch[]} matches
 * @param {object} opts
 * @param {string} [opts.managerToken]  hex SHA-256 hash; required after
 *                                       passphrase has been set for the event
 * @param {string} [opts.fetchedBy]     display name to stamp on the row
 * @returns {Promise<{ fetchedAt: string }>}
 */
export async function publishSchedule(eventCode, matches, opts = {}) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event code.');
	if (!Array.isArray(matches)) throw new Error('publishSchedule requires a match array.');
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id from event code.');
	const client = createSupabaseClient(sid, { managerToken: opts.managerToken });
	const fetchedAt = new Date().toISOString();
	const row = {
		session_id: sid,
		event_code: code,
		matches,
		fetched_at: fetchedAt,
		fetched_by: opts.fetchedBy ?? null
	};
	// Upsert: first publish inserts; subsequent publishes replace the row.
	const { error } = await client
		.from('schedules')
		.upsert(row, { onConflict: 'session_id' });
	if (error) throw mapSupabaseError(error, 'publish schedule');
	// Refresh the local cache too — saves a round-trip on the next form load.
	await cacheSchedule(code, matches, fetchedAt, opts.fetchedBy ?? null);
	return { fetchedAt };
}

/**
 * Scout (or anyone): pull the published schedule for an event from Supabase
 * and cache it locally. Returns `{ matches, fetchedAt }` on success, or null
 * if no schedule has been published yet.
 *
 * No manager token needed for reads.
 *
 * @param {string} eventCode
 * @returns {Promise<{ matches: TBAMatch[], fetchedAt: string }|null>}
 */
export async function pullSchedule(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return null;
	const sid = await deriveSessionId(code);
	if (!sid) return null;
	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('schedules')
		.select('matches, fetched_at, fetched_by')
		.eq('session_id', sid)
		.maybeSingle();
	if (error) throw mapSupabaseError(error, 'pull schedule');
	if (!data) return null;
	const matches = Array.isArray(data.matches) ? data.matches : [];
	await cacheSchedule(code, matches, data.fetched_at, data.fetched_by ?? null);
	return { matches, fetchedAt: data.fetched_at, fetchedBy: data.fetched_by ?? null };
}

/**
 * If the published schedule on Supabase is newer than what's in our local
 * cache, pull it down and replace. Cheap to call on every sync tick — the
 * server returns one tiny row and we short-circuit if `fetched_at` hasn't
 * moved.
 *
 * @param {string} eventCode
 * @returns {Promise<boolean>}  true if the cache was refreshed
 */
export async function pullScheduleIfStale(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return false;
	const sid = await deriveSessionId(code);
	if (!sid) return false;
	const client = createSupabaseClient(sid);
	// First just ask for the timestamp.
	const { data: head, error: headErr } = await client
		.from('schedules')
		.select('fetched_at')
		.eq('session_id', sid)
		.maybeSingle();
	if (headErr) throw mapSupabaseError(headErr, 'check schedule');
	if (!head) return false;
	const cached = await getCachedSchedule(code);
	if (cached && cached.cachedAt && cached.cachedAt >= head.fetched_at) return false;
	const pulled = await pullSchedule(code);
	return Boolean(pulled);
}

function mapSupabaseError(err, action) {
	const msg = err.message || String(err);
	if (/row-level security/i.test(msg) || err.code === '42501') {
		return new Error(
			`Permission denied — couldn't ${action}. Check the manager passphrase, or ask whoever set the schedule up.`
		);
	}
	return new Error(`Couldn't ${action}: ${msg}`);
}

// ─── schedule reading helpers (consumed by entry form) ─────────────────────

/**
 * Return only the qualification matches from a match array, sorted by
 * match_number ascending.
 *
 * @param {TBAMatch[]} matches
 * @returns {TBAMatch[]}
 */
export function qualMatches(matches) {
	return matches
		.filter((m) => m.comp_level === 'qm')
		.sort((a, b) => a.match_number - b.match_number);
}

/**
 * Derive the alliance color ("red"|"blue") of a team in a given match, or
 * null if that team isn't in the match.
 *
 * @param {TBAMatch} match
 * @param {number} teamNumber
 * @returns {"red"|"blue"|null}
 */
export function allianceForTeamInMatch(match, teamNumber) {
	if (!match || !teamNumber) return null;
	const key = `frc${teamNumber}`;
	if ((match.alliances?.red?.team_keys ?? []).includes(key)) return 'red';
	if ((match.alliances?.blue?.team_keys ?? []).includes(key)) return 'blue';
	return null;
}

/**
 * All teams in the match as an object {red: [n,n,n], blue: [n,n,n]}.
 * Missing slots become null.
 *
 * @param {TBAMatch} match
 */
export function teamsInMatch(match) {
	const parse = (key) => {
		if (!key) return null;
		const n = parseInt(String(key).replace(/^frc/, ''), 10);
		return Number.isFinite(n) ? n : null;
	};
	return {
		red: (match?.alliances?.red?.team_keys ?? []).map(parse),
		blue: (match?.alliances?.blue?.team_keys ?? []).map(parse)
	};
}

/**
 * For a given list of qual matches and a list of teams I'm watching, find
 * the next match where any of my teams are playing and I haven't already
 * recorded a (matchNumber, teamNumber) entry for that team.
 *
 * The third argument may be either a plain `number[]` (the legacy
 * "watch-these-teams-everywhere" model) or an options object that supplies
 * `assignedTeams` plus `overrides` and `scoutName` for per-match override
 * resolution. Overrides win for any (match, scout) they specify; otherwise
 * the base team list applies.
 *
 * @param {TBAMatch[]} qmList
 * @param {object[]} entries
 * @param {number[]|{assignedTeams: number[], overrides?: any[], scoutName?: string}} opts
 * @returns {{match: TBAMatch, teams: number[]}|null}
 */
export function nextUnscoutedMatch(qmList, entries, opts) {
	const { assignedTeams, overrides, scoutName } = normalizeOpts(opts);
	if (!qmList.length) return null;
	const done = new Set(entries.map((e) => `${e.matchNumber}:${e.teamNumber}`));
	const scoutLc = (scoutName ?? '').trim().toLowerCase();
	const hasOverrides = scoutLc && Array.isArray(overrides) && overrides.length > 0;
	for (const match of qmList) {
		const myTeams = resolveMyTeams(match, scoutLc, assignedTeams, overrides, hasOverrides);
		const pending = myTeams.filter((t) => !done.has(`${match.match_number}:${t}`));
		if (pending.length > 0) return { match, teams: pending };
	}
	return null;
}

function normalizeOpts(opts) {
	if (Array.isArray(opts)) {
		return { assignedTeams: opts, overrides: [], scoutName: '' };
	}
	return {
		assignedTeams: opts?.assignedTeams ?? [],
		overrides: opts?.overrides ?? [],
		scoutName: opts?.scoutName ?? ''
	};
}

function resolveMyTeams(match, scoutLc, baseAssignments, overrides, hasOverrides) {
	const playing = teamsInMatchSet(match);
	if (hasOverrides) {
		const overrideTeams = overrides
			.filter(
				(o) =>
					o.match_number === match.match_number &&
					String(o.scout_name ?? '').trim().toLowerCase() === scoutLc
			)
			.map((o) => Number(o.team_number))
			.filter((t) => Number.isFinite(t) && playing.has(t));
		if (overrideTeams.length > 0) {
			return [...new Set(overrideTeams)].sort((a, b) => a - b);
		}
	}
	return (baseAssignments ?? [])
		.filter((t) => Number.isFinite(t) && playing.has(t))
		.sort((a, b) => a - b);
}

function teamsInMatchSet(match) {
	const out = new Set();
	for (const arr of [match?.alliances?.red?.team_keys, match?.alliances?.blue?.team_keys]) {
		for (const k of arr ?? []) {
			const n = parseInt(String(k).replace(/^frc/, ''), 10);
			if (Number.isFinite(n)) out.add(n);
		}
	}
	return out;
}

/**
 * Verify whether an entered (matchNumber, teamNumber) combination is
 * consistent with the schedule.
 *
 * Returns:
 *   { ok: true }                 — team really is in that match
 *   { ok: false, reason: ... }   — team is NOT in that match per the schedule
 *   { ok: null }                 — can't verify (no schedule, match unknown)
 *
 * @param {TBAMatch[]} qmList
 * @param {number} matchNumber
 * @param {number} teamNumber
 */
export function verifyMatchTeam(qmList, matchNumber, teamNumber) {
	if (!qmList.length || !matchNumber || !teamNumber) return { ok: null };
	const match = qmList.find((m) => m.match_number === matchNumber);
	if (!match) return { ok: null }; // playoff or unlisted
	const playing = teamsInMatchSet(match);
	if (playing.has(teamNumber)) return { ok: true };
	return {
		ok: false,
		reason: `Schedule says team ${teamNumber} isn't in Q${matchNumber}.`
	};
}
