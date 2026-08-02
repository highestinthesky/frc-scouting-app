// Tests for picklist ordering and merge.
//   node src/lib/picklist.test.mjs
//
// These cover the two things that decide whether the picklist survives
// alliance selection: that a reorder is one write, and that a stale device
// cannot erase somebody else's afternoon.

import {
	STEP,
	rankBetween,
	needsRebalance,
	rebalance,
	ordered,
	rankForMove,
	mergeRows,
	pendingRows
} from './picklist.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};
const eq = (name, actual, expected) =>
	ok(name, Object.is(actual, expected), `got ${actual}, expected ${expected}`);

const row = (teamNumber, rank, updatedAt = '2026-08-01T00:00:00Z', extra = {}) => ({
	teamNumber,
	rank,
	updatedAt,
	...extra
});

// ─── rankBetween ───────────────────────────────────────────────────────────
{
	eq('empty list gets the first rank', rankBetween(null, null), STEP);
	eq('prepending goes below the head', rankBetween(null, 1000), 1000 - STEP);
	eq('appending goes above the tail', rankBetween(1000, null), 1000 + STEP);
	eq('inserting takes the midpoint', rankBetween(1000, 2000), 1500);
	eq('midpoint of a tight gap still splits', rankBetween(1000, 1000.5), 1000.25);

	// Negative ranks are normal: prepending repeatedly walks below zero, and
	// nothing about the ordering cares.
	eq('ranks may go negative', rankBetween(null, -5000), -5000 - STEP);

	// Guarding against NaN/Infinity leaking in from a bad row.
	eq('NaN before is treated as absent', rankBetween(NaN, 2000), 2000 - STEP);
	eq('Infinity after is treated as absent', rankBetween(1000, Infinity), 1000 + STEP);
}

// ─── ordered ───────────────────────────────────────────────────────────────
{
	const rows = [row(1678, 3000), row(254, 1000), row(118, 2000)];
	ok(
		'sorts by rank',
		ordered(rows)
			.map((r) => r.teamNumber)
			.join() === '254,118,1678'
	);

	// Two managers can genuinely write the same rank without seeing each other.
	const tied = [row(1678, 1000), row(254, 1000), row(118, 500)];
	const a = ordered(tied).map((r) => r.teamNumber).join();
	const b = ordered([...tied].reverse()).map((r) => r.teamNumber).join();
	ok('ties break deterministically on team number', a === '118,254,1678', a);
	ok('...and the input order does not change the result', a === b, `${a} vs ${b}`);

	ok('does not mutate its input', rows[0].teamNumber === 1678);
}

// ─── rankForMove — the one-write property ──────────────────────────────────
{
	const list = [row(254, 1000), row(118, 2000), row(1678, 3000), row(2056, 4000)];

	// Move the last to the front.
	const r = rankForMove(list, 2056, 0);
	ok('moving to the front lands above the head', r !== null && r < 1000, String(r));
	const moved = ordered([...list.filter((x) => x.teamNumber !== 2056), row(2056, r)]);
	ok(
		'and the resulting order is correct',
		moved.map((x) => x.teamNumber).join() === '2056,254,118,1678',
		moved.map((x) => x.teamNumber).join()
	);
	ok(
		'exactly one row changed',
		list.filter((x) => {
			const after = moved.find((m) => m.teamNumber === x.teamNumber);
			return after.rank !== x.rank;
		}).length === 1
	);

	// Move the first to the end.
	const r2 = rankForMove(list, 254, 3);
	ok('moving to the end lands below the tail', r2 !== null && r2 > 4000, String(r2));

	// Into the middle.
	const r3 = rankForMove(list, 254, 2);
	ok('moving into the middle takes a midpoint', r3 === 3500, String(r3));

	eq('a move to its own index is a no-op', rankForMove(list, 118, 1), null);
	eq('an unknown team is a no-op', rankForMove(list, 9999, 0), null);
	ok('an index past the end clamps to append', rankForMove(list, 254, 99) > 4000);
	ok('a negative index clamps to prepend', rankForMove(list, 1678, -5) < 1000);

	// Single-item list: nothing can move anywhere.
	eq('a one-item list has no moves', rankForMove([row(254, 1000)], 254, 0), null);
}

// A move by one position, up and down, is the operation the arrows perform.
{
	let list = [row(254, 1000), row(118, 2000), row(1678, 3000)];
	// "Move 1678 up one" = index 1 in the list without it.
	const up = rankForMove(list, 1678, 1);
	list = ordered([...list.filter((x) => x.teamNumber !== 1678), row(1678, up)]);
	ok(
		'move up swaps with the neighbour above',
		list.map((x) => x.teamNumber).join() === '254,1678,118',
		list.map((x) => x.teamNumber).join()
	);

	const down = rankForMove(list, 254, 1);
	list = ordered([...list.filter((x) => x.teamNumber !== 254), row(254, down)]);
	ok(
		'move down swaps with the neighbour below',
		list.map((x) => x.teamNumber).join() === '1678,254,118',
		list.map((x) => x.teamNumber).join()
	);
}

// ─── rebalance ─────────────────────────────────────────────────────────────
{
	ok('a fresh list needs no rebalance', !needsRebalance([row(254, 1000), row(118, 2000)]));
	ok('an empty list needs no rebalance', !needsRebalance([]));

	// Drive a gap to nothing by halving it repeatedly — the pathological case
	// this whole mechanism has to survive.
	let lo = 1000;
	const hi = 2000;
	for (let i = 0; i < 60; i += 1) lo = rankBetween(lo, hi);
	ok('60 midpoints into one gap exhausts precision', needsRebalance([row(1, lo), row(2, hi)]));

	ok('a NaN rank forces a rebalance', needsRebalance([row(1, NaN), row(2, 2000)]));

	const messy = ordered([row(254, 0.0001), row(118, 0.0002), row(1678, 5)]);
	const clean = rebalance(messy);
	ok(
		'rebalance preserves order',
		clean.map((r) => r.teamNumber).join() === messy.map((r) => r.teamNumber).join()
	);
	ok(
		'rebalance produces clean multiples',
		clean.every((r, i) => r.rank === (i + 1) * STEP),
		clean.map((r) => r.rank).join()
	);
	ok('rebalance clears the condition', !needsRebalance(clean));
	ok('rebalance does not mutate its input', messy[0].rank === 0.0001);
}

// ─── mergeRows — the failure this design exists to prevent ─────────────────
{
	// The scenario from picklist.js: a phone holding the morning's list, and a
	// laptop that spent the afternoon ranking. Under a whole-document
	// last-write-wins, the phone's write erases the afternoon.
	const morning = [
		row(254, 1000, '2026-08-01T09:00:00Z'),
		row(118, 2000, '2026-08-01T09:00:00Z'),
		row(1678, 3000, '2026-08-01T09:00:00Z')
	];
	const afternoon = [
		row(254, 1000, '2026-08-01T14:00:00Z'),
		row(118, 500, '2026-08-01T14:00:00Z'), // reordered on the laptop
		row(1678, 3000, '2026-08-01T14:00:00Z'),
		row(2056, 4000, '2026-08-01T14:00:00Z') // added on the laptop
	];

	// The stale phone edits ONE team and syncs.
	const phoneEdit = [...morning];
	phoneEdit[0] = row(254, 250, '2026-08-01T14:05:00Z');

	const merged = ordered(mergeRows(phoneEdit, afternoon));
	ok(
		"the phone's own edit survives",
		merged.find((r) => r.teamNumber === 254).rank === 250
	);
	ok(
		"the laptop's reorder is NOT clobbered",
		merged.find((r) => r.teamNumber === 118).rank === 500
	);
	ok(
		"the laptop's added team is NOT lost",
		merged.some((r) => r.teamNumber === 2056)
	);
	ok(
		'and the final order is what both people would expect',
		merged.map((r) => r.teamNumber).join() === '254,118,1678,2056',
		merged.map((r) => r.teamNumber).join()
	);

	// Newer local wins over older remote.
	const m2 = mergeRows(
		[row(254, 111, '2026-08-01T15:00:00Z')],
		[row(254, 999, '2026-08-01T14:00:00Z')]
	);
	eq('a newer local edit beats an older remote row', m2[0].rank, 111);

	// Equal timestamps go to remote, so devices converge instead of each
	// keeping its own answer forever.
	const m3 = mergeRows(
		[row(254, 111, '2026-08-01T15:00:00Z')],
		[row(254, 999, '2026-08-01T15:00:00Z')]
	);
	eq('a tie goes to the server', m3[0].rank, 999);

	ok('a team only on the server is picked up', mergeRows([], [row(9, 1)]).length === 1);
	ok('a team only local is kept', mergeRows([row(9, 1)], []).length === 1);
	ok('merging nothing into nothing is empty', mergeRows([], []).length === 0);
}

// ─── pendingRows ───────────────────────────────────────────────────────────
{
	const rows = [
		row(254, 1, '2026-08-01T10:00:00Z', { pushedAt: '2026-08-01T10:00:00Z' }),
		row(118, 2, '2026-08-01T11:00:00Z', { pushedAt: '2026-08-01T10:00:00Z' }),
		row(1678, 3, '2026-08-01T10:00:00Z', { pushedAt: null }),
		row(2056, 4, '2026-08-01T10:00:00Z')
	];
	const p = pendingRows(rows).map((r) => r.teamNumber).sort((a, b) => a - b);
	ok('pushed-and-unchanged rows are not pending', !p.includes(254));
	ok('edited-since-push rows are pending', p.includes(118));
	ok('never-pushed rows are pending', p.includes(1678) && p.includes(2056));
	eq('and nothing else is', p.length, 3);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
