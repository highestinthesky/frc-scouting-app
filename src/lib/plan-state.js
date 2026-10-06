// What the planning pages derive from assignments, overrides and entries.
//
// These lived inline in /studio/schedule, a 1075-line page holding seven
// panels, and they are the reason it could not be pulled apart: the conflict
// check, the match modal's "who is watching" and the scout roster all read the
// assignment editor's rows. Split into Plan and Run, two pages need the same
// answers, so the answers live here — pure, and tested in plain node.
//
// The shape everything here takes is the editor's: `{ scout_name, teamsText }`,
// one row per scout, teams as the comma-separated text a manager types. Saved
// assignments are converted to it with `editorRows()`, so the Run pages and the
// Assignments editor compute conflicts with one function — the editor over its
// unsaved draft, Run over what is saved.

import { scoutRef, rowScout, sameScout } from './scout-identity.js';

/** @typedef {{ scout_name: string, teamsText: string }} EditorRow */

/**
 * Parse a "1234, 5678" editor cell into team numbers.
 *
 * @param {unknown} text
 * @returns {number[]}
 */
export function parseTeams(text) {
	return String(text ?? '')
		.split(/[\s,]+/)
		.map((x) => Number(x.replace(/[^0-9]/g, '')))
		.filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Saved assignment rows (one per scout × team) as editor rows (one per scout),
 * teams ascending, scouts alphabetical.
 *
 * @param {Array<{ scout_name: string, team_number: number }>} rows
 * @returns {EditorRow[]}
 */
export function editorRows(rows) {
	const byScout = new Map();
	for (const r of rows ?? []) {
		const list = byScout.get(r.scout_name) ?? [];
		list.push(Number(r.team_number));
		byScout.set(r.scout_name, list);
	}
	return [...byScout.entries()]
		.map(([scout_name, teams]) => ({
			scout_name,
			teamsText: teams.sort((a, b) => a - b).join(', ')
		}))
		.sort((a, b) => a.scout_name.localeCompare(b.scout_name));
}

/**
 * Distinct scout names in the editor rows, for the reminder target picker.
 *
 * @param {EditorRow[]} rows
 * @returns {string[]}
 */
export function scoutNames(rows) {
	const names = new Set();
	for (const r of rows ?? []) {
		const n = String(r.scout_name ?? '').trim();
		if (n) names.add(n);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}

/** Teams playing in a TBA match, as numbers. */
function playingIn(match) {
	const playing = new Set();
	for (const arr of [match?.alliances?.red?.team_keys ?? [], match?.alliances?.blue?.team_keys ?? []]) {
		for (const k of arr) {
			const n = parseInt(String(k).replace(/^frc/, ''), 10);
			if (Number.isFinite(n)) playing.add(n);
		}
	}
	return playing;
}

/**
 * Scouts watching two or more robots in one match.
 *
 * An override for (match, scout) REPLACES that scout's base teams for the
 * match. Pass the staged overrides from an unsaved auto-assign run when there
 * are some — otherwise auto-assign reports full coverage while this still lists
 * the clashes those very overrides resolve.
 *
 * @param {Array<object>} qmList
 * @param {EditorRow[]} rows
 * @param {Array<{ match_number: number, scout_name: string, team_number: number }>} overrides
 * @returns {Array<{ match: number, scout: string, teams: number[], hasOverride: boolean }>}
 */
export function findConflicts(qmList, rows, overrides) {
	if (!qmList?.length || !rows?.length) return [];
	const baseByScout = new Map();
	for (const r of rows) {
		const name = String(r.scout_name ?? '').trim();
		if (!name) continue;
		const teams = parseTeams(r.teamsText);
		if (teams.length === 0) continue;
		const prev = baseByScout.get(name) ?? new Set();
		for (const t of teams) prev.add(t);
		baseByScout.set(name, prev);
	}
	const overrideKey = (m, s) => `${m}:${String(s ?? '').trim().toLowerCase()}`;
	const overrideMap = new Map();
	for (const o of overrides ?? []) {
		const k = overrideKey(o.match_number, o.scout_name);
		const set = overrideMap.get(k) ?? new Set();
		set.add(Number(o.team_number));
		overrideMap.set(k, set);
	}
	const conflicts = [];
	for (const m of qmList) {
		const playing = playingIn(m);
		for (const [scout, baseSet] of baseByScout) {
			const ov = overrideMap.get(overrideKey(m.match_number, scout));
			const effective =
				ov && ov.size > 0
					? [...ov].filter((t) => playing.has(t))
					: [...baseSet].filter((t) => playing.has(t));
			if (effective.length >= 2) {
				conflicts.push({
					match: m.match_number,
					scout,
					teams: effective.sort((a, b) => a - b),
					hasOverride: Boolean(ov && ov.size > 0)
				});
			}
		}
	}
	return conflicts;
}

/**
 * For one match, each of its six teams with the scouts effectively watching
 * it: an override for (match, scout) wins, otherwise the scout's base teams.
 *
 * @param {object|null} match
 * @param {EditorRow[]} rows
 * @param {Array<object>} overrides  every override for the event
 * @returns {Array<{ color: 'red'|'blue', team: number, watchers: Array<{ scout: string, viaOverride: boolean }> }>}
 */
export function matchWatchers(match, rows, overrides) {
	if (!match) return [];
	const overrideRows = (overrides ?? []).filter((o) => o.match_number === match.match_number);
	const overrideByScout = new Map();
	for (const o of overrideRows) {
		const who = rowScout(o);
		const set = overrideByScout.get(who.key) ?? { displayName: who.label, teams: new Set() };
		set.teams.add(Number(o.team_number));
		overrideByScout.set(who.key, set);
	}
	const scoutTeams = new Map();
	for (const r of rows ?? []) {
		const name = String(r.scout_name ?? '').trim();
		if (!name) continue;
		const key = scoutRef(name).key;
		scoutTeams.set(
			name,
			overrideByScout.has(key) ? [...overrideByScout.get(key).teams] : parseTeams(r.teamsText)
		);
	}
	// A scout with an override but no base row still watches what it says.
	for (const { displayName, teams } of overrideByScout.values()) {
		if (!scoutTeams.has(displayName)) scoutTeams.set(displayName, [...teams]);
	}
	const out = [];
	for (const color of /** @type {const} */ (['red', 'blue'])) {
		for (const key of match.alliances?.[color]?.team_keys ?? []) {
			const t = Number(String(key).replace(/^frc/, ''));
			if (!Number.isFinite(t)) continue;
			const watchers = [];
			for (const [scout, teams] of scoutTeams) {
				if (teams.includes(t)) {
					watchers.push({
						scout,
						viaOverride: overrideByScout.has(scoutRef(scout).key)
					});
				}
			}
			out.push({ color, team: t, watchers });
		}
	}
	return out;
}

/**
 * Who is assigned and who is recording, grouped on the identity key rather
 * than the typed text — "Ning" and "ning" are one scout, and keying on the raw
 * string made a scout look unassigned while their entries piled up under a
 * second name. The label keeps whatever spelling arrived first.
 *
 * Pass only this event's entries. The schedule page passed every entry on the
 * device, so a scout's count included other weekends.
 *
 * @param {EditorRow[]} rows
 * @param {Array<object>} entries
 */
export function scoutRoster(rows, entries) {
	const map = new Map();
	const get = (ref) => {
		if (!map.has(ref.key)) {
			map.set(ref.key, { name: ref.label, assigned: false, recording: false, count: 0, lastEntry: null });
		}
		return map.get(ref.key);
	};
	for (const r of rows ?? []) {
		const ref = scoutRef(r.scout_name);
		if (!ref.key) continue;
		get(ref).assigned = true;
	}
	for (const e of entries ?? []) {
		const ref = rowScout(e);
		if (!ref.key) continue;
		const info = get(ref);
		info.recording = true;
		info.count += 1;
		if (!info.lastEntry || e.createdAt > info.lastEntry) info.lastEntry = e.createdAt;
	}
	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How many entries each person on the event has recorded here, fewest first —
 * the useful end of the list is the top, and a zero there usually means a phone
 * that has not synced rather than a scout who has not worked.
 *
 * Both sides go through scoutRef/rowScout. Coverage once passed a raw roster row
 * and a raw entry to sameScout(), which read `undefined` off both and matched
 * every scout to every entry — "everyone has 20", and the scout at zero, the one
 * number this exists to surface, could never appear.
 *
 * @param {Array<{profileId?: string, first_name?: string, last_name?: string, username?: string}>} roster
 *        event_scouts members, from eventRoster()
 * @param {Array<object>} entries  this event's entries only
 * @returns {Array<{ person: object, name: string, count: number }>}
 */
export function scoutCounts(roster, entries) {
	const out = (roster ?? []).map((person) => {
		// Not a display fallback like 'Unnamed': this string is a join key, and a
		// placeholder would match an entry recorded by someone who typed it.
		const typed = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.username || '';
		const ref = scoutRef(typed, person.profileId);
		let count = 0;
		for (const e of entries ?? []) if (sameScout(rowScout(e), ref)) count += 1;
		return { person, name: typed || 'Unnamed', count };
	});
	return out.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
}
