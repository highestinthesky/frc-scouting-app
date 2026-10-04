// The seasons this build knows, and the one it records.
//
// A season is one year's game as far as auto scouting is concerned: the field
// it is played on, the length of auto, and the closed set of things a robot can
// be doing. Each lives in its own file here as plain data — `2026.js` is the
// shape to copy. A season file holds no logic. The geometry lives in
// `../field.js` and the track format in `../auto-track.js`, and both work for
// any season this file can build.
//
// `CURRENT_SEASON` is the switch. It is the season a NEW recording is made on;
// reading an old one asks `seasonFor()` for whichever season that track was
// drawn on, so changing this line never re-reads history on a different field.
//
// `buildSeason()` validates as well as builds, and throws. A season file is
// written once a year by someone reading a game manual, and a mistake in it —
// two actions on one key, a band that runs backwards — would otherwise surface
// as a recorder that quietly does the wrong thing at an event. Failing the build
// (every season is built by `npm test`) is the cheaper place to find it.

import { makeField } from '../field.js';
import season2026 from './2026.js';
import seasonThrowaway from './fixture.js';

/** The season new recordings are made on. The one line that switches seasons. */
export const CURRENT_SEASON = 2026;

/** Every season this build can read. Registering one is adding it here. */
const SPECS = [season2026, seasonThrowaway];

/**
 * An answer to one follow-up question. `value` is what is stored; `label` is
 * the button; `says` is how it reads in a sentence ("rung 2").
 *
 * @typedef {{ value: number|string|boolean, label: string, says: string }} Option
 */

/**
 * A follow-up asked of an action. The answer is stored as a top-level key on
 * the interval, and an unanswered one is ABSENT — blank is not zero.
 *
 * `role` tells generic code how to compare answers without knowing the game:
 * `level` — best is the highest number; `outcome` — true beats false beats
 * absent.
 *
 * @typedef {{
 *   key: string,
 *   ask: string,
 *   role?: 'level'|'outcome',
 *   unknown?: string,
 *   options: Option[]
 * }} Question
 */

/**
 * Something a robot can be doing during auto.
 *
 * `role: 'fault'` marks a disruption: left out of route signatures and counted
 * as a fault. `ends` marks the endgame action: once pressed it runs to the
 * whistle and its questions are asked at once.
 *
 * @typedef {{
 *   key: string,
 *   label: string,
 *   doing: string,
 *   hotkey: string,
 *   icon?: 'collect'|'score'|'fault'|'climb'|null,
 *   tone: 'accent'|'success'|'warning',
 *   role?: 'fault',
 *   ends?: boolean,
 *   questions?: Question[]
 * }} Action
 */

/**
 * A season as written in its file. Positions are full-field fractions; rect
 * `x`/`y` are the centre.
 *
 * @typedef {{
 *   year: number,
 *   name: string,
 *   fieldVersion: number,
 *   claimsUnstampedTracks?: boolean,
 *   autoMs: number,
 *   field: {
 *     lengthIn: number,
 *     widthIn: number,
 *     robotIn: number,
 *     obstacles: Array<{kind:'rect',label:string,x:number,y:number,w:number,h:number,opening?:number}>,
 *     features: Array<{kind:'rect',label:string,look:'landmark'|'outline'|'wall',x:number,y:number,w:number,h:number}
 *                   | {kind:'line',label:string,look:'solid'|'dashed',x:number}>,
 *     allianceBands: Array<{end:'near'|'far',x:number,w:number}>,
 *     startDepth: number|null,
 *     startBands: Array<{label:string,upTo:number}>
 *   },
 *   actions: Action[],
 *   cycle: {from:string,to:string}|null
 * }} SeasonSpec
 */

/**
 * A season, validated and built. Frozen throughout.
 *
 * @typedef {Readonly<{
 *   year: number,
 *   name: string,
 *   fieldVersion: number,
 *   autoMs: number,
 *   claimsUnstampedTracks: boolean,
 *   actions: ReadonlyArray<Readonly<Action>>,
 *   actionByKey: Readonly<Record<string, Readonly<Action>>>,
 *   endgame: Readonly<Action>|null,
 *   faultAction: Readonly<Action>|null,
 *   cycle: Readonly<{from:string,to:string}>|null,
 *   field: import('../field.js').Field
 * }>} Season
 */

const ICONS = new Set(['collect', 'score', 'fault', 'climb', null]);
const TONES = new Set(['accent', 'success', 'warning']);
const LOOKS = { rect: new Set(['landmark', 'outline', 'wall']), line: new Set(['solid', 'dashed']) };
const ACTION_ROLES = new Set([undefined, 'fault']);
const QUESTION_ROLES = new Set([undefined, 'level', 'outcome']);
/** The interval's own keys. A question stored under one would overwrite it. */
const RESERVED_QUESTION_KEYS = new Set(['a', 't0', 't1']);

/** @param {string} season @param {string} what */
const fail = (season, what) => {
	throw new Error(`season ${season}: ${what}`);
};

/**
 * Validate a season spec and build it into a frozen Season.
 *
 * Exported for tests; everything else asks `seasonFor()`.
 *
 * @param {SeasonSpec} spec
 * @returns {Season}
 */
export function buildSeason(spec) {
	const id = String(spec?.year ?? '?');
	if (!Number.isInteger(spec?.year)) fail(id, `year ${JSON.stringify(spec?.year)} is not an integer`);
	if (!Number.isInteger(spec.autoMs) || spec.autoMs <= 0) {
		fail(id, `autoMs ${JSON.stringify(spec.autoMs)} is not a positive integer`);
	}

	// ─── actions ─────────────────────────────────────────────────────────────
	const actions = spec.actions ?? [];
	const keys = new Set();
	const hotkeys = new Set();
	for (const a of actions) {
		if (keys.has(a.key)) fail(id, `duplicate action key '${a.key}'`);
		keys.add(a.key);
		if (typeof a.hotkey !== 'string' || !/^[a-z]$/.test(a.hotkey)) {
			fail(id, `action '${a.key}' hotkey '${a.hotkey}' is not a single lowercase letter`);
		}
		if (hotkeys.has(a.hotkey)) fail(id, `duplicate hotkey '${a.hotkey}' on action '${a.key}'`);
		hotkeys.add(a.hotkey);
		if (!ICONS.has(a.icon ?? null)) fail(id, `action '${a.key}' has unknown icon '${a.icon}'`);
		if (!TONES.has(a.tone)) fail(id, `action '${a.key}' has unknown tone '${a.tone}'`);
		if (!ACTION_ROLES.has(a.role)) fail(id, `action '${a.key}' has unknown role '${a.role}'`);

		const qKeys = new Set();
		for (const q of a.questions ?? []) {
			if (RESERVED_QUESTION_KEYS.has(q.key)) {
				fail(id, `action '${a.key}' question key '${q.key}' is reserved by the interval`);
			}
			if (qKeys.has(q.key)) fail(id, `action '${a.key}' has duplicate question key '${q.key}'`);
			qKeys.add(q.key);
			if (!QUESTION_ROLES.has(q.role)) {
				fail(id, `action '${a.key}' question '${q.key}' has unknown role '${q.role}'`);
			}
			const values = new Set();
			for (const o of q.options ?? []) {
				if (values.has(o.value)) {
					fail(id, `action '${a.key}' question '${q.key}' has duplicate option value ${JSON.stringify(o.value)}`);
				}
				values.add(o.value);
			}
		}
	}

	const enders = actions.filter((a) => a.ends === true);
	if (enders.length > 1) fail(id, `more than one ends action: ${enders.map((a) => `'${a.key}'`).join(', ')}`);
	const faults = actions.filter((a) => a.role === 'fault');
	if (faults.length > 1) fail(id, `more than one fault action: ${faults.map((a) => `'${a.key}'`).join(', ')}`);

	if (spec.cycle != null) {
		for (const end of ['from', 'to']) {
			if (!keys.has(spec.cycle[end])) fail(id, `cycle.${end} '${spec.cycle[end]}' is not an action key`);
		}
	}

	// ─── field ───────────────────────────────────────────────────────────────
	const bands = spec.field?.startBands ?? [];
	if (bands.length === 0) fail(id, 'startBands is empty');
	for (let i = 1; i < bands.length; i += 1) {
		if (!(bands[i].upTo > bands[i - 1].upTo)) {
			fail(id, `startBands are not ascending at '${bands[i].label}'`);
		}
	}
	if (bands[bands.length - 1].upTo !== 1) {
		fail(id, `startBands last upTo is ${bands[bands.length - 1].upTo}, not 1 ('${bands[bands.length - 1].label}')`);
	}
	for (const f of spec.field.features ?? []) {
		const looks = LOOKS[f.kind];
		if (!looks) fail(id, `feature '${f.label}' has unknown kind '${f.kind}'`);
		if (!looks.has(f.look)) fail(id, `feature '${f.label}' has unknown look '${f.look}' for a ${f.kind}`);
	}

	// ─── build ───────────────────────────────────────────────────────────────
	const frozenActions = Object.freeze(
		actions.map((a) =>
			Object.freeze({
				...a,
				icon: a.icon ?? null,
				...(a.questions
					? {
							questions: Object.freeze(
								a.questions.map((q) =>
									Object.freeze({ ...q, options: Object.freeze((q.options ?? []).map((o) => Object.freeze({ ...o }))) })
								)
							)
						}
					: {})
			})
		)
	);
	const actionByKey = Object.freeze(Object.fromEntries(frozenActions.map((a) => [a.key, a])));

	return Object.freeze({
		year: spec.year,
		name: spec.name,
		fieldVersion: spec.fieldVersion,
		autoMs: spec.autoMs,
		claimsUnstampedTracks: spec.claimsUnstampedTracks === true,
		actions: frozenActions,
		actionByKey,
		endgame: frozenActions.find((a) => a.ends === true) ?? null,
		faultAction: frozenActions.find((a) => a.role === 'fault') ?? null,
		cycle: spec.cycle ? Object.freeze({ from: spec.cycle.from, to: spec.cycle.to }) : null,
		field: makeField(spec.field)
	});
}

// ─── the registry ──────────────────────────────────────────────────────────

const SPEC_BY_YEAR = new Map();
for (const spec of SPECS) {
	if (SPEC_BY_YEAR.has(spec.year)) throw new Error(`season ${spec.year} is registered twice`);
	SPEC_BY_YEAR.set(spec.year, spec);
}

// A track recorded before tracks carried their season has to be read on SOME
// field, and two seasons both claiming it would make that a coin toss.
const CLAIMANTS = SPECS.filter((s) => s.claimsUnstampedTracks === true);
if (CLAIMANTS.length > 1) {
	throw new Error(`more than one season claims unstamped tracks: ${CLAIMANTS.map((s) => s.year).join(', ')}`);
}

/** Every registered year, ascending. */
export const SEASON_YEARS = Object.freeze([...SPEC_BY_YEAR.keys()].sort((a, b) => a - b));

/** @type {Map<number, Season>} */
const BUILT = new Map();

/**
 * The season for a year, or null if this build does not have it.
 *
 * Built on first ask and memoised, so every caller holds the same object.
 *
 * @param {number} year
 * @returns {Season|null}
 */
export function seasonFor(year) {
	const y = Number(year);
	if (BUILT.has(y)) return BUILT.get(y);
	const spec = SPEC_BY_YEAR.get(y);
	if (!spec) return null;
	const season = buildSeason(spec);
	BUILT.set(y, season);
	return season;
}

/**
 * The season new recordings are made on.
 *
 * Throws rather than returning null: an unregistered CURRENT_SEASON is a
 * mistake in this build, not a state a scout can be in.
 *
 * @returns {Season}
 */
export function currentSeason() {
	const season = seasonFor(CURRENT_SEASON);
	if (!season) throw new Error(`CURRENT_SEASON ${CURRENT_SEASON} is not a registered season`);
	return season;
}

/**
 * The season a track with no season stamp was drawn on, or null if no
 * registered season claims them.
 *
 * @returns {Season|null}
 */
export function seasonForUnstamped() {
	return CLAIMANTS.length ? seasonFor(CLAIMANTS[0].year) : null;
}
