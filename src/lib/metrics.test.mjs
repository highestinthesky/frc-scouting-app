// Correctness checks for the metrics engine. Run: node src/lib/metrics.test.mjs
//
// The cases that matter are the ones about *absence*: entries recorded before
// counters existed, and scouts who didn't watch a particular thing. Getting
// those wrong silently corrupts every ranking downstream, and nothing about the
// UI would look broken.

import assert from 'node:assert/strict';
import { readMetric, metricStats, scoreTeams, MIN_CONFIDENT_SAMPLE } from './metrics.js';

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

const entry = (createdAt, obs) => ({ createdAt, observations: obs });

// ─── readMetric: the not-recorded / recorded-zero distinction ────────────────

test('readMetric returns 0 for a recorded zero', () => {
	assert.equal(readMetric(entry('2026-01-01', { autoScored: 0 }), 'autoScored'), 0);
});

test('readMetric returns null for blank string', () => {
	assert.equal(readMetric(entry('2026-01-01', { autoScored: '' }), 'autoScored'), null);
});

test('readMetric returns null for a missing key (pre-metrics entry)', () => {
	assert.equal(readMetric(entry('2026-01-01', { strengths: 'fast' }), 'autoScored'), null);
});

test('readMetric returns null when observations is absent entirely', () => {
	assert.equal(readMetric({ createdAt: '2026-01-01' }, 'autoScored'), null);
});

test('readMetric coerces numeric strings', () => {
	assert.equal(readMetric(entry('2026-01-01', { autoScored: '7' }), 'autoScored'), 7);
});

test('readMetric rejects non-numeric text', () => {
	assert.equal(readMetric(entry('2026-01-01', { autoScored: 'lots' }), 'autoScored'), null);
});

// ─── metricStats ────────────────────────────────────────────────────────────

test('old entries do not drag the mean toward zero', () => {
	// Three legacy entries with no counters, two real readings of 8 and 10.
	const entries = [
		entry('2026-01-01', { strengths: 'a' }),
		entry('2026-01-02', { strengths: 'b' }),
		entry('2026-01-03', { strengths: 'c' }),
		entry('2026-01-04', { teleopScored: 8 }),
		entry('2026-01-05', { teleopScored: 10 })
	];
	const s = metricStats(entries, 'teleopScored');
	assert.equal(s.n, 2, 'only real readings count toward n');
	assert.equal(s.mean, 9, 'mean is 9, not 3.6');
});

test('a recorded zero DOES pull the mean down', () => {
	const entries = [
		entry('2026-01-01', { teleopScored: 0 }),
		entry('2026-01-02', { teleopScored: 10 })
	];
	const s = metricStats(entries, 'teleopScored');
	assert.equal(s.n, 2);
	assert.equal(s.mean, 5);
});

test('empty sample reports nulls, not zeros', () => {
	const s = metricStats([], 'teleopScored');
	assert.equal(s.n, 0);
	assert.equal(s.mean, null);
	assert.equal(s.max, null);
	assert.equal(s.confident, false);
});

test('median handles even and odd counts', () => {
	const odd = metricStats(
		[1, 5, 3].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	assert.equal(odd.median, 3);
	const even = metricStats(
		[1, 5, 3, 9].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	assert.equal(even.median, 4); // (3 + 5) / 2
});

test('confidence flips at MIN_CONFIDENT_SAMPLE', () => {
	const mk = (n) =>
		metricStats(
			Array.from({ length: n }, (_, i) => entry(`2026-01-0${i + 1}`, { cycles: 5 })),
			'cycles'
		);
	assert.equal(mk(MIN_CONFIDENT_SAMPLE - 1).confident, false);
	assert.equal(mk(MIN_CONFIDENT_SAMPLE).confident, true);
});

test('trend is null below four readings, positive when improving', () => {
	const three = metricStats(
		[1, 2, 3].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	assert.equal(three.trend, null);

	const rising = metricStats(
		[2, 2, 8, 8].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	assert.equal(rising.trend, 6); // newer half 8 − older half 2
});

test('trend uses chronological order regardless of input order', () => {
	const shuffled = [
		entry('2026-01-04', { cycles: 8 }),
		entry('2026-01-01', { cycles: 2 }),
		entry('2026-01-03', { cycles: 8 }),
		entry('2026-01-02', { cycles: 2 })
	];
	assert.equal(metricStats(shuffled, 'cycles').trend, 6);
});

test('stdDev separates a steady team from a swingy one at equal mean', () => {
	const steady = metricStats(
		[5, 5, 5, 5].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	const swingy = metricStats(
		[0, 10, 0, 10].map((v, i) => entry(`2026-01-0${i + 1}`, { cycles: v })),
		'cycles'
	);
	assert.equal(steady.mean, swingy.mean);
	assert.equal(steady.stdDev, 0);
	assert.equal(swingy.stdDev, 5);
});

// ─── scoreTeams ─────────────────────────────────────────────────────────────

const teamWith = (teamNumber, means) => ({
	teamNumber,
	metrics: Object.fromEntries(
		Object.entries(means).map(([k, mean]) => [
			k,
			{ mean, confident: true, higherIsBetter: k === 'missed' ? false : true }
		])
	)
});

test('higher scoring team ranks first', () => {
	const ranked = scoreTeams(
		[teamWith(1, { teleopScored: 2 }), teamWith(2, { teleopScored: 20 })],
		{ teleopScored: 1 }
	);
	assert.equal(ranked[0].teamNumber, 2);
});

test('higherIsBetter:false inverts — fewer misses ranks first', () => {
	const ranked = scoreTeams(
		[teamWith(1, { missed: 12 }), teamWith(2, { missed: 1 })],
		{ missed: 1 }
	);
	assert.equal(ranked[0].teamNumber, 2, 'team 2 dropped fewer, so it should lead');
});

test('zero weight excludes a metric from the score', () => {
	const ranked = scoreTeams(
		[
			teamWith(1, { teleopScored: 20, missed: 20 }),
			teamWith(2, { teleopScored: 1, missed: 0 })
		],
		{ teleopScored: 0, missed: 1 }
	);
	assert.equal(ranked[0].teamNumber, 2, 'only misses should count');
});

test('all weights zero yields no ranking signal', () => {
	const ranked = scoreTeams([teamWith(1, { teleopScored: 20 })], { teleopScored: 0 });
	assert.equal(ranked[0].score, 0);
});

test('a team missing a metric still scores on the others', () => {
	const ranked = scoreTeams(
		[
			{ teamNumber: 1, metrics: { teleopScored: { mean: null, confident: false } } },
			teamWith(2, { teleopScored: 10 })
		],
		{ teleopScored: 1 }
	);
	assert.equal(ranked[0].teamNumber, 2);
	assert.equal(ranked[1].score, 0, 'no reading contributes nothing, not a penalty below zero');
});

test('identical teams tie rather than being ordered arbitrarily', () => {
	const ranked = scoreTeams(
		[teamWith(7, { teleopScored: 5 }), teamWith(3, { teleopScored: 5 })],
		{ teleopScored: 1 }
	);
	assert.equal(ranked[0].score, ranked[1].score);
	assert.equal(ranked[0].teamNumber, 3, 'stable tiebreak on team number');
});

test('confidence reflects how many metrics had a real sample', () => {
	const thin = {
		teamNumber: 9,
		metrics: {
			teleopScored: { mean: 5, confident: false, higherIsBetter: true },
			cycles: { mean: 5, confident: true, higherIsBetter: true }
		}
	};
	const [r] = scoreTeams([thin], { teleopScored: 1, cycles: 1 });
	assert.equal(r.confidence, 0.5);
});

console.log(`${passed} passed`);
