// The auto recording: encode, decode, and the questions asked of it.
//
// Pure. No DOM, no Supabase, no runes — the same shape as event-rules.js and
// scout-identity.js, and for the same reason: these are the rules, and rules
// that can only be exercised through a browser do not get exercised.
//
// Designed in docs/adr-002-spatial-observations.md, from the plan in
// docs/auto-scouting-plan.md. The decisions that matter here:
//
//   Decision 1  coordinates are fractions of the FULL field, never the drawn
//               (cut) region, and never alliance-relative. Flip at display.
//   Decision 2  a sampled position track PLUS action intervals. Two things,
//               different resolutions, separately recordable.
//   Decision 4  blank stays blank, per piece — start-only is a real record.
//   Decision 8  t = 0 is when the SCOUT pressed record, not when auto started.
//
// ─── why the bytes are shaped like this ────────────────────────────────────
//
// 10 Hz, and not more. Human pursuit tracking lags 200–300 ms, so sampling
// faster records the scout's thumb tremor rather than the robot.
//
// 8 bits per axis. 256 steps across a 16.5 m field is 6.4 cm — under a tenth of
// a robot's width, and on a field drawn 350 px wide one step is 1.4 px, well
// under a thumb. Quantisation is not the limiting error here; the scout is.
//
// 150 samples × 2 bytes = 300 bytes, ~500 encoded with the intervals. A fully
// covered 24-match event is about 70 KB. The plan raised database size as a
// worry and the arithmetic does not support it — but it only does not support
// it BECAUSE of this encoding. Storing 60 Hz unquantised JSON floats is 27 KB
// per track, which would also have worked, and would have made entries.
// observations a place where a 27 KB blob rides along on every sync tick.
//
// ─── the track knows its season ────────────────────────────────────────────
//
// Nothing in this file names a game. What a robot can be doing, which follow-up
// questions an action asks, what a cycle is, which action is a fault and which
// one ends the robot's auto — all of it is read off a Season (`./seasons/`), and
// `seasons/2026.js` is where this year's answers live.
//
// A track is stamped with the year of the season it was recorded on, because a
// track is positions on ONE field and words from ONE game's vocabulary. The
// stamp is an additive key: TRACK_VERSION describes the byte layout, which did
// not change, and an older decoder ignores a key it does not read.

import { mirrorPosition } from './field.js';
import { currentSeason, seasonFor, seasonForUnstamped } from './seasons/index.js';

/**
 * Bump when the byte layout or the sample rate changes. NOT SCHEMA_VERSION, and
 * not the season either — the season is its own stamp, `season`, on the track.
 */
export const TRACK_VERSION = 1;

/** Samples per second. See the header — this is a claim about people, not phones. */
export const SAMPLE_HZ = 10;

/** Fraction of the field a robot must move before it counts as having started. */
const MOVEMENT_EPSILON = 0.01;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A fraction to one of 256 steps, and back.
 *
 * Rounding rather than truncating: truncation biases every coordinate toward
 * the origin, which over 150 samples drags a whole path toward one corner of
 * the field. Round-trip error is at most 1/510 of the field — about 3 cm.
 */
const quantize = (n) => Math.round(clamp01(Number(n) || 0) * 255);
const dequantize = (b) => b / 255;

/**
 * A quantised fraction, trimmed to four decimals for storage.
 *
 * `start` is stored as a pair of numbers rather than as bytes, so it can be read
 * and histogrammed without decoding the track. Left at full precision that is
 * `0.12156862745098039` — nineteen characters to express one of 256 values, and
 * two of them on every record. One step is 1/255 ≈ 0.0039, so four decimals
 * identify the step uniquely and round-trip to the same byte.
 */
const storeCoord = (n) => Math.round(dequantize(quantize(n)) * 10000) / 10000;

// btoa/atob rather than Buffer: this runs in the browser, and Node has had both
// as globals since 16 so the tests exercise the same code the phone does.
function bytesToBase64(bytes) {
	let s = '';
	// Chunked because String.fromCharCode(...huge) blows the argument limit. A
	// 15-second track is 300 bytes and would be fine spread in one call; a
	// future longer recording would not, and this is not the place to find out.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
	}
	return btoa(s);
}

function base64ToBytes(b64) {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
	return out;
}

/**
 * Copy an interval's answers onto `out`, keeping only what the season allows.
 *
 * Only the questions THIS action asks, and only a value that is exactly one of
 * that question's options. Exactly — `===`, no coercion — because the options
 * are the closed set of things a scout could have tapped, and anything else is
 * not an answer:
 *
 *   - An absent answer is "saw it, could not tell", which is a real
 *     observation. A zero (`lvl: 0`) would be a different claim — "did not" —
 *     and would be a lie in the same shape. Blank is not zero.
 *   - Three-state answers (`true` / `false` / absent) are the reason this is
 *     written out rather than coerced. `false` and absent are the two that get
 *     confused, and confusing them turns "nobody judged it" into "it failed".
 *     A stray `'yes'` must not become `true` on the way through either.
 *
 * Shared by encode and decode so the two cannot disagree about what survives.
 *
 * @param {object} iv   the interval as given
 * @param {import('./seasons/index.js').Action} action
 * @param {object} out  the interval being built
 */
function copyAnswers(iv, action, out) {
	for (const q of action.questions ?? []) {
		const value = iv[q.key];
		if (q.options.some((o) => o.value === value)) out[q.key] = value;
	}
	return out;
}

/**
 * Build the stored shape from what the recorder collected.
 *
 * Every piece is optional and they are stored separately on purpose (Decision
 * 4): a scout who placed the robot before the match and then watched it instead
 * of tracking it has recorded something real, and it feeds the single
 * most-asked question. Returning null for "nothing at all" is what keeps a
 * skipped recording out of the aggregates rather than in them as a zero.
 *
 * `season` is the game the recording was made on; the output is stamped with
 * its year, and only that season's actions and answers survive.
 *
 * @param {{start?: {x:number,y:number}|null,
 *          samples?: Array<{x:number,y:number}>,
 *          intervals?: Array<{a:string,t0:number,t1:number}>,
 *          hz?: number}} input
 * @param {import('./seasons/index.js').Season} [season]
 * @returns {object|null}
 */
export function encodeTrack(input, season = currentSeason()) {
	const samples = Array.isArray(input?.samples) ? input.samples : [];
	const intervals = (Array.isArray(input?.intervals) ? input.intervals : [])
		.filter((iv) => iv && Object.hasOwn(season.actionByKey, iv.a))
		.map((iv) =>
			copyAnswers(iv, season.actionByKey[iv.a], {
				a: iv.a,
				t0: Math.max(0, Math.round(Number(iv.t0) || 0)),
				t1: Math.max(0, Math.round(Number(iv.t1) || 0))
			})
		)
		// A zero-length interval is a mis-tap, not an action. A button held for
		// under a tenth of a second is below the sample rate and cannot be placed
		// on the track anyway.
		.filter((iv) => iv.t1 > iv.t0)
		.sort((a, b) => a.t0 - b.t0);

	const start = input?.start
		? { x: storeCoord(input.start.x), y: storeCoord(input.start.y) }
		: null;

	if (!start && samples.length === 0 && intervals.length === 0) return null;

	const bytes = new Uint8Array(samples.length * 2);
	for (let i = 0; i < samples.length; i += 1) {
		bytes[i * 2] = quantize(samples[i]?.x);
		bytes[i * 2 + 1] = quantize(samples[i]?.y);
	}

	const out = { v: TRACK_VERSION, hz: Number(input?.hz) || SAMPLE_HZ, season: season.year };
	if (start) out.start = start;
	if (samples.length) out.p = bytesToBase64(bytes);
	if (intervals.length) out.s = intervals;
	return out;
}

/**
 * Read a stored track back.
 *
 * Returns null for anything that is not a track this build understands —
 * including a FUTURE version. Refusing to guess is deliberate: a v2 layout
 * decoded as v1 produces a plausible-looking path in the wrong places, which is
 * worse than a gap, because a gap is visible.
 *
 * The same refusal covers a season this build does not have. A track's
 * positions are fractions of ONE field and its actions are ONE game's words;
 * drawn on another field, a path lands somewhere plausible and wrong, and its
 * intervals would be read through a vocabulary they were never written in. So
 * a track stamped with an unregistered season decodes to null — invisible,
 * rather than convincingly misplaced.
 *
 * A track with no stamp predates the stamp, and is read on the season that
 * claims unstamped tracks (`seasonForUnstamped()`; 2026, the only game the
 * recorder knew before tracks carried their season).
 *
 * @param {unknown} raw
 * @returns {{v:number, hz:number, season: import('./seasons/index.js').Season,
 *            start:{x:number,y:number}|null,
 *            samples:Array<{x:number,y:number,t:number}>,
 *            intervals:Array<{a:string,t0:number,t1:number}>}|null}
 */
export function decodeTrack(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const v = Number(raw.v);
	if (v !== TRACK_VERSION) return null;

	const season = raw.season == null ? seasonForUnstamped() : seasonFor(raw.season);
	if (!season) return null;

	const hz = Number(raw.hz) || SAMPLE_HZ;
	const step = 1000 / hz;

	let samples = [];
	if (typeof raw.p === 'string' && raw.p) {
		let bytes;
		try {
			bytes = base64ToBytes(raw.p);
		} catch {
			// Corrupt base64 is not a reason to lose the start position and the
			// intervals, which are stored separately and are still readable.
			bytes = new Uint8Array(0);
		}
		const n = Math.floor(bytes.length / 2);
		samples = new Array(n);
		for (let i = 0; i < n; i += 1) {
			samples[i] = {
				x: dequantize(bytes[i * 2]),
				y: dequantize(bytes[i * 2 + 1]),
				// t is DERIVED from the index, which is why the cadence has to be
				// fixed and stored. It is not a saving of three bytes a sample; it is
				// that a per-sample timestamp could disagree with the cadence and
				// there would be no way to tell which was right.
				t: Math.round(i * step)
			};
		}
	}

	const start =
		raw.start && Number.isFinite(Number(raw.start.x)) && Number.isFinite(Number(raw.start.y))
			? { x: clamp01(Number(raw.start.x)), y: clamp01(Number(raw.start.y)) }
			: null;

	const intervals = (Array.isArray(raw.s) ? raw.s : [])
		.filter((iv) => iv && Object.hasOwn(season.actionByKey, iv.a) && Number.isFinite(Number(iv.t0)))
		// Read back exactly as it is written — the same copyAnswers, so a stored
		// `false` survives as "tried and failed" instead of decoding as "nobody
		// said", and a stored answer the season does not offer is not resurrected.
		.map((iv) => copyAnswers(iv, season.actionByKey[iv.a], { a: iv.a, t0: Number(iv.t0), t1: Number(iv.t1) }))
		.sort((a, b) => a.t0 - b.t0);

	if (!start && samples.length === 0 && intervals.length === 0) return null;
	return { v, hz, season, start, samples, intervals };
}

/**
 * Is there a track on this entry, and is it readable?
 *
 * The one place `observations.autoTrack` is named. Deliberately not
 * `autoPathing` — that key already exists as a free-text field and is rendered
 * on two pages. Two concepts must not share a name; that is the mistake
 * scout-identity.js exists to have already fixed once.
 *
 * @param {object} entry
 */
export function readTrack(entry) {
	return decodeTrack(entry?.observations?.autoTrack);
}

/** How long the recording ran, in ms. Zero for a start-only record. */
export function trackDuration(track) {
	if (!track) return 0;
	const fromSamples = track.samples.length ? track.samples[track.samples.length - 1].t : 0;
	const fromIntervals = track.intervals.reduce((m, iv) => Math.max(m, iv.t1), 0);
	return Math.max(fromSamples, fromIntervals);
}

/**
 * The first sample where the robot has actually moved, or null.
 *
 * This is Decision 8's answer to a problem the plan does not raise: six scouts
 * press record at six different moments and a gym has no shared clock, so t = 0
 * means six different things. Robots start on a shared cue even when scouts do
 * not, so first movement recovers most of the offset for free.
 *
 * It is a heuristic and it is allowed to be, because the replay carries a
 * manual nudge and says on screen that it is a reconstruction.
 *
 * @param {object|null} track
 * @returns {number|null} ms from the start of the recording
 */
export function firstMovementAt(track) {
	if (!track || track.samples.length === 0) return null;
	const origin = track.start ?? track.samples[0];
	for (const s of track.samples) {
		const dx = s.x - origin.x;
		const dy = s.y - origin.y;
		// Squared distance: a square root here buys nothing, and MOVEMENT_EPSILON
		// is a threshold rather than a measurement anybody reads.
		if (dx * dx + dy * dy >= MOVEMENT_EPSILON * MOVEMENT_EPSILON) return s.t;
	}
	return null;
}

/**
 * Where the robot was at a moment, interpolated between samples.
 *
 * Linear, because the samples are 100 ms apart and a robot does not do anything
 * interesting between two of them that a spline would recover honestly.
 *
 * Before the first sample it holds the start position and after the last it
 * holds the last — a robot that stopped being recorded did not vanish, and a
 * replay that drops it mid-field looks like a robot that disappeared.
 *
 * @param {object|null} track
 * @param {number} t  ms from the start of THIS track's recording
 */
export function positionAt(track, t) {
	if (!track) return null;
	const s = track.samples;
	if (s.length === 0) return track.start;
	if (t <= s[0].t) return track.start ?? { x: s[0].x, y: s[0].y };
	if (t >= s[s.length - 1].t) {
		const last = s[s.length - 1];
		return { x: last.x, y: last.y };
	}
	const step = 1000 / track.hz;
	const i = Math.min(s.length - 2, Math.max(0, Math.floor(t / step)));
	const a = s[i];
	const b = s[i + 1];
	const span = b.t - a.t || 1;
	const f = (t - a.t) / span;
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Which actions were happening at a moment. */
export function actionsAt(track, t) {
	return marksAt(track, t).map((iv) => iv.a);
}

/**
 * The same, as the intervals themselves.
 *
 * The field draws a mark's answers as well as its action — in 2026 a different
 * climb icon for each rung, and a different one again for a climb that came
 * off — so what it needs is the mark, not the name of the action. `actionsAt`
 * stays because "which actions" is still a question worth asking on its own,
 * and it is now one line over this.
 */
export function marksAt(track, t) {
	if (!track) return [];
	return track.intervals.filter((iv) => t >= iv.t0 && t <= iv.t1);
}

/**
 * Combine one question's answers across every interval that carries it.
 *
 * The role says how, so this never has to know the game:
 *
 *   level    the BEST, not the last and not a mean. A robot that slipped to a
 *            lower level and then got back up did reach the higher one, and
 *            averaging two attempts would describe something that never
 *            happened.
 *   outcome  true if any attempt came off, else false if any was judged a
 *            failure, else null. A single `false` among several attempts is not
 *            a verdict — a robot that slipped and then got up did make it.
 *   (none)   the latest answer given, in time order.
 *
 * null, not 0 or false, when nobody answered. "Did it, could not tell how" and
 * "did not" are different facts and must not collapse into the same value.
 *
 * @param {import('./seasons/index.js').Question} q
 * @param {Array<object>} marks  in time order
 */
function combineAnswers(q, marks) {
	const given = marks.filter((iv) => Object.hasOwn(iv, q.key)).map((iv) => iv[q.key]);
	if (q.role === 'level') {
		const levels = given.filter((n) => typeof n === 'number' && Number.isFinite(n));
		return levels.length ? Math.max(...levels) : null;
	}
	if (q.role === 'outcome') {
		return given.includes(true) ? true : given.includes(false) ? false : null;
	}
	return given.length ? given[given.length - 1] : null;
}

/**
 * The cycle statistics the plan asks for.
 *
 * These come from the INTERVALS and touch no geometry at all, which is why they
 * are the cheapest useful thing here and why they work on a record with no
 * position track. A scout who could not track the robot but did hold the
 * buttons has still answered "how long was it scoring".
 *
 * Everything is read off the track's own season. `byAction` names every action
 * that season has, zeros included — an action nobody pressed was available and
 * not pressed, which IS zero, unlike an unanswered question. The three things a
 * season may not have at all — a cycle, a fault action, an endgame — report
 * null when it lacks them, rather than zero of something it has no word for.
 *
 * A cycle is the first `cycle.to` after a `cycle.from` (in 2026, a score after
 * a collect). Counting `to` marks alone would count a preloaded game piece as a
 * cycle, which is the one every team scores and therefore the one that tells
 * you nothing.
 *
 * @param {object|null} track  as decodeTrack returns it
 */
export function cycleStats(track) {
	if (!track) return null;
	const { season } = track;

	/** @type {Record<string, {ms: number, count: number}>} */
	const byAction = {};
	for (const a of season.actions) byAction[a.key] = { ms: 0, count: 0 };
	for (const iv of track.intervals) {
		const slot = byAction[iv.a];
		if (!slot) continue;
		slot.ms += iv.t1 - iv.t0;
		slot.count += 1;
	}

	// Walk in time order and close a cycle on the first `to` after a `from`.
	let cycles = null;
	if (season.cycle) {
		cycles = 0;
		let armed = false;
		for (const iv of track.intervals) {
			if (iv.a === season.cycle.from) armed = true;
			else if (iv.a === season.cycle.to && armed) {
				cycles += 1;
				armed = false;
			}
		}
	}

	let endgame = null;
	if (season.endgame) {
		const marks = track.intervals.filter((iv) => iv.a === season.endgame.key);
		endgame = {
			done: marks.length > 0,
			// When it BEGAN. The endgame action runs to the whistle by construction,
			// so its duration is a fact about the recording rather than about the
			// robot — the moment it started is the only part anybody observed.
			startedAt: marks.length ? Math.min(...marks.map((iv) => iv.t0)) : null,
			answers: Object.fromEntries(
				(season.endgame.questions ?? []).map((q) => [q.key, combineAnswers(q, marks)])
			)
		};
	}

	return {
		duration: trackDuration(track),
		byAction,
		cycles,
		faults: season.faultAction ? byAction[season.faultAction.key].count : null,
		endgame
	};
}

/**
 * A mark's answers as words, one per question, in the order the action asks.
 *
 * The chosen option's `says` ("rung 2"); when unanswered, the question's
 * `unknown` wording if it has one ("rung not recorded"), otherwise nothing. An
 * unanswered question is only worth saying aloud when its absence is itself
 * information a reader would otherwise miss — which is the season's call, not
 * this function's.
 *
 * @param {import('./seasons/index.js').Action|null|undefined} action
 * @param {object|null|undefined} mark  an interval
 * @returns {string[]}
 */
export function describeAnswers(action, mark) {
	const out = [];
	for (const q of action?.questions ?? []) {
		const value = mark?.[q.key];
		const chosen = mark && Object.hasOwn(mark, q.key) ? q.options.find((o) => o.value === value) : undefined;
		if (chosen) out.push(chosen.says);
		else if (q.unknown) out.push(q.unknown);
	}
	return out;
}

/**
 * The route signature — a start zone and an ordered action sequence.
 *
 * This is the answer to the plan's own stated hard problem:
 *
 *   "Turning auto paths into general words would be very difficult."
 *
 * It is, if the words have to come from the geometry. They do not. The actions
 * were recorded AS words, so the signature is discrete, cheap, robust to a
 * shaky thumb, and it is already how a manager says it out loud — "they do the
 * three-piece from the middle". Geometry only refines WITHIN a signature group,
 * where comparing curves means something.
 *
 * The season's fault action is left out of the signature deliberately: a robot
 * knocked off its route ran the same route. Including it would split one team's
 * eleven identical autos into two clusters on the one match someone hit them.
 *
 * @param {object|null} track
 * @param {string|null} zone  from the season's classifier, alliance-relative
 * @returns {string|null}
 */
export function routeSignature(track, zone) {
	if (!track) return null;
	// Actions are in the signature without their answers: "they climb" is a
	// route, and splitting one team's eleven identical autos across three rungs
	// would bury the route under the variation.
	const fault = track.season?.faultAction?.key ?? null;
	const seq = track.intervals.filter((iv) => iv.a !== fault).map((iv) => iv.a);
	if (!zone && seq.length === 0) return null;
	return `${zone ?? '?'} → ${seq.length ? seq.join(' → ') : 'no actions'}`;
}

/**
 * Turn a whole recording end for end.
 *
 * The correction for a scout who read the field the wrong way round — every
 * position 180° from the truth, which produces a plausible auto at the wrong end
 * and looks entirely fine.
 *
 * **Positions only.** The intervals are times and times do not mirror; the
 * alliance is a fact from the schedule and is not this function's to touch. That
 * separation is the whole point: the entry says which alliance the robot was on,
 * and this says where on the carpet it went. Fixing the second must not quietly
 * rewrite the first.
 *
 * Takes and returns the STORED shape, so it composes with what is on an entry.
 * Returns null for anything unreadable rather than a half-flipped track. The
 * result is stamped with the season the track was read on — a legacy, unstamped
 * track comes back stamped, which is the same field it was always drawn on.
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
export function flipTrack(raw) {
	const d = decodeTrack(raw);
	if (!d) return null;
	return encodeTrack(
		{
			hz: d.hz,
			start: d.start ? mirrorPosition(d.start) : null,
			samples: d.samples.map(mirrorPosition),
			intervals: d.intervals
		},
		d.season
	);
}

/**
 * Group tracks by signature, commonest first.
 *
 * @param {Array<{track: object|null, zone: string|null, entry?: object}>} rows
 */
export function clusterRoutes(rows) {
	const by = new Map();
	for (const r of Array.isArray(rows) ? rows : []) {
		const sig = routeSignature(r?.track, r?.zone);
		if (!sig) continue;
		if (!by.has(sig)) by.set(sig, []);
		by.get(sig).push(r);
	}
	return [...by.entries()]
		.map(([signature, members]) => ({ signature, count: members.length, members }))
		.sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
}
