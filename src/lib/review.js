// What Review lists: the next match, and the ones already played.
//
// Run's match list is forward-looking — what is next, what is uncovered,
// ascending. Review's is the history: what happened, most recent first, each
// row a way into the replay. Same data, a different question, which is why
// ROADMAP keeps them as two lists (*Two match lists, deliberately*).
//
// Pure, so the rule for "played" lives in one place and has a test.

import { lastPlayedIndex } from './coverage.js';
export { wasPlayed } from './coverage.js';

/**
 * Split the quals at the last one played.
 *
 * Everything up to the last played match counts as played, recorded or not:
 * one match nobody scouted in the middle of the morning is a gap in the
 * history, not a match still to come. The next match is the one after it.
 *
 * @param {object[]} qmList  quals only, in order
 * @param {Map} entryIndex
 * @returns {{ next: object|null, recent: object[] }}  recent is most recent first
 */
export function reviewSplit(qmList, entryIndex) {
	const list = qmList ?? [];
	const last = lastPlayedIndex(list, entryIndex);
	return {
		next: list[last + 1] ?? null,
		recent: list.slice(0, last + 1).reverse()
	};
}

/**
 * Which teams in each match have an auto recording, by match number.
 *
 * @param {Array<object>} entries  this event's entries only
 * @returns {Map<number, Set<number>>}
 */
export function trackedByMatch(entries) {
	const out = new Map();
	for (const e of entries ?? []) {
		if (!e?.observations?.autoTrack) continue;
		const m = Number(e.matchNumber);
		const t = Number(e.teamNumber);
		if (!Number.isFinite(m) || !Number.isFinite(t)) continue;
		const set = out.get(m) ?? new Set();
		set.add(t);
		out.set(m, set);
	}
	return out;
}
