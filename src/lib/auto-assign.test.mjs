// Tests for the auto-assign algorithm.
//   node src/lib/auto-assign.test.mjs
//
// The point of these is coverage, not conflict counts. The old implementation
// reported a small "conflicts" number while quietly losing a fifth of all
// team-matches, so every assertion here is written against what actually gets
// scouted.

import { autoAssignTeams, evaluateCoverage } from './auto-assign.js';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
	if (cond) {
		pass += 1;
	} else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
}

/** Deterministic pseudo-random qual schedule: nTeams each playing `plays` matches. */
function schedule(nTeams, plays, seed = 7) {
	let s = seed;
	const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	const slots = [];
	for (let i = 0; i < nTeams; i++) for (let p = 0; p < plays; p++) slots.push(1000 + i);
	for (let i = slots.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[slots[i], slots[j]] = [slots[j], slots[i]];
	}
	const matches = [];
	for (let i = 0; i + 6 <= slots.length; i += 6) {
		const six = slots.slice(i, i + 6);
		if (new Set(six).size < 6) continue;
		matches.push({
			match_number: matches.length + 1,
			alliances: {
				red: { team_keys: six.slice(0, 3).map((t) => 'frc' + t) },
				blue: { team_keys: six.slice(3).map((t) => 'frc' + t) }
			}
		});
	}
	return matches;
}
const names = (n) => [...Array(n)].map((_, i) => 'Scout' + i);

// ─── shape ────────────────────────────────────────────────────────────────
{
	const qm = schedule(36, 12);
	const r = autoAssignTeams(qm, names(8));
	ok('every team is assigned exactly once', (() => {
		const seen = new Set();
		for (const [, list] of r.assignments) for (const t of list) {
			if (seen.has(t)) return false;
			seen.add(t);
		}
		return seen.size === r.teamCount && r.teamCount === 36;
	})());
	ok('load is balanced within one team', (() => {
		const n = [...r.assignments.values()].map((l) => l.length);
		return Math.max(...n) - Math.min(...n) <= 1;
	})(), JSON.stringify([...r.assignments.values()].map((l) => l.length)));
	ok('overrides only name real scouts', r.overrides.every((o) => names(8).includes(o.scout_name)));
	ok('overrides only reference teams playing that match', (() => {
		const byMatch = new Map(qm.map((m) => [m.match_number,
			new Set([...m.alliances.red.team_keys, ...m.alliances.blue.team_keys]
				.map((k) => +String(k).slice(3)))]));
		return r.overrides.every((o) => byMatch.get(o.match_number)?.has(o.team_number));
	})());
	ok('an override never gives a scout two robots in one match', (() => {
		const per = new Map();
		for (const o of r.overrides) {
			const k = `${o.match_number}:${o.scout_name}`;
			per.set(k, (per.get(k) ?? 0) + 1);
		}
		return [...per.values()].every((v) => v === 1);
	})());
}

// ─── determinism ──────────────────────────────────────────────────────────
{
	const qm = schedule(48, 12);
	const a = autoAssignTeams(qm, names(8));
	const b = autoAssignTeams(qm, names(8));
	ok('same schedule and scouts produce the same plan',
		JSON.stringify([...a.assignments]) === JSON.stringify([...b.assignments]));
	ok('scout order does not change the outcome', (() => {
		const c = autoAssignTeams(qm, [...names(8)].reverse());
		return c.coverage.scouted === a.coverage.scouted;
	})());
}

// ─── coverage: the thing that actually matters ────────────────────────────
for (const [nT, plays] of [[36, 12], [48, 12], [60, 10]]) {
	const qm = schedule(nT, plays);
	for (const nS of [6, 8, 12]) {
		const r = autoAssignTeams(qm, names(nS));
		ok(`${nT} teams / ${nS} scouts reaches full coverage`,
			r.coverage.pct === 100, `got ${r.coverage.pct.toFixed(1)}%`);
	}
	// Below six scouts full coverage is impossible — six robots play at once.
	// The algorithm should reach the ceiling and say it is limited.
	for (const nS of [3, 4, 5]) {
		const r = autoAssignTeams(qm, names(nS));
		ok(`${nT} teams / ${nS} scouts hits the ${((nS / 6) * 100).toFixed(0)}% ceiling`,
			Math.abs(r.coverage.pct - (nS / 6) * 100) < 0.01,
			`got ${r.coverage.pct.toFixed(1)}%, ceiling ${((nS / 6) * 100).toFixed(1)}%`);
		ok(`${nT} teams / ${nS} scouts is flagged as scout-limited`, r.ceiling.limited);
	}
}

// ─── base assignments alone still beat the old greedy ─────────────────────
{
	const qm = schedule(48, 12);
	const r = autoAssignTeams(qm, names(8), { generateOverrides: false });
	ok('overrides can be turned off', r.overrides.length === 0);
	// Base-only is a fallback that the app never ships on its own — the second
	// pass always runs. It is asserted purely so a regression in the colouring
	// can't hide behind the override pass papering over it.
	ok('base-only colouring still beats the old greedy 79.3%',
		r.coverage.pct > 80, `got ${r.coverage.pct.toFixed(1)}%`);
}

// ─── evaluateCoverage ─────────────────────────────────────────────────────
{
	const qm = [{
		match_number: 1,
		alliances: { red: { team_keys: ['frc1', 'frc2', 'frc3'] },
		             blue: { team_keys: ['frc4', 'frc5', 'frc6'] } }
	}];
	ok('unassigned teams count as uncovered',
		evaluateCoverage(qm, new Map([['A', [1]]])).scouted === 1);
	ok('one scout holding three teams in a match covers only one',
		evaluateCoverage(qm, new Map([['A', [1, 2, 3]]])).scouted === 1);
	ok('six scouts on six teams covers all six',
		evaluateCoverage(qm, new Map([['A', [1]], ['B', [2]], ['C', [3]],
			['D', [4]], ['E', [5]], ['F', [6]]])).scouted === 6);
	ok('an override reassigns the cell rather than adding to it',
		evaluateCoverage(qm, new Map([['A', [1, 2]], ['B', []]]),
			[{ match_number: 1, scout_name: 'B', team_number: 2 }]).scouted === 2);
	ok('empty input is 0%, not NaN', evaluateCoverage([], new Map()).pct === 0);
}

// ─── degenerate input ─────────────────────────────────────────────────────
{
	ok('no scouts returns empty', autoAssignTeams(schedule(36, 12), []).teamCount === 0);
	ok('no schedule returns empty', autoAssignTeams([], names(6)).teamCount === 0);
	ok('blank names are dropped', autoAssignTeams(schedule(24, 8), ['  ', 'Ann', '']).scoutCount === 1);
	ok('duplicate names collapse', autoAssignTeams(schedule(24, 8), ['Ann', 'Ann']).scoutCount === 1);
	// One scout physically cannot cover a 6-robot match, so this is about not
	// dropping teams on the floor, not about coverage.
	ok('one scout still receives every team that plays', (() => {
		const qm = schedule(24, 8);
		const playing = new Set();
		for (const m of qm) for (const k of [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys])
			playing.add(+String(k).slice(3));
		const r = autoAssignTeams(qm, ['Ann']);
		return r.assignments.get('Ann').length === playing.size && playing.size > 0;
	})());
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
