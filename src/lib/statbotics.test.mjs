// Correctness checks for the public-rating layer.
//   node src/lib/statbotics.test.mjs
//
// Two things are tested here and they matter for opposite reasons.
//
// The DEGRADATION path is tested because it is the one that will actually run:
// the API was returning 500 on every data endpoint while this was written, so
// "Statbotics said nothing" is a normal Tuesday and every surface has to keep
// working through it.
//
// The DISAGREEMENT maths is tested because it is what the feature is for, and
// because comparing two rankings has an edge case at every boundary — ties,
// a team only one side has heard of, a team nobody has rated.

import assert from 'node:assert/strict';
import { readEpa, rankBy, disagreements } from './statbotics.js';

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
	} catch (err) {
		console.error(`FAIL: ${name}\n  ${err.message}`);
		process.exitCode = 1;
	}
}

// ─── readEpa: the mapping that could not be observed ─────────────────────────
//
// The API was down and its OpenAPI document types the response as a bare
// `object`, so these fixtures are the CANDIDATE shapes, not confirmed ones.
// What is actually asserted is the contract this module offers regardless of
// which turns out to be right: a number and the path it came from, or null and
// the keys it saw.

test('a nested total_points mean is found, and says so', () => {
	const r = readEpa({ team: 254, epa: { total_points: { mean: 62.4, sd: 5 } } });
	assert.equal(r.value, 62.4);
	assert.equal(r.path, 'epa.total_points.mean');
});

test('a flat epa number is found', () => {
	const r = readEpa({ team: 254, epa: 48.1 });
	assert.equal(r.value, 48.1);
	assert.equal(r.path, 'epa');
});

test('a breakdown shape is found', () => {
	const r = readEpa({ epa: { breakdown: { total_points: 31 } } });
	assert.equal(r.value, 31);
	assert.equal(r.path, 'epa.breakdown.total_points');
});

test('an unreadable response reports the keys it saw, not silence', () => {
	// The distinction the whole design rests on: a response that ARRIVED and
	// could not be read is a different problem from a network that is down, and
	// if they look the same, a wrong field mapping is indistinguishable from an
	// outage — forever.
	const r = readEpa({ team: 254, rating: { points: 55 } });
	assert.equal(r.value, null);
	assert.deepEqual(r.sawKeys, ['team', 'rating']);
});

test('null, undefined and non-objects do not throw', () => {
	for (const junk of [null, undefined, 42, 'epa', []]) {
		const r = readEpa(junk);
		assert.equal(r.value, null);
	}
});

test('a non-finite value is not a rating', () => {
	// JSON cannot carry NaN, but a proxy or a bad transform can produce one, and
	// NaN ranks below everything while looking like a number.
	assert.equal(readEpa({ epa: Number.NaN }).value, null);
	assert.equal(readEpa({ epa: Number.POSITIVE_INFINITY }).value, null);
});

test('a string that looks like a number is not accepted', () => {
	// Coercing "62.4" would work until a field arrives as "N/A".
	assert.equal(readEpa({ epa: '62.4' }).value, null);
});

// ─── rankBy ─────────────────────────────────────────────────────────────────

test('highest value ranks first', () => {
	const r = rankBy([
		{ key: 'a', value: 10 },
		{ key: 'b', value: 30 },
		{ key: 'c', value: 20 }
	]);
	assert.deepEqual([r.get('b'), r.get('c'), r.get('a')], [1, 2, 3]);
});

test('ties share a rank rather than being broken arbitrarily', () => {
	// An invented tiebreak is a distinction the data does not contain, and
	// someone will defend it in a picklist meeting.
	const r = rankBy([
		{ key: 'a', value: 10 },
		{ key: 'b', value: 10 },
		{ key: 'c', value: 5 }
	]);
	assert.equal(r.get('a'), 1);
	assert.equal(r.get('b'), 1);
	assert.equal(r.get('c'), 3, 'the rank after a two-way tie is 3, not 2');
});

test('a null value is unranked, not ranked last', () => {
	const r = rankBy([
		{ key: 'a', value: 10 },
		{ key: 'b', value: null }
	]);
	assert.equal(r.get('a'), 1);
	assert.equal(r.has('b'), false);
});

test('a zero is a real value and ranks', () => {
	// Blank is not zero, here too: a team measured at 0 is ranked, a team with
	// no measurement is not.
	const r = rankBy([
		{ key: 'a', value: 0 },
		{ key: 'b', value: null }
	]);
	assert.equal(r.get('a'), 1);
	assert.equal(r.has('b'), false);
});

// ─── disagreements ──────────────────────────────────────────────────────────

const rows = [
	{ team: 111, ours: 50, theirs: 10 }, // we love it, they do not
	{ team: 222, ours: 10, theirs: 50 }, // they love it, we do not
	{ team: 333, ours: 30, theirs: 30 } // agreed
];

test('the biggest disagreement comes first', () => {
	const d = disagreements(rows);
	assert.equal(d[0].gap >= d[d.length - 1].gap, true);
	assert.equal(d[0].gap, 2);
});

test('direction says which side rates it higher', () => {
	const d = disagreements(rows);
	const a = d.find((x) => x.team === 111);
	const b = d.find((x) => x.team === 222);
	assert.equal(a.direction, 'we-rate-higher');
	assert.equal(b.direction, 'they-rate-higher');
});

test('agreement is reported as agreement, not omitted', () => {
	const d = disagreements(rows);
	const c = d.find((x) => x.team === 333);
	assert.equal(c.direction, 'agree');
	assert.equal(c.gap, 0);
});

test('a team only WE have judged is absent, not zero', () => {
	// The blank-vs-zero rule at the ranking layer. No rating is not a bad rating.
	const d = disagreements([{ team: 999, ours: 40, theirs: null }, ...rows]);
	assert.equal(
		d.find((x) => x.team === 999),
		undefined
	);
});

test('a team only THEY have judged is absent too', () => {
	const d = disagreements([{ team: 888, ours: null, theirs: 40 }, ...rows]);
	assert.equal(
		d.find((x) => x.team === 888),
		undefined
	);
});

test('an empty input is an empty result, not a crash', () => {
	assert.deepEqual(disagreements([]), []);
	assert.deepEqual(disagreements(null), []);
});

test('ranks come from the FULL set, not the surviving subset', () => {
	// A team without a rating still occupies a place in our own ranking. If it
	// were dropped before ranking, every team below it would move up one and the
	// gap would be understated for everybody.
	const d = disagreements([
		{ team: 1, ours: 100, theirs: 5 },
		{ team: 2, ours: 90, theirs: null },
		{ team: 3, ours: 80, theirs: 10 }
	]);
	const t3 = d.find((x) => x.team === 3);
	assert.equal(t3.ourRank, 3, 'team 2 still holds rank 2 in our ranking');
	assert.equal(t3.theirRank, 1);
});

test('disagreements never mutates its input', () => {
	const input = rows.map((r) => ({ ...r }));
	const before = JSON.stringify(input);
	disagreements(input);
	assert.equal(JSON.stringify(input), before);
});

console.log(`${passed} passed`);
