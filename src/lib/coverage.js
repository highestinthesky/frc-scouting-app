// Coverage = "which (match, team) cells have actually been scouted yet?"
//
// This is the bridge between the scheduling side (the published TBA schedule +
// assignments) and the scouting side (the entries scouts record). It's pure,
// derived state — no I/O, no Supabase — so the manager schedule page, the home
// page, and the manager analytics view can all import the same logic instead
// of each re-deriving "is this scouted?" three slightly different ways.
//
// A (matchNumber, teamNumber) cell is **submitted** iff at least one entry
// exists for it. Deliberately:
//   - No author gate: two scouts covering the same team both count.
//   - No quality gate: a saved-but-sparse entry still counts as submitted.
// (See IMPROVEMENTS.md §1B for the rationale.)

import { teamsInMatch } from './tba.js';

/** Stable key for a (match, team) cell. */
export function cellKey(matchNumber, teamNumber) {
	return `${matchNumber}:${teamNumber}`;
}

/**
 * Index every entry for one event by (match, team).
 *
 * @param {Array<{eventCode, matchNumber, teamNumber, scoutName, createdAt}>} entries
 * @param {string} eventCode  only entries for this event are counted
 * @returns {Map<string, {count: number, lastAt: string|null, scouts: Set<string>}>}
 */
export function buildEntryIndex(entries, eventCode) {
	const idx = new Map();
	if (!Array.isArray(entries)) return idx;
	const code = (eventCode ?? '').trim();
	for (const e of entries) {
		if (code && e.eventCode !== code) continue;
		const team = Number(e.teamNumber);
		const match = Number(e.matchNumber);
		if (!Number.isFinite(team) || !Number.isFinite(match)) continue;
		const k = cellKey(match, team);
		const cur = idx.get(k) ?? { count: 0, lastAt: null, scouts: new Set() };
		cur.count += 1;
		if (!cur.lastAt || (e.createdAt && e.createdAt > cur.lastAt)) cur.lastAt = e.createdAt ?? cur.lastAt;
		const name = String(e.scoutName ?? '').trim();
		if (name) cur.scouts.add(name);
		idx.set(k, cur);
	}
	return idx;
}

/**
 * Status of a single (match, team) cell.
 *
 * @param {number} matchNumber
 * @param {number} teamNumber
 * @param {Map} entryIndex          from buildEntryIndex()
 * @param {boolean} [isAssigned]    is a scout responsible for this cell?
 * @returns {{status: 'submitted'|'assigned'|'uncovered', count: number,
 *           scouts: string[], lastAt: string|null}}
 */
export function teamStatus(matchNumber, teamNumber, entryIndex, isAssigned = false) {
	const hit = entryIndex?.get(cellKey(matchNumber, teamNumber));
	if (hit) {
		return { status: 'submitted', count: hit.count, scouts: [...hit.scouts], lastAt: hit.lastAt };
	}
	return { status: isAssigned ? 'assigned' : 'uncovered', count: 0, scouts: [], lastAt: null };
}

/**
 * Coverage summary for one match: how many of its (up to 6) teams are scouted.
 *
 * @param {object} match            a TBA qual-match object
 * @param {Map} entryIndex
 * @returns {{teams: Array<{team:number,color:'red'|'blue',submitted:boolean,count:number}>,
 *           scoutedTeams: number, totalTeams: number, complete: boolean}}
 */
export function matchCoverage(match, entryIndex) {
	const { red, blue } = teamsInMatch(match);
	const teams = [];
	const push = (arr, color) => {
		for (const t of arr) {
			if (!Number.isFinite(t)) continue;
			const hit = entryIndex?.get(cellKey(match.match_number, t));
			teams.push({ team: t, color, submitted: Boolean(hit), count: hit?.count ?? 0 });
		}
	};
	push(red, 'red');
	push(blue, 'blue');
	const scoutedTeams = teams.filter((t) => t.submitted).length;
	const totalTeams = teams.length;
	return {
		teams,
		scoutedTeams,
		totalTeams,
		complete: totalTeams > 0 && scoutedTeams === totalTeams
	};
}

/**
 * Event-wide roll-up across a list of qual matches.
 *
 * @param {object[]} qmList
 * @param {Map} entryIndex
 * @returns {{teamMatchesScouted:number, teamMatchesTotal:number,
 *           matchesComplete:number, matchesTotal:number,
 *           matchesStarted:number}}
 */
export function scheduleRollup(qmList, entryIndex) {
	let teamMatchesScouted = 0;
	let teamMatchesTotal = 0;
	let matchesComplete = 0;
	let matchesStarted = 0;
	for (const m of qmList ?? []) {
		const c = matchCoverage(m, entryIndex);
		teamMatchesScouted += c.scoutedTeams;
		teamMatchesTotal += c.totalTeams;
		if (c.complete) matchesComplete += 1;
		if (c.scoutedTeams > 0) matchesStarted += 1;
	}
	return {
		teamMatchesScouted,
		teamMatchesTotal,
		matchesComplete,
		matchesTotal: (qmList ?? []).length,
		matchesStarted
	};
}

/**
 * Pick a colour token for a coverage chip given how complete a match is.
 * Returns one of: 'full' | 'partial' | 'none'.
 */
export function coverageLevel(scoutedTeams, totalTeams) {
	if (totalTeams === 0) return 'none';
	if (scoutedTeams >= totalTeams) return 'full';
	if (scoutedTeams > 0) return 'partial';
	return 'none';
}
