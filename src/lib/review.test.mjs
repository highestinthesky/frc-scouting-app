// Review's split between the next match and the history, and the per-match
// count of auto recordings.

import { buildEntryIndex, gapMatches } from './coverage.js';
import { wasPlayed, reviewSplit, trackedByMatch } from './review.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const match = (n, extra = {}) => ({
	match_number: n,
	key: `2026test_qm${n}`,
	alliances: {
		red: { team_keys: [1, 2, 3].map((t) => `frc${t + n * 10}`) },
		blue: { team_keys: [4, 5, 6].map((t) => `frc${t + n * 10}`) }
	},
	...extra
});
const entry = (m, t, extra = {}) => ({
	eventCode: '2026test',
	matchNumber: m,
	teamNumber: t,
	scoutName: 'Ada',
	createdAt: '2026-03-01T10:00:00Z',
	...extra
});

const qm = [1, 2, 3, 4, 5].map((n) => match(n));

// ── played ─────────────────────────────────────────────────────────────────
{
	const idx = buildEntryIndex([entry(2, 21)], '2026test');
	ok('a recorded match was played', wasPlayed(qm[1], idx));
	ok('an unrecorded match with no actual_time was not', !wasPlayed(qm[0], idx));
	ok('actual_time alone says played', wasPlayed(match(9, { actual_time: 1774000000 }), idx));
	ok(
		'a predicted time in the past is not "played" — schedules slip',
		!wasPlayed(match(9, { predicted_time: 1 }), idx)
	);
	const other = buildEntryIndex([{ ...entry(1, 11), eventCode: '2026else' }], '2026test');
	ok("another event's entry does not play this match", !wasPlayed(qm[0], other));
}

// ── the split ──────────────────────────────────────────────────────────────
{
	const none = reviewSplit(qm, new Map());
	ok('nothing played: next is the first match', none.next?.match_number === 1);
	ok('nothing played: no history', none.recent.length === 0);

	// Q3 recorded, Q2 not: Q2 is a gap in the history, not a match to come.
	const idx = buildEntryIndex([entry(1, 11), entry(3, 31)], '2026test');
	const s = reviewSplit(qm, idx);
	ok('next is the one after the last played', s.next?.match_number === 4);
	ok(
		'history is most recent first and keeps the unrecorded one',
		s.recent.map((m) => m.match_number).join(',') === '3,2,1'
	);

	const all = buildEntryIndex(qm.map((m) => entry(m.match_number, m.match_number * 10 + 1)), '2026test');
	const done = reviewSplit(qm, all);
	ok('every match played: there is no next', done.next === null);
	ok('and all five are history', done.recent.length === 5);
	ok('an empty schedule is empty', reviewSplit([], all).next === null);
}

// ── tracks ─────────────────────────────────────────────────────────────────
{
	const t = trackedByMatch([
		entry(1, 11, { observations: { autoTrack: { v: 1 } } }),
		entry(1, 11, { observations: { autoTrack: { v: 1 } } }),
		entry(1, 12, { observations: {} }),
		entry(1, 13, { observations: { autoTrack: { v: 1 } } })
	]);
	ok('two scouts tracking one robot is one robot', t.get(1)?.size === 2);
	ok('an entry with no track does not count', !t.get(1)?.has(12));
	ok('a match with no tracks has no set', !t.has(2));
}

// ── gaps ───────────────────────────────────────────────────────────────────
{
	const six = [11, 12, 13, 14, 15, 16].map((t) => entry(1, t));
	const idx = buildEntryIndex([...six, entry(2, 21), entry(2, 22)], '2026test');
	const g = gapMatches(qm, idx);
	ok('a started, unfinished match is a gap', g.some((x) => x.match.match_number === 2));
	ok('a complete match is not', !g.some((x) => x.match.match_number === 1));
	ok('an untouched match is not', !g.some((x) => x.match.match_number === 3));
	ok('the coverage rides along', g[0]?.cov.scoutedTeams === 2 && g[0]?.cov.totalTeams === 6);
}

console.log(fail === 0 ? `review: ${pass} passed` : `review: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
