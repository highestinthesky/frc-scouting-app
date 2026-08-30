// Tests for the auto recording's encoding and the questions asked of it.
//   node src/lib/auto-track.test.mjs
//
// The size claim is asserted here rather than trusted. docs/adr-002 rejects the
// plan's database-size worry on the arithmetic — "~500 bytes per robot per
// match, ~70 KB for a fully covered event" — and that number is the entire
// reason the replay was allowed back into the design. A claim a release rests
// on should fail loudly when it stops being true.

import {
	TRACK_VERSION,
	SAMPLE_HZ,
	ACTIONS,
	encodeTrack,
	decodeTrack,
	readTrack,
	trackDuration,
	firstMovementAt,
	positionAt,
	actionsAt,
	cycleStats,
	routeSignature,
	clusterRoutes
} from './auto-track.js';

let pass = 0;
let fail = 0;
function ok(label, cond) {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.error(`FAIL: ${label}`);
	}
}
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

/** A believable 15-second recording at 10 Hz. */
function synth(n = 150) {
	const samples = [];
	for (let i = 0; i < n; i += 1) {
		const f = i / (n - 1);
		samples.push({ x: 0.1 + f * 0.6, y: 0.45 + Math.sin(f * Math.PI) * 0.2 });
	}
	return samples;
}

// ─── round trip ────────────────────────────────────────────────────────────
{
	const samples = synth();
	const t = encodeTrack({
		start: { x: 0.1, y: 0.45 },
		samples,
		intervals: [
			{ a: 'collect', t0: 1200, t1: 2600 },
			{ a: 'score', t0: 4100, t1: 5000 }
		]
	});
	const d = decodeTrack(t);

	ok('the version is stamped', t.v === TRACK_VERSION);
	ok('the cadence is stored, not assumed', t.hz === SAMPLE_HZ);
	ok('every sample survives', d.samples.length === samples.length);
	ok('the intervals survive', d.intervals.length === 2);
	ok('the start survives', near(d.start.x, 0.1) && near(d.start.y, 0.45));

	// Quantisation error must stay under a robot's width. 8 bits is 1/255 of the
	// field, so a round trip is at most 1/510 out — about 3 cm on a 16.5 m field.
	let worst = 0;
	for (let i = 0; i < samples.length; i += 1) {
		worst = Math.max(
			worst,
			Math.abs(d.samples[i].x - samples[i].x),
			Math.abs(d.samples[i].y - samples[i].y)
		);
	}
	ok(`round-trip error stays under 1/510 of the field (was ${worst.toFixed(5)})`,
		worst <= 1 / 510 + 1e-9);

	// t is derived from the index and the cadence, never stored per sample.
	ok('timestamps come from the cadence', d.samples[10].t === 1000);
	ok('the duration is the last sample', trackDuration(d) === Math.round((150 - 1) * 100));
}

// ─── the size claim the ADR rests on ───────────────────────────────────────
{
	const t = encodeTrack({
		start: { x: 0.1, y: 0.45 },
		samples: synth(150),
		intervals: [
			{ a: 'collect', t0: 1200, t1: 2600 },
			{ a: 'score', t0: 4100, t1: 5000 },
			{ a: 'collect', t0: 6000, t1: 7200 },
			{ a: 'score', t0: 8000, t1: 9000 }
		]
	});
	const bytes = JSON.stringify(t).length;
	ok(`a 15-second track stays under 600 bytes of JSON (was ${bytes})`, bytes < 600);

	// 24 matches x 6 robots, the fully covered offseason the ADR costs out.
	const perEvent = bytes * 144;
	ok(`a fully covered event stays under 100 KB (was ${Math.round(perEvent / 1024)} KB)`,
		perEvent < 100 * 1024);
}

// ─── partial records are a feature, not a degraded case ────────────────────
{
	const startOnly = encodeTrack({ start: { x: 0.2, y: 0.7 } });
	ok('start-only encodes', startOnly !== null);
	ok('and carries no position track', startOnly.p === undefined);
	const d = decodeTrack(startOnly);
	ok('and decodes to a start with no samples', d.start !== null && d.samples.length === 0);
	ok('its duration is zero, not an error', trackDuration(d) === 0);
	ok('and it has no first movement to align on', firstMovementAt(d) === null);

	const buttonsOnly = encodeTrack({ intervals: [{ a: 'score', t0: 100, t1: 900 }] });
	ok('buttons with no track is a real record', buttonsOnly !== null);
	ok('and cycle stats still work on it', cycleStats(decodeTrack(buttonsOnly)).msScoring === 800);

	// Blank stays blank. Nothing recorded must encode to nothing at all, so it
	// stays out of the aggregates rather than entering them as a zero.
	ok('nothing recorded is null', encodeTrack({}) === null);
	ok('empty arrays are null', encodeTrack({ samples: [], intervals: [] }) === null);
	ok('junk is null', encodeTrack(null) === null);
	ok('decoding nothing is null', decodeTrack(null) === null && decodeTrack({}) === null);
}

// ─── refusing to guess ─────────────────────────────────────────────────────
{
	// A future layout decoded as this one produces a plausible path in the wrong
	// places, which is worse than a gap because a gap is visible.
	ok('a future version is refused', decodeTrack({ v: 99, hz: 10, p: 'AAAA' }) === null);
	ok('a versionless blob is refused', decodeTrack({ hz: 10, p: 'AAAA' }) === null);

	// Corrupt base64 must not take the start and the intervals down with it —
	// they are stored separately and are still readable.
	const salvaged = decodeTrack({
		v: 1, hz: 10, start: { x: 0.5, y: 0.5 }, p: '!!!not base64!!!',
		s: [{ a: 'score', t0: 0, t1: 500 }]
	});
	ok('corrupt samples still yield the start', salvaged?.start?.x === 0.5);
	ok('and the intervals', salvaged?.intervals.length === 1);
}

// ─── input hygiene ─────────────────────────────────────────────────────────
{
	const t = encodeTrack({
		samples: [{ x: -5, y: 9 }],
		intervals: [
			{ a: 'score', t0: 500, t1: 500 },      // zero length: a mis-tap
			{ a: 'nonsense', t0: 0, t1: 100 },     // not in the closed set
			{ a: 'collect', t0: 900, t1: 400 },    // ends before it starts
			{ a: 'fault', t0: 200, t1: 700 }
		]
	});
	const d = decodeTrack(t);
	ok('coordinates are clamped to the field', d.samples[0].x === 0 && d.samples[0].y === 1);
	ok('only real actions survive', d.intervals.length === 1 && d.intervals[0].a === 'fault');
	ok('the action set is closed', ACTIONS.length === 3 && ACTIONS.includes('fault'));
}

// ─── first movement, which is how six recordings line up ───────────────────
{
	const still = [];
	for (let i = 0; i < 20; i += 1) still.push({ x: 0.3, y: 0.3 });
	const then = still.concat([{ x: 0.5, y: 0.3 }, { x: 0.6, y: 0.3 }]);
	const d = decodeTrack(encodeTrack({ start: { x: 0.3, y: 0.3 }, samples: then }));
	ok('a robot that waits is not moving yet', firstMovementAt(d) === 2000);

	// Thumb tremor is not movement. One quantisation step is 1/255; the threshold
	// is 1/100 of the field, so a jitter of a step or two does not trip it.
	const jitter = [];
	for (let i = 0; i < 20; i += 1) jitter.push({ x: 0.3 + (i % 2) * 0.002, y: 0.3 });
	ok('a shaky thumb is not movement',
		firstMovementAt(decodeTrack(encodeTrack({ start: { x: 0.3, y: 0.3 }, samples: jitter }))) === null);
}

// ─── position at a moment ──────────────────────────────────────────────────
{
	const d = decodeTrack(
		encodeTrack({ start: { x: 0, y: 0 }, samples: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
	);
	ok('midway between two samples is interpolated', near(positionAt(d, 50).x, 0.5, 0.01));
	ok('before the first sample holds the start', positionAt(d, -100).x === 0);
	// A robot that stopped being recorded did not vanish. Dropping it mid-field
	// looks like a robot that disappeared.
	ok('after the last sample holds the last', near(positionAt(d, 99999).x, 1));
	ok('a start-only track reports its start', positionAt(decodeTrack(encodeTrack({ start: { x: 0.4, y: 0.4 } })), 500).x === 0.4);
}

// ─── cycles ────────────────────────────────────────────────────────────────
{
	const d = decodeTrack(
		encodeTrack({
			intervals: [
				{ a: 'collect', t0: 0, t1: 1000 },
				{ a: 'score', t0: 1500, t1: 2000 },
				{ a: 'collect', t0: 3000, t1: 3500 },
				{ a: 'score', t0: 4000, t1: 4600 }
			]
		})
	);
	const c = cycleStats(d);
	ok('two collect-then-score pairs are two cycles', c.cycles === 2);
	ok('time collecting is summed', c.msCollecting === 1500);
	ok('time scoring is summed', c.msScoring === 1100);
	ok('actions happening at a moment are reported', actionsAt(d, 1700).join() === 'score');
	ok('and none between them', actionsAt(d, 2500).length === 0);

	// A preload is the one game piece every team scores, so counting score marks
	// alone would count the thing that tells you nothing.
	const preload = decodeTrack(encodeTrack({ intervals: [{ a: 'score', t0: 0, t1: 500 }] }));
	ok('a score with no collect before it is not a cycle', cycleStats(preload).cycles === 0);
	ok('but it is still counted as a score', cycleStats(preload).scoreCount === 1);
}

// ─── the route signature ───────────────────────────────────────────────────
{
	const mk = (acts) =>
		decodeTrack(encodeTrack({ intervals: acts.map((a, i) => ({ a, t0: i * 1000, t1: i * 1000 + 500 })) }));

	ok('a signature reads as a sentence',
		routeSignature(mk(['collect', 'score']), 'Middle') === 'Middle → collect → score');

	// A robot knocked off its route ran the same route. Including fault would
	// split one team's eleven identical autos on the one match someone hit them.
	ok('a fault does not change the signature',
		routeSignature(mk(['collect', 'fault', 'score']), 'Middle') ===
			routeSignature(mk(['collect', 'score']), 'Middle'));

	ok('an unknown zone is marked, not guessed',
		routeSignature(mk(['score']), null) === '? → score');
	ok('a start-only record has no signature', routeSignature(mk([]), null) === null);
	// A record with a start and no actions IS a route — the robot lined up there
	// and did nothing, which is a fact about the robot.
	const parked = decodeTrack(encodeTrack({ start: { x: 0.2, y: 0.2 } }));
	ok('a start with no actions is still a route',
		routeSignature(parked, 'Left') === 'Left → no actions');

	const rows = [
		{ track: mk(['collect', 'score']), zone: 'Middle' },
		{ track: mk(['collect', 'score']), zone: 'Middle' },
		{ track: mk(['collect', 'fault', 'score']), zone: 'Middle' },
		{ track: mk(['score']), zone: 'Left' },
		{ track: null, zone: 'Left' }
	];
	const clusters = clusterRoutes(rows);
	ok('identical routes cluster', clusters[0].count === 3);
	ok('a different start zone is a different route', clusters.length === 2);
	ok('commonest first', clusters[0].count >= clusters[1].count);
	ok('a missing track joins no cluster',
		clusters.reduce((n, c) => n + c.count, 0) === 4);
}

// ─── reading it off an entry ───────────────────────────────────────────────
{
	const t = encodeTrack({ start: { x: 0.5, y: 0.5 } });
	// 0.5 quantises to byte 128, which is 0.502 back — the test compares within
	// the quantisation step rather than pretending the round trip is exact.
	ok('a track is read from observations.autoTrack',
		near(readTrack({ observations: { autoTrack: t } })?.start.x, 0.5));
	ok('an entry without one reads null', readTrack({ observations: {} }) === null);
	ok('an entry predating the feature reads null', readTrack({}) === null);
	// autoPathing is a DIFFERENT, older, free-text field rendered on two pages.
	// Two concepts must not share a name.
	ok('the free-text autoPathing field is not mistaken for one',
		readTrack({ observations: { autoPathing: 'three piece middle' } }) === null);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
