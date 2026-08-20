// Who is watching which robot, per match.
//
// There was no test file for tba.js at all, and the function these cover had a
// second, disagreeing implementation on the Home page: it intersected the base
// assignment with the match roster and never consulted overrides, so a scout
// whose clash had been resolved still saw both robots.
//
// What these protect:
//
//   · An override REPLACES the base list for the match it names — it does not
//     add to it. Adding would leave the clash it was generated to resolve.
//   · An override is addressed to a person, and `scout_name` is a join key, not
//     a label. sameScout() decides; nothing here compares raw strings.
//   · Two teams surviving resolution is a real unresolved clash and must stay
//     visible. auto-assign.js counts one of them as lost coverage, so quietly
//     dropping it here would make the app disagree with its own coverage page.

import { myMatches, nextUnscoutedMatch } from './tba.js';
import { scoutRef } from './scout-identity.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

/** A qual match with the given red/blue teams. */
const qm = (n, red, blue) => ({
	match_number: n,
	comp_level: 'qm',
	alliances: {
		red: { team_keys: red.map((t) => `frc${t}`) },
		blue: { team_keys: blue.map((t) => `frc${t}`) }
	}
});

const ME = scoutRef('Ning');
const sched = [
	qm(1, [111, 222, 333], [444, 555, 666]),
	qm(2, [111, 777, 888], [999, 101, 102]),
	qm(3, [222, 333, 103], [104, 105, 106])
];

// ── base assignment only ───────────────────────────────────────────────────
{
	const rows = myMatches(sched, [], { assignedTeams: [111], overrides: [], scout: ME });
	ok('only matches containing my teams appear', rows.length === 2);
	ok('and they are in schedule order',
		rows[0].match.match_number === 1 && rows[1].match.match_number === 2);
	ok('a single assigned team resolves to itself',
		rows[0].teams.length === 1 && rows[0].teams[0] === 111);

	const none = myMatches(sched, [], { assignedTeams: [42424], overrides: [], scout: ME });
	ok('a team that never plays yields no rows', none.length === 0);
}

// ── the clash, and the override that resolves it ───────────────────────────
{
	// 222 and 333 are both in Q1 and both in Q3. One person, two robots.
	const clash = myMatches(sched, [], { assignedTeams: [222, 333], overrides: [], scout: ME });
	ok('an unresolved clash keeps BOTH teams visible',
		clash[0].teams.length === 2 && clash[0].teams.join() === '222,333');

	// The override names one robot for Q1. It must REPLACE, not extend.
	const overrides = [{ match_number: 1, scout_name: 'Ning', team_number: 333 }];
	const fixed = myMatches(sched, [], { assignedTeams: [222, 333], overrides, scout: ME });
	const q1 = fixed.find((r) => r.match.match_number === 1);
	const q3 = fixed.find((r) => r.match.match_number === 3);
	ok('an override replaces the base list for the match it names',
		q1.teams.length === 1 && q1.teams[0] === 333);
	ok('and leaves other matches on the base list',
		q3.teams.length === 2 && q3.teams.join() === '222,333');
}

// ── an override is addressed to a person ───────────────────────────────────
{
	const base = { assignedTeams: [222, 333], scout: ME };
	const other = [{ match_number: 1, scout_name: 'Someone Else', team_number: 333 }];
	const q1 = myMatches(sched, [], { ...base, overrides: other })
		.find((r) => r.match.match_number === 1);
	ok("another scout's override does not apply to me", q1.teams.length === 2);

	// scout_name is a join key: case and padding are the same person.
	const sloppy = [{ match_number: 1, scout_name: '  ning  ', team_number: 333 }];
	const mine = myMatches(sched, [], { ...base, overrides: sloppy })
		.find((r) => r.match.match_number === 1);
	ok('my own override matches me regardless of case or padding',
		mine.teams.length === 1 && mine.teams[0] === 333);
}

// ── an override naming a team that is not in that match is ignored ─────────
{
	const bogus = [{ match_number: 1, scout_name: 'Ning', team_number: 999 }];
	const q1 = myMatches(sched, [], { assignedTeams: [222, 333], overrides: bogus, scout: ME })
		.find((r) => r.match.match_number === 1);
	ok('an override for a team not playing that match falls back to the base list',
		q1.teams.length === 2);
}

// ── recorded entries mark a match done ─────────────────────────────────────
{
	const entries = [{ matchNumber: 1, teamNumber: 111 }];
	const rows = myMatches(sched, entries, { assignedTeams: [111], overrides: [], scout: ME });
	ok('a recorded match reports done', rows[0].done === true && rows[0].pending.length === 0);
	ok('and still lists the team it covered', rows[0].teams[0] === 111);
	ok('a later unrecorded match is still pending', rows[1].done === false);
}

// ── nextUnscoutedMatch is the same answer, first pending row ───────────────
{
	const entries = [{ matchNumber: 1, teamNumber: 111 }];
	const next = nextUnscoutedMatch(sched, entries, {
		assignedTeams: [111], overrides: [], scout: ME
	});
	ok('nextUnscoutedMatch skips what is already recorded', next?.match.match_number === 2);

	const all = nextUnscoutedMatch(
		sched,
		[{ matchNumber: 1, teamNumber: 111 }, { matchNumber: 2, teamNumber: 111 }],
		{ assignedTeams: [111], overrides: [], scout: ME }
	);
	ok('and returns null when everything is recorded', all === null);

	// The legacy array form must keep working — assignments.js still passes it.
	const legacy = nextUnscoutedMatch(sched, [], [111]);
	ok('the legacy number[] argument still resolves', legacy?.match.match_number === 1);
}

// ── junk in, empty out ─────────────────────────────────────────────────────
{
	ok('no schedule is an empty list', myMatches([], [], { assignedTeams: [111], scout: ME }).length === 0);
	ok('junk schedule is an empty list', myMatches(null, [], { assignedTeams: [111], scout: ME }).length === 0);
	ok('no assignment is an empty list', myMatches(sched, [], { assignedTeams: [], scout: ME }).length === 0);
}

console.log(fail === 0 ? `tba teams: ${pass} passed` : `tba teams: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
