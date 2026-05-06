// The Blue Alliance (TBA) API v3 integration.
//
// Fetches qual match schedules and caches them in IndexedDB so the entry form
// can pre-fill match number, team number, and alliance color for a scout who
// has declared their position ("red 1", "blue 2", etc.).
//
// API docs: https://www.thebluealliance.com/apidocs/v3
// Free API keys: https://www.thebluealliance.com/account
//
// All network calls go through fetchAndCacheSchedule(). Everything else is
// pure computation on the cached data — no network required at match time.

import { getSetting, setSetting } from './db.js';

const TBA_BASE = 'https://www.thebluealliance.com/api/v3';

// ─── fetch + cache ─────────────────────────────────────────────────────────

/**
 * Fetch the full match list for an event from TBA and cache it locally.
 * On success, returns the raw TBA match array.
 * On failure, throws a user-readable Error.
 *
 * @param {string} eventCode  e.g. "2026cala"
 * @param {string} apiKey     TBA read API key
 * @returns {Promise<TBAMatch[]>}
 */
export async function fetchAndCacheSchedule(eventCode, apiKey) {
	if (!apiKey || !apiKey.trim()) {
		throw new Error(
			'No TBA API key set. Get a free key at thebluealliance.com/account and add it in Settings → TBA API key.'
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
		throw new Error('TBA API key not accepted (401). Check Settings → TBA API key.');
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
	await setSetting(`tba-schedule:${code}`, {
		cachedAt: new Date().toISOString(),
		matches
	});
	return matches;
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

// ─── schedule helpers ───────────────────────────────────────────────────────

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
 * Given a match and a scout-position string ("red 1", "blue 3", etc.),
 * return the integer team number the scout is assigned to watch.
 * Returns null if the position is invalid or not found in the match.
 *
 * TBA stores teams as "frc254" strings; we strip the prefix.
 *
 * @param {TBAMatch} match
 * @param {string} scoutPosition  e.g. "red 2"
 * @returns {number|null}
 */
export function teamForPosition(match, scoutPosition) {
	if (!match || !scoutPosition) return null;
	const parts = scoutPosition.toLowerCase().trim().split(/\s+/);
	if (parts.length < 2) return null;
	const color = parts[0]; // "red" | "blue"
	const slot = parseInt(parts[1], 10) - 1; // convert "1"→0, "2"→1, "3"→2
	if (!['red', 'blue'].includes(color) || isNaN(slot) || slot < 0 || slot > 2) return null;
	const teamKey = match.alliances?.[color]?.team_keys?.[slot];
	if (!teamKey) return null;
	const n = parseInt(teamKey.replace(/^frc/, ''), 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Derive the alliance color ("red" | "blue") from a scout-position string.
 * Returns null for invalid input.
 *
 * @param {string} scoutPosition
 * @returns {"red"|"blue"|null}
 */
export function allianceFromPosition(scoutPosition) {
	if (!scoutPosition) return null;
	const color = scoutPosition.toLowerCase().trim().split(/\s+/)[0];
	return color === 'red' || color === 'blue' ? color : null;
}

/**
 * Find the first qual match the scout hasn't submitted an entry for yet.
 *
 * "Done" means there is an entry with the correct matchNumber AND teamNumber
 * for the scout's assigned position. We don't check scoutName so a scout can
 * pick up a missed match and have it count.
 *
 * @param {TBAMatch[]} qmList      output of qualMatches()
 * @param {object[]}  entries      all local entries (from listEntries())
 * @param {string}    scoutPosition e.g. "blue 2"
 * @returns {TBAMatch|null}
 */
export function nextUnscoutedMatch(qmList, entries, scoutPosition) {
	if (!scoutPosition || !qmList.length) return null;
	// Build a Set of "matchNumber:teamNumber" pairs already recorded.
	const done = new Set(entries.map((e) => `${e.matchNumber}:${e.teamNumber}`));
	for (const match of qmList) {
		const team = teamForPosition(match, scoutPosition);
		if (!team) continue;
		if (!done.has(`${match.match_number}:${team}`)) return match;
	}
	return null; // all matches covered
}

/**
 * Verify whether a match-number + team-number pair is consistent with the
 * schedule for a given scout position.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, reason: string }
 *   { ok: null }  — schedule doesn't have this match (can't verify)
 *
 * @param {TBAMatch[]} qmList
 * @param {number}     matchNumber
 * @param {number}     teamNumber
 * @param {string}     scoutPosition
 */
export function verifyMatchTeam(qmList, matchNumber, teamNumber, scoutPosition) {
	if (!qmList.length || !scoutPosition || !matchNumber || !teamNumber) return { ok: null };
	const match = qmList.find((m) => m.match_number === matchNumber);
	if (!match) return { ok: null }; // match not in schedule (playoff, or just not listed)
	const expected = teamForPosition(match, scoutPosition);
	if (expected === null) return { ok: null };
	if (expected === teamNumber) return { ok: true };
	return {
		ok: false,
		reason: `Schedule says ${scoutPosition} in Q${matchNumber} is team ${expected}, not ${teamNumber}.`
	};
}
