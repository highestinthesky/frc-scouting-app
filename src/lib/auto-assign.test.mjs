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
	ok('shedding a team also pins the scout who shed it', (() => {
		// If a match has any override at all, every scout in that match whose
		// effective list changed must have their own row — otherwise the team
		// was given away without being taken back.
		const byMatch = new Map();
		for (const o of r.overrides) {
			if (!byMatch.has(o.match_number)) byMatch.set(o.match_number, new Set());
			byMatch.get(o.match_number).add(o.scout_name);
		}
		const owner = new Map();
		for (const [s, ts] of r.assignments) for (const t of ts) owner.set(t, s);
		for (const m of qm) {
			const scoutsHere = byMatch.get(m.match_number);
			if (!scoutsHere) continue;
			const playing = [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys]
				.map((k) => +String(k).slice(3));
			const baseCount = new Map();
			for (const t of playing) {
				const s = owner.get(t);
				if (s) baseCount.set(s, (baseCount.get(s) ?? 0) + 1);
			}
			for (const [s, n] of baseCount) if (n > 1 && !scoutsHere.has(s)) return false;
		}
		return true;
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

// ─── the app's own conflict logic must agree ──────────────────────────────
//
// Regression guard. The first version of the repair pass handed a shed team to
// an idle scout but never took it off the original scout, who is still told to
// watch two robots — an override REPLACES a scout's list for a match, it does
// not add to it. It went unnoticed because evaluateCoverage resolved per
// (match, team) rather than per (match, scout), so the evaluator and the bug
// shared a mental model and the tests agreed with both.
//
// This mirrors the route's coverageConflicts exactly, independently of
// auto-assign.js, so the two can't drift back into agreeing wrongly.
function conflictsLikeTheApp(qmList, assignments, overrides) {
	const baseByScout = new Map([...assignments].map(([s, ts]) => [s, new Set(ts)]));
	const key = (m, s) => `${m}:${String(s ?? '').trim().toLowerCase()}`;
	const ovMap = new Map();
	for (const o of overrides) {
		const k = key(o.match_number, o.scout_name);
		if (!ovMap.has(k)) ovMap.set(k, new Set());
		ovMap.get(k).add(Number(o.team_number));
	}
	let n = 0;
	for (const m of qmList) {
		const playing = new Set();
		for (const arr of [m.alliances?.red?.team_keys ?? [], m.alliances?.blue?.team_keys ?? []])
			for (const k of arr) playing.add(parseInt(String(k).replace(/^frc/, ''), 10));
		for (const [scout, baseSet] of baseByScout) {
			const ov = ovMap.get(key(m.match_number, scout));
			const eff =
				ov && ov.size > 0
					? [...ov].filter((t) => playing.has(t))
					: [...baseSet].filter((t) => playing.has(t));
			if (eff.length >= 2) n += 1;
		}
	}
	return n;
}

for (const [nT, plays] of [[34, 12], [36, 12], [48, 12], [60, 10]]) {
	const qm = schedule(nT, plays);
	for (const nS of [6, 8, 11, 12]) {
		const r = autoAssignTeams(qm, names(nS));
		ok(`${nT} teams / ${nS} scouts leaves no double-booked scout`,
			conflictsLikeTheApp(qm, r.assignments, r.overrides) === 0,
			`${conflictsLikeTheApp(qm, r.assignments, r.overrides)} conflicts`);
		ok(`${nT} teams / ${nS} scouts — evaluator agrees with the app`,
			r.coverage.conflicts === conflictsLikeTheApp(qm, r.assignments, r.overrides));
	}
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

// ─── incremental runs: keep what's in place ───────────────────────────────
//
// Re-running auto-assign mid-event used to redistribute everything. One scout
// goes home and all forty teams change hands, so every remaining scout is
// handed a new list between matches. Passing `current` keeps the plan and
// moves only what has to move.
{
	const qm = schedule(48, 12);
	const base = autoAssignTeams(qm, names(9));
	const owner = (r) => {
		const m = new Map();
		for (const [s, list] of r.assignments) for (const t of list) m.set(t, s);
		return m;
	};
	const before = owner(base);
	const movedFrom = (r) =>
		[...owner(r)].filter(([t, s]) => before.has(t) && before.get(t) !== s).length;

	ok('a fresh run reports itself as not incremental', base.churn.incremental === false);

	{
		const r = autoAssignTeams(qm, names(9), { current: base.assignments });
		ok('re-running with no roster change moves nothing',
			movedFrom(r) === 0, `${movedFrom(r)} teams moved`);
		ok('...and says so', r.churn.moved === 0 && r.churn.kept === r.teamCount);
		ok('...and is flagged incremental', r.churn.incremental === true);
	}

	{
		// One scout leaves. Only their teams should move.
		const roster = names(9).slice(0, 8);
		const gone = autoAssignTeams(qm, roster, { current: base.assignments });
		const naive = autoAssignTeams(qm, roster);
		const orphaned = base.assignments.get('Scout8').length;

		ok('a departing scout moves only their own teams',
			movedFrom(gone) === orphaned,
			`${movedFrom(gone)} moved, ${orphaned} were theirs`);
		ok('which is far less churn than a fresh run',
			movedFrom(gone) < movedFrom(naive) / 3,
			`incremental ${movedFrom(gone)} vs fresh ${movedFrom(naive)}`);
		ok('and coverage is not sacrificed for stability',
			gone.coverage.pct === 100, `got ${gone.coverage.pct.toFixed(1)}%`);
		ok('and nobody is double-booked', gone.coverage.conflicts === 0);
		ok('the departed scout holds nothing', !gone.assignments.has('Scout8'));
	}

	{
		// A scout arrives. They should be given work off the others, and the
		// others should keep most of theirs.
		const roster = [...names(9), 'Scout9'];
		const r = autoAssignTeams(qm, roster, { current: base.assignments });
		ok('an arriving scout is given teams', (r.assignments.get('Scout9') ?? []).length > 0);
		ok('taking work off others, not reshuffling everyone',
			movedFrom(r) <= Math.ceil(48 / 10) + 1, `${movedFrom(r)} moved`);
		ok('load stays balanced after an arrival', (() => {
			const n = [...r.assignments.values()].map((l) => l.length);
			return Math.max(...n) - Math.min(...n) <= 1;
		})(), JSON.stringify([...r.assignments.values()].map((l) => l.length)));
		ok('coverage still full', r.coverage.pct === 100);
	}

	{
		// Stale input must not corrupt the plan.
		const withGhosts = new Map(base.assignments);
		withGhosts.set('Ghost', [1000, 1001]);          // a scout no longer on the roster
		withGhosts.set('Scout0', [...base.assignments.get('Scout0'), 999999]); // a team not at this event
		const r = autoAssignTeams(qm, names(9), { current: withGhosts });
		ok('a team held by a departed scout is reassigned, not lost', (() => {
			const all = new Set();
			for (const [, l] of r.assignments) for (const t of l) all.add(t);
			return all.size === r.teamCount;
		})());
		ok('a team that does not play here is dropped', (() => {
			for (const [, l] of r.assignments) if (l.includes(999999)) return false;
			return true;
		})());
		ok('coverage survives stale input', r.coverage.pct === 100);
	}

	{
		// An empty `current` is the same as no `current`.
		const r = autoAssignTeams(qm, names(9), { current: new Map() });
		ok('an empty current is treated as a fresh run', r.churn.incremental === false);
		ok('a plain object works as well as a Map', (() => {
			const asObj = Object.fromEntries(base.assignments);
			const x = autoAssignTeams(qm, names(9), { current: asObj });
			return x.churn.incremental === true && x.churn.moved === 0;
		})());
	}
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
