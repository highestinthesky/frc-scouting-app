// Tests for coverage, and specifically for what a published schedule contains.
//   node src/lib/coverage.test.mjs
//
// A published schedule is the RAW TBA payload. It has playoffs in it — the one
// on production is 68 quals, 13 semifinals and 2 finals — and this app has only
// ever modelled quals. Every consumer of the cache is expected to call
// qualMatches() on the way in.
//
// The Studio coverage page did not, and the interesting part is that the
// inflated denominator was the smaller half of the damage. `cellKey()` is
// (match_number, team), and playoff numbering RESTARTS at 1 within each set, so
// thirteen semifinals and a final all carry match_number 1 and collide with
// qual 1. Three entries were reported as five robot-matches recorded.
//
// A numerator larger than the evidence is the failure this whole file exists to
// prevent, so it is asserted as an invariant and not just as a fixed number.

import { buildEntryIndex, scheduleRollup, matchCoverage, cellKey } from './coverage.js';
import { qualMatches } from './tba.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

/**
 * A TBA-shaped match.
 *
 * `key` follows TBA's real format, `<event>_<level><set>m<match>` — verified
 * against production, which holds `2026nyny_sf10m1`, `2026nyny_f1m2` and so on.
 * The SET number is what makes it unique where match_number is not, and that is
 * the whole reason it is a safe key for a keyed {#each}.
 */
const m = (comp_level, set_number, match_number, red, blue) => ({
	comp_level,
	set_number,
	match_number,
	key: comp_level === 'qm' ? `2026x_qm${match_number}` : `2026x_${comp_level}${set_number}m${match_number}`,
	alliances: {
		red: { team_keys: red.map((t) => `frc${t}`) },
		blue: { team_keys: blue.map((t) => `frc${t}`) }
	}
});

// The shape production actually stores: quals, then playoffs whose numbering
// starts over. Both "match 1"s contain team 3204, which is what makes the
// collision land rather than merely exist.
const RAW = [
	m('qm', 1, 1, [3204, 7036, 4383], [111, 222, 333]),
	m('qm', 1, 2, [444, 555, 666], [777, 888, 999]),
	// Two semifinal SETS, each with its own match 1 — production has thirteen.
	m('sf', 1, 1, [3204, 7036, 4383], [111, 222, 333]),
	m('sf', 2, 1, [3204, 7036, 4383], [111, 222, 333]),
	m('f', 1, 1, [3204, 7036, 4383], [111, 222, 333])
];

// Three entries, all for qual 1 — the same three robots, recorded once each.
const ENTRIES = [3204, 7036, 4383].map((teamNumber) => ({
	eventCode: '2026x',
	matchNumber: 1,
	teamNumber,
	scoutName: 'Ada',
	createdAt: '2026-08-20T20:00:00Z'
}));

{
	const idx = buildEntryIndex(ENTRIES, '2026x');
	const quals = qualMatches(RAW);

	ok('qualMatches drops every playoff match', quals.length === 2, `kept ${quals.length}`);
	ok(
		'and keeps the quals in order',
		quals.map((x) => x.match_number).join(',') === '1,2'
	);

	const filtered = scheduleRollup(quals, idx);
	const raw = scheduleRollup(RAW, idx);

	// The invariant. Three entries can never be more than three robot-matches,
	// whatever the schedule contains.
	ok(
		'a robot-match is never counted twice',
		filtered.teamMatchesScouted === ENTRIES.length,
		`${filtered.teamMatchesScouted} counted from ${ENTRIES.length} entries`
	);
	ok(
		'the denominator is quals only',
		filtered.teamMatchesTotal === 2 * 6,
		`${filtered.teamMatchesTotal}`
	);
	ok('and the match count agrees', filtered.matchesTotal === 2, `${filtered.matchesTotal}`);

	// The bug itself, stated so this file explains why the filter is mandatory
	// rather than merely conventional. Unfiltered, the SAME three entries are
	// counted once per playoff match that reuses match_number 1.
	ok(
		'unfiltered, the collision over-counts — which is why the filter is not optional',
		raw.teamMatchesScouted > ENTRIES.length,
		`unfiltered counted ${raw.teamMatchesScouted}, expected to exceed ${ENTRIES.length}`
	);

	// And the gaps list: one row, not one per playoff match wearing "Q1".
	const gaps = quals
		.map((x) => ({ match: x, cov: matchCoverage(x, idx) }))
		.filter(({ cov }) => cov.scoutedTeams > 0 && !cov.complete);
	ok('one gap row for the one started match', gaps.length === 1, `${gaps.length} rows`);

	// The duplicate key is what actually took the page down, so it is asserted
	// as itself rather than only implied by the row count.
	//
	// The Gaps table is a KEYED {#each}. Svelte throws `each_key_duplicate` on a
	// repeated key, which aborts the render — and an aborted render leaves the
	// DOM showing whatever it painted last, which on this page is the "Loading…"
	// paragraph. That is how a schedule containing thirteen semifinals numbered 1
	// froze coverage on a spinner with the network working perfectly.
	const rawGaps = RAW.map((x) => ({ match: x, cov: matchCoverage(x, idx) }))
		.filter(({ cov }) => cov.scoutedTeams > 0 && !cov.complete);
	const keysOf = (rows, pick) => rows.map(({ match }) => pick(match));
	const distinct = (xs) => new Set(xs).size === xs.length;

	ok(
		'filtered, match_number alone is a usable key',
		distinct(keysOf(gaps, (x) => x.match_number))
	);
	ok(
		'unfiltered it is NOT — this is the each_key_duplicate that froze the page',
		!distinct(keysOf(rawGaps, (x) => x.match_number)),
		`keys: ${keysOf(rawGaps, (x) => x.match_number).join(',')}`
	);
	ok(
		"TBA's own match key stays unique either way",
		distinct(keysOf(rawGaps, (x) => x.key)),
		`keys: ${keysOf(rawGaps, (x) => x.key).join(',')}`
	);
	ok(
		'and it reports 3 of 6 robots',
		gaps[0]?.cov.scoutedTeams === 3 && gaps[0]?.cov.totalTeams === 6,
		`${gaps[0]?.cov.scoutedTeams}/${gaps[0]?.cov.totalTeams}`
	);
}

{
	// The mechanism, asserted directly: the key carries no competition level, so
	// a qual and a semifinal with the same number are one cell. That is fine —
	// it is why the filter belongs at the consumer — but it must not be
	// rediscovered by someone reading a wrong number on a page.
	ok(
		'cellKey does not distinguish a qual from a playoff',
		cellKey(1, 3204) === cellKey(1, 3204) && !String(cellKey(1, 3204)).includes('qm')
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
