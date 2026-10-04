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
	buildSeason,
	chipLetter
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

// ─── the throwaway ─────────────────────────────────────────────────────────
// 1999 is registered so the framework has a season that is unlike 2026 in every
// way it claims to support. Nothing selects it; these tests are its only caller.
{
	ok('every registered season builds', SEASON_YEARS.every((y) => seasonFor(y) !== null));

	const t = seasonFor(1999);
	ok('1999 is registered', t !== null && t.year === 1999 && t.name === 'THROWAWAY');
	ok('and does not claim the unstamped tracks', seasonForUnstamped()?.year === 2026 && t.claimsUnstampedTracks === false);
	ok('and is not the current season', CURRENT_SEASON !== 1999);
	ok('five actions', t.actions.length === 5);
	ok('on keys 2026 does not use', t.actions.map((a) => a.key).join(',') === 'grab,place,bumped,defend,park');
	ok('the endgame is park', t.endgame?.key === 'park');
	ok('the fault action is bumped', t.faultAction?.key === 'bumped');
	ok('a cycle is grab then place', t.cycle?.from === 'grab' && t.cycle?.to === 'place');
	ok('auto is 20 seconds', t.autoMs === 20_000);
	ok('most actions have no icon', t.actions.filter((a) => a.icon === null).length === 4);
	ok('and each draws its own letter',
		t.actions.filter((a) => a.icon === null).map(chipLetter).join('') === 'GPDK');

	const f = t.field;
	ok('the field is squarer', Math.abs(f.FIELD_ASPECT - 480 / 360) < 1e-9 && Math.abs(f.FIELD_ASPECT - 1.333) < 1e-3);
	ok('there is no starting line', f.STARTING_LINE === null);

	// No start depth: a start is only as constrained as any other position.
	const far = f.clampToStart({ x: 0.9, y: 0.5 }, 'red');
	ok('a red start is not pulled back toward its wall', far.x === 0.9 && far.y === 0.5);
	const blueNear = f.clampToStart({ x: 0.1, y: 0.5 }, 'blue');
	ok('nor is a blue one pulled back toward its own', blueNear.x === 0.1 && blueNear.y === 0.5);

	// Half a robot either side of the pillar's own edges.
	const hw = 0.06 / 2 + 30 / 480 / 2;
	const hh = 0.08 / 2 + 30 / 360 / 2;
	const pushed = f.clampToStart({ x: 0.35, y: 0.3 }, 'red');
	ok('a start inside the pillar is pushed out of it',
		Math.abs(pushed.x - 0.35) >= hw - 1e-9 || Math.abs(pushed.y - 0.3) >= hh - 1e-9);
	const pushed2 = f.clampToField({ x: 0.35, y: 0.3 });
	ok('and so is any other position',
		Math.abs(pushed2.x - 0.35) >= hw - 1e-9 || Math.abs(pushed2.y - 0.3) >= hh - 1e-9);
	const clear = f.clampToField({ x: 0.1, y: 0.9 });
	ok('a position clear of everything stays put', clear.x === 0.1 && clear.y === 0.9);

	// Same y, read from opposite ends: what is on red's left is on blue's right.
	ok('y = 0.1 is far left for red', f.startZone({ x: 0.5, y: 0.1 }, 'red') === 'Far left');
	ok('y = 0.1 is far right for blue', f.startZone({ x: 0.5, y: 0.1 }, 'blue') === 'Far right');
	ok('four bands, not three', new Set([0.1, 0.35, 0.65, 0.9].map((y) => f.startZone({ x: 0.5, y }, 'red'))).size === 4);

	ok('its obstacles are not mirrored', f.OBSTACLES[0].x !== 1 - f.OBSTACLES[1].x && f.OBSTACLES[0].y !== f.OBSTACLES[1].y);
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

// What a render reads without checking. Each of these is a blank button, a chip
// drawn as nothing or a sheet with nothing to tap — or a throw mid-render on
// the field, which is the worst place a season file can be wrong.
rejects('action label empty', (s) => (s.actions[0].label = ''), "action 'grab' label");
rejects('action label missing', (s) => delete s.actions[0].label, "action 'grab' label");
rejects('action label whitespace', (s) => (s.actions[0].label = '  '), "action 'grab' label");
rejects('action doing empty', (s) => (s.actions[1].doing = ''), "action 'place' doing");
rejects('action doing not a string', (s) => (s.actions[1].doing = 7), "action 'place' doing");
rejects('question ask empty', (s) => (s.actions[3].questions[0].ask = ''), "question 'spot' ask");
rejects('option label empty', (s) => (s.actions[3].questions[0].options[0].label = ''), 'option "near" label');
rejects('option says missing', (s) => delete s.actions[3].questions[0].options[1].says, 'option "far" says');
rejects('question with no options', (s) => (s.actions[3].questions[0].options = []), "'spot' has no options");
rejects('question with options missing', (s) => delete s.actions[3].questions[0].options, "'spot' has no options");
rejects('a level option that is not a number',
	(s) => (s.actions[3].questions[0].role = 'level'), 'option "near" is not a number');
rejects('two questions of one role on an action', (s) => {
	s.actions[3].questions[0].role = 'outcome';
	s.actions[3].questions.push({ key: 'ok', ask: 'Did it?', role: 'outcome',
		options: [{ value: true, label: 'Yes', says: 'did' }] });
}, "more than one 'outcome' question ('ok')");
ok('two questions with no role on one action are fine', (() => {
	const s = valid();
	s.actions[3].questions.push({ key: 'side', ask: 'Which side?',
		options: [{ value: 'L', label: 'L', says: 'left' }] });
	return buildSeason(s).actionByKey.park.questions.length === 2;
})());

for (const dim of ['lengthIn', 'widthIn', 'robotIn']) {
	rejects(`field.${dim} zero`, (s) => (s.field[dim] = 0), `field.${dim}`);
	rejects(`field.${dim} negative`, (s) => (s.field[dim] = -30), `field.${dim}`);
	rejects(`field.${dim} a string`, (s) => (s.field[dim] = '300'), `field.${dim}`);
	rejects(`field.${dim} missing`, (s) => delete s.field[dim], `field.${dim}`);
}
rejects('startDepth zero', (s) => (s.field.startDepth = 0), 'startDepth');
rejects('startDepth a half', (s) => (s.field.startDepth = 0.5), 'startDepth');
rejects('startDepth negative', (s) => (s.field.startDepth = -0.1), 'startDepth');
rejects('startDepth a string', (s) => (s.field.startDepth = '0.2'), 'startDepth');
rejects('startDepth missing', (s) => delete s.field.startDepth, 'startDepth');

// ─── letter chips ──────────────────────────────────────────────────────────
// An action with no icon is drawn as one character. Two that would draw the
// same are two different things a robot is doing, indistinguishable on the
// field — so it is a build failure, and `letter` is the way out.
{
	const b = buildSeason(valid());
	ok('an icon-less action draws the first letter of its label', chipLetter(b.actionByKey.bumped) === 'B');
	ok('upper-cased', chipLetter({ label: 'park' }) === 'P');
	ok('its own letter wins when it has one', chipLetter({ label: 'Park', letter: 'K' }) === 'K');
	ok('the letter survives the build', (() => {
		const s = valid();
		s.actions[3].letter = 'K';
		return chipLetter(buildSeason(s).actionByKey.park) === 'K';
	})());
	ok('an action WITH an icon may share a letter with one without', (() => {
		const s = valid();
		s.actions[0].label = 'Bump'; // grab keeps its collect icon
		return buildSeason(s) !== null;
	})());
}
rejects('two icon-less actions on one letter', (s) => {
	s.actions[0].icon = null;
	s.actions[0].label = 'Bump';
}, "'bumped' would both be drawn as 'B'");
rejects('a letter that collides', (s) => (s.actions[3].letter = 'B'), "'park' would both be drawn as 'B'");
rejects('a letter of two characters', (s) => (s.actions[3].letter = 'PK'), "action 'park' letter");
rejects('an empty letter', (s) => (s.actions[3].letter = ''), "action 'park' letter");
rejects('a letter that is not a string', (s) => (s.actions[3].letter = 7), "action 'park' letter");

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
