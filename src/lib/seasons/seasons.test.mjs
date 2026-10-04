// Tests for the season loader.
//   node src/lib/seasons/seasons.test.mjs
//
// Two halves. The registry: which seasons this build has, which one records,
// and which one claims a track with no stamp. The validator: a season file is
// written once a year by someone reading a manual, and every rule buildSeason()
// enforces is a mistake that would otherwise reach an event as a recorder that
// quietly does the wrong thing. Each rule is broken once, alone, against a spec
// that is otherwise valid — so a throw can only be that rule's.

import {
	CURRENT_SEASON,
	SEASON_YEARS,
	seasonFor,
	currentSeason,
	seasonForUnstamped,
	buildSeason
} from './index.js';

let pass = 0;
let fail = 0;
function ok(label, cond) {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.error(`FAIL: ${label}`);
	}
}

// ─── the registry ──────────────────────────────────────────────────────────
{
	const s = seasonFor(2026);
	ok('2026 is registered', s !== null);
	ok('2026 is REBUILT', s.year === 2026 && s.name === 'REBUILT');
	ok('four actions, in spec order',
		s.actions.map((a) => a.key).join(',') === 'collect,score,fault,climb');
	ok('actionByKey finds each one', s.actions.every((a) => s.actionByKey[a.key] === a));
	ok('the endgame is the climb', s.endgame?.key === 'climb');
	ok('the fault action is fault', s.faultAction?.key === 'fault');
	ok('a cycle is collect then score', s.cycle?.from === 'collect' && s.cycle?.to === 'score');
	ok('auto is 15 seconds', s.autoMs === 15_000);
	ok('the field is built', typeof s.field.clampToStart === 'function' && s.field.LENGTH_IN === 651);

	ok('an unregistered year is null, not a guess', seasonFor(1234) === null);
	ok('no year is no season', seasonFor(null) === null && seasonFor(undefined) === null);
	ok('the current season is CURRENT_SEASON', currentSeason().year === CURRENT_SEASON);
	ok('2026 claims the unstamped tracks', seasonForUnstamped()?.year === 2026);
	ok('memoised: one object per year', seasonFor(2026) === seasonFor(2026));
	ok('and currentSeason is that object', currentSeason() === seasonFor(CURRENT_SEASON));
	ok('SEASON_YEARS lists 2026', SEASON_YEARS.includes(2026));
	ok('SEASON_YEARS is ascending',
		SEASON_YEARS.every((y, i) => i === 0 || SEASON_YEARS[i - 1] < y));

	ok('the season is frozen', Object.isFrozen(s));
	ok('its actions are frozen', Object.isFrozen(s.actions) && s.actions.every(Object.isFrozen));
	ok('its questions are frozen',
		Object.isFrozen(s.endgame.questions) && s.endgame.questions.every((q) => Object.isFrozen(q) && Object.isFrozen(q.options)));
	ok('its field is frozen', Object.isFrozen(s.field) && Object.isFrozen(s.field.OBSTACLES) && Object.isFrozen(s.field.OBSTACLES[0]));
}

// ─── the validator ─────────────────────────────────────────────────────────

/** A minimal spec that builds. Every case below breaks exactly one thing. */
const valid = () => ({
	year: 9001,
	name: 'MINIMAL',
	fieldVersion: 1,
	autoMs: 15_000,
	field: {
		lengthIn: 600,
		widthIn: 300,
		robotIn: 30,
		obstacles: [{ kind: 'rect', label: 'box', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }],
		features: [
			{ kind: 'rect', label: 'pad', look: 'landmark', x: 0.25, y: 0.5, w: 0.05, h: 0.1 },
			{ kind: 'line', label: 'centre line', look: 'dashed', x: 0.5 }
		],
		allianceBands: [],
		startDepth: 0.2,
		startBands: [
			{ label: 'Left', upTo: 0.5 },
			{ label: 'Right', upTo: 1 }
		]
	},
	actions: [
		{ key: 'grab', label: 'Grab', doing: 'Grabbing', hotkey: 'a', icon: 'collect', tone: 'accent' },
		{ key: 'place', label: 'Place', doing: 'Placing', hotkey: 's', icon: 'score', tone: 'success' },
		{ key: 'bumped', label: 'Bumped', doing: 'Bumped', hotkey: 'd', icon: null, tone: 'warning', role: 'fault' },
		{
			key: 'park',
			label: 'Park',
			doing: 'Parking',
			hotkey: 'f',
			icon: null,
			tone: 'accent',
			ends: true,
			questions: [
				{
					key: 'spot',
					ask: 'Where?',
					options: [
						{ value: 'near', label: 'Near', says: 'near' },
						{ value: 'far', label: 'Far', says: 'far' }
					]
				}
			]
		}
	],
	cycle: { from: 'grab', to: 'place' }
});

/** Assert `mutate(spec)` makes buildSeason throw, naming `mentions`. */
function rejects(label, mutate, mentions) {
	const spec = valid();
	mutate(spec);
	try {
		buildSeason(spec);
		ok(`${label}: throws`, false);
	} catch (e) {
		ok(`${label}: throws an Error`, e instanceof Error);
		ok(`${label}: names '${mentions}' (got "${e.message}")`, String(e.message).includes(mentions));
	}
}

{
	let built = null;
	try {
		built = buildSeason(valid());
	} catch (e) {
		console.error(e);
	}
	ok('the minimal spec builds', built !== null);
	ok('with no null icon turned into something else', built?.actionByKey.bumped.icon === null);
	ok('and its endgame and fault found', built?.endgame?.key === 'park' && built?.faultAction?.key === 'bumped');
	ok('a season with no cycle is allowed', (() => {
		const s = valid();
		s.cycle = null;
		return buildSeason(s).cycle === null;
	})());
	ok('a season with no start depth starts anywhere a robot can be', (() => {
		const s = valid();
		s.field.startDepth = null;
		const f = buildSeason(s).field;
		const p = f.clampToStart({ x: 0.9, y: 0.2 }, 'red');
		return f.STARTING_LINE === null && p.x === 0.9 && p.y === 0.2;
	})());
	ok('buildSeason does not register what it builds', seasonFor(9001) === null);
}

rejects('duplicate action key', (s) => (s.actions[1].key = 'grab'), 'grab');
rejects('duplicate hotkey', (s) => (s.actions[1].hotkey = 'a'), "'a'");
rejects('hotkey not a single lowercase letter', (s) => (s.actions[0].hotkey = 'A'), "'A'");
rejects('hotkey of two letters', (s) => (s.actions[0].hotkey = 'ab'), "'ab'");
rejects('hotkey a digit', (s) => (s.actions[0].hotkey = '1'), "'1'");
rejects('more than one ends action', (s) => (s.actions[0].ends = true), 'grab');
rejects('more than one fault action', (s) => (s.actions[0].role = 'fault'), 'grab');
for (const reserved of ['a', 't0', 't1']) {
	rejects(`question key '${reserved}'`, (s) => (s.actions[3].questions[0].key = reserved), `'${reserved}'`);
}
rejects('duplicate question key',
	(s) => s.actions[3].questions.push({ key: 'spot', ask: 'Again?', options: [] }), 'spot');
rejects('duplicate option value',
	(s) => (s.actions[3].questions[0].options[1].value = 'near'), 'near');
rejects('cycle.from not an action', (s) => (s.cycle.from = 'collect'), 'collect');
rejects('cycle.to not an action', (s) => (s.cycle.to = 'score'), 'score');
rejects('startBands empty', (s) => (s.field.startBands = []), 'startBands');
rejects('startBands not ascending',
	(s) => (s.field.startBands = [{ label: 'Left', upTo: 0.6 }, { label: 'Middle', upTo: 0.4 }, { label: 'Right', upTo: 1 }]),
	'Middle');
rejects('startBands last upTo not 1', (s) => (s.field.startBands[1].upTo = 0.9), 'Right');
rejects('autoMs zero', (s) => (s.autoMs = 0), 'autoMs');
rejects('autoMs negative', (s) => (s.autoMs = -15_000), 'autoMs');
rejects('autoMs not an integer', (s) => (s.autoMs = 15.5), 'autoMs');
rejects('autoMs a string', (s) => (s.autoMs = '15000'), 'autoMs');
rejects('unknown icon', (s) => (s.actions[0].icon = 'grab'), "icon 'grab'");
rejects('unknown tone', (s) => (s.actions[0].tone = 'danger'), 'danger');
rejects('unknown rect look', (s) => (s.field.features[0].look = 'dashed'), 'dashed');
rejects('unknown line look', (s) => (s.field.features[1].look = 'wall'), 'wall');
// Beyond the brief's list, and each for the same reason: a role or kind generic
// code does not recognise is silently ignored by it, which reads as a season
// whose fault never counts or whose landmark is never drawn.
rejects('year not an integer', (s) => (s.year = '2026'), 'year');
rejects('unknown action role', (s) => (s.actions[0].role = 'endgame'), 'endgame');
rejects('unknown question role', (s) => (s.actions[3].questions[0].role = 'best'), 'best');
rejects('unknown feature kind', (s) => (s.field.features[0].kind = 'circle'), 'circle');

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
