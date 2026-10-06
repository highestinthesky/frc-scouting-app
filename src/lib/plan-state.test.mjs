// The planning derivations, moved out of the schedule page so Plan and Run can
// share them. The page computed these inline and nothing tested them.

import {
	parseTeams,
	editorRows,
	scoutNames,
	findConflicts,
	matchWatchers,
	scoutRoster,
	scoutCounts
} from './plan-state.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const match = (n, red, blue) => ({
	match_number: n,
	key: `2026test_qm${n}`,
	alliances: {
		red: { team_keys: red.map((t) => `frc${t}`) },
		blue: { team_keys: blue.map((t) => `frc${t}`) }
	}
});

// ── parsing and shaping ────────────────────────────────────────────────────
ok('parseTeams reads commas and spaces', parseTeams('254, 1114 3419').join() === '254,1114,3419');
ok('parseTeams drops junk and zero', parseTeams('frc254, , 0, abc').join() === '254');
ok('parseTeams survives null', parseTeams(null).length === 0);
{
	const rows = editorRows([
		{ scout_name: 'Ning', team_number: 1114 },
		{ scout_name: 'Ada', team_number: 3419 },
		{ scout_name: 'Ning', team_number: 254 }
	]);
	ok('editorRows groups by scout, alphabetically', rows.map((r) => r.scout_name).join() === 'Ada,Ning');
	ok('editorRows sorts teams ascending', rows[1].teamsText === '254, 1114');
}
ok(
	'scoutNames is distinct, trimmed and sorted',
	scoutNames([{ scout_name: ' Ning ' }, { scout_name: 'Ada' }, { scout_name: 'Ning' }, { scout_name: '' }]).join() ===
		'Ada,Ning'
);

// ── conflicts ──────────────────────────────────────────────────────────────
{
	const qm = [match(1, [254, 1114, 3419], [1, 2, 3]), match(2, [254, 4, 5], [6, 7, 8])];
	const rows = [{ scout_name: 'Ada', teamsText: '254, 1114' }];
	const c = findConflicts(qm, rows, []);
	ok('two of a scout\'s teams in one match is a conflict', c.length === 1 && c[0].match === 1);
	ok('the conflict names both teams', c[0]?.teams.join() === '254,1114');
	ok('one team in a match is not a conflict', !c.some((x) => x.match === 2));

	const fixed = findConflicts(qm, rows, [{ match_number: 1, scout_name: 'ada', team_number: 254 }]);
	ok('an override for that match replaces the base and resolves it', fixed.length === 0);

	ok('no rows, no conflicts', findConflicts(qm, [], []).length === 0);
	ok('no schedule, no conflicts', findConflicts([], rows, []).length === 0);
}

// ── who is watching ────────────────────────────────────────────────────────
{
	const m = match(3, [254, 1114, 3419], [1, 2, 3]);
	const rows = [
		{ scout_name: 'Ada', teamsText: '254' },
		{ scout_name: 'Ning', teamsText: '1' }
	];
	const w = matchWatchers(m, rows, [{ match_number: 3, scout_name: 'Ning', team_number: 3419 }]);
	ok('six teams, red first', w.length === 6 && w[0].color === 'red' && w[5].color === 'blue');
	const byTeam = new Map(w.map((x) => [x.team, x.watchers]));
	ok('a base assignment watches its team', byTeam.get(254)?.[0]?.scout === 'Ada');
	ok('an override moves the scout', byTeam.get(3419)?.[0]?.viaOverride === true);
	ok('and takes them off their base team for that match', (byTeam.get(1) ?? []).length === 0);
	ok('no match, no rows', matchWatchers(null, rows, []).length === 0);
}

// ── roster ─────────────────────────────────────────────────────────────────
{
	const r = scoutRoster(
		[{ scout_name: 'Ning', teamsText: '254' }],
		[
			{ scoutName: 'ning', createdAt: '2026-03-01T10:00:00Z' },
			{ scoutName: 'Ning', createdAt: '2026-03-01T11:00:00Z' },
			{ scoutName: 'Ada', createdAt: '2026-03-01T09:00:00Z' }
		]
	);
	const ning = r.find((x) => x.name === 'Ning');
	ok('"Ning" and "ning" are one scout', r.length === 2 && ning?.count === 2);
	ok('assigned and recording both show', ning?.assigned === true && ning?.recording === true);
	ok('the latest entry wins', ning?.lastEntry === '2026-03-01T11:00:00Z');
	ok('a recorder who was never assigned is listed', r.some((x) => x.name === 'Ada' && !x.assigned));
}

// ── by scout ───────────────────────────────────────────────────────────────
{
	const roster = [
		{ profileId: 'p-ada', first_name: 'Ada', last_name: 'Lovelace' },
		{ profileId: 'p-rey', first_name: 'Rey', last_name: '' },
		{ profileId: 'p-kim', username: 'kim' }
	];
	const entries = [
		{ scoutName: 'Ada Lovelace', submittedBy: 'p-ada' },
		{ scoutName: 'someone else', submittedBy: 'p-ada' },
		{ scoutName: 'rey' },
		{ scoutName: 'Rey' },
		{ scoutName: 'Rey', submittedBy: 'p-other' }
	];
	const c = scoutCounts(roster, entries);
	const by = new Map(c.map((x) => [x.name, x.count]));
	ok('an account matches its own entries whatever name they carry', by.get('Ada Lovelace') === 2);
	ok('a typed name matches case-insensitively', by.get('Rey') === 2, `got ${by.get('Rey')}`);
	ok('an entry from another account is not credited by name', by.get('Rey') !== 3);
	ok('a scout with nothing is listed at zero, not dropped', by.get('kim') === 0);
	ok('fewest first', c[0].name === 'kim' && c[0].count === 0);
	ok(
		'every scout is NOT credited with every entry (the coverage bug)',
		!c.every((x) => x.count === entries.length)
	);
	ok('no roster, no rows', scoutCounts([], entries).length === 0);
}

console.log(fail === 0 ? `plan state: ${pass} passed` : `plan state: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
