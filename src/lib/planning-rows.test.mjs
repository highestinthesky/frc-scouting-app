// Tests for the payload a manager's planning write actually sends.
//   node src/lib/planning-rows.test.mjs
//
// scout-identity.js proves the identity RULE. This proves the call sites apply
// it — that a saved assignment really does carry the account, and that a
// broadcast reminder really does stay a broadcast.

import { assignmentRows, overrideRows, reminderTarget, refFor, orphanedOverrides} from './planning-rows.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

const roster = [
	{ id: 'u1', username: 'ning', first_name: 'Haolun', last_name: 'Ning' },
	{ id: 'u2', username: 'alexr', first_name: 'Alex', last_name: 'Rivera' },
	{ id: 'u3', username: 'alexb', first_name: 'Alex', last_name: 'Brown' }
];
const ctx = { sessionId: 'sid-1', eventCode: 'evt', roster };

// ─── assignments ────────────────────────────────────────────────────────────
{
	const [row] = assignmentRows([{ scout_name: 'Ning', team_number: 3419 }], ctx);
	ok('an assignment carries the account', row.profile_id === 'u1');
	// One key since 0020. This asserted both columns during 0019's expand window;
	// session_id is gone from the schema now, so asserting it would pin a column
	// that no longer exists.
	ok('an assignment carries the event id', row.event_id === 'sid-1', String(row.event_id));
	ok('and carries no session_id', !('session_id' in row));
	ok('an assignment still carries the name', row.scout_name === 'Ning');
	ok('an assignment carries the event scope', row.event_id === 'sid-1' && row.event_code === 'evt');
	ok('the team number is a number', row.team_number === 3419);

	// The whole point: this is the column 0010 added and nothing filled.
	const [unmatched] = assignmentRows([{ scout_name: 'Nobody', team_number: 1 }], ctx);
	ok('an unknown name writes a null account', unmatched.profile_id === null);
	ok('and still writes the name, because that is what joins today', unmatched.scout_name === 'Nobody');

	const [ambiguous] = assignmentRows([{ scout_name: 'Alex', team_number: 1 }], ctx);
	ok('an ambiguous name refuses to guess', ambiguous.profile_id === null);

	// No roster is the offline manager, and must not be a failure.
	const [offline] = assignmentRows([{ scout_name: 'Ning', team_number: 1 }], {
		sessionId: 'sid-1',
		eventCode: 'evt'
	});
	ok('with no roster the row still saves', offline.scout_name === 'Ning');
	ok('with no roster the account is null', offline.profile_id === null);

	ok('a blank scout is dropped', assignmentRows([{ scout_name: '  ', team_number: 1 }], ctx).length === 0);
	ok('a junk team is dropped', assignmentRows([{ scout_name: 'Ning', team_number: 0 }], ctx).length === 0);
	ok('a non-numeric team is dropped', assignmentRows([{ scout_name: 'Ning', team_number: 'x' }], ctx).length === 0);
	ok('no rows is not a crash', assignmentRows(null, ctx).length === 0);
}

// ─── per-match overrides ────────────────────────────────────────────────────
{
	const [row] = overrideRows(
		[{ match_number: 7, scout_name: 'alex rivera', team_number: 254 }],
		ctx
	);
	ok('an override carries the account', row.profile_id === 'u2');
	ok('an override resolves a full name case-insensitively', row.scout_name === 'alex rivera');
	ok('an override carries its match', row.match_number === 7);

	ok(
		'an override with no match is dropped',
		overrideRows([{ scout_name: 'Ning', team_number: 1 }], ctx).length === 0
	);
	ok(
		'an override with a blank scout is dropped',
		overrideRows([{ match_number: 1, scout_name: '', team_number: 1 }], ctx).length === 0
	);
}

// ─── reminders ──────────────────────────────────────────────────────────────
{
	const targeted = reminderTarget('Ning', roster);
	ok('a targeted reminder carries the account', targeted.profile_id === 'u1');
	ok('a targeted reminder carries the name', targeted.scout_name === 'Ning');

	// The trap: '' is not null, and an empty scout_name would stop being a
	// broadcast without stopping being falsy anywhere obvious.
	for (const [label, input] of [
		['no name', ''],
		['whitespace', '   '],
		['null', null],
		['undefined', undefined]
	]) {
		const b = reminderTarget(input, roster);
		ok(`a reminder with ${label} stays a broadcast`, b.scout_name === null);
		ok(`and its account is null too (${label})`, b.profile_id === null);
	}
}

// ─── resolution is shared, not re-derived ──────────────────────────────────
{
	ok('refFor resolves through the roster', refFor('ning', roster).profileId === 'u1');
	ok('refFor keeps the typed spelling', refFor('  Ning ', roster).label === 'Ning');
	ok('refFor without a roster yields no account', refFor('ning').profileId === null);
}

// ─── orphanedOverrides ──────────────────────────────────────────────────────
//
// From a real finding on production: nine override names left over from an
// earlier test season — Brian, Charlie, Haolun, Jayden, Josh, Maddie, Michelle,
// Miles, Sunny — none matching an account or a current assignment.
//
// Not a coverage bug: evaluateCoverage() iterates scouts who HAVE assignments
// and looks their overrides up by key, so a row for nobody is never consulted.
// Checked, because the opposite was the obvious assumption.
//
// A DORMANCY bug. The key is a lowercased name, so the day a real scout called
// Josh joins, a year-old row starts overriding their real assignment and
// nothing says why. The last case below is the one that guards that.
{
	const roster3 = [{ username: 'rey', first_name: 'Rey', last_name: 'Ortiz' }];

	const one = orphanedOverrides([{ scout_name: 'Brian' }], [{ scout_name: 'Alex Wang' }], []);
	ok('an override for nobody is reported', one.length === 1 && one[0].scout === 'Brian');

	ok(
		'an override for an assigned scout is not an orphan',
		orphanedOverrides([{ scout_name: 'Alex Wang' }], [{ scout_name: 'Alex Wang' }], []).length === 0
	);

	// A manager may write a per-match override before assigning a base list.
	// Calling that an orphan would flag legitimate planning.
	ok(
		'an account holder with no assignment yet is still reachable',
		orphanedOverrides([{ scout_name: 'Rey Ortiz' }], [], roster3).length === 0
	);
	ok(
		'a username matches, not just a full name',
		orphanedOverrides([{ scout_name: 'rey' }], [], roster3).length === 0
	);

	// The account is the identity; the name is only the join key.
	ok(
		'a row carrying a profile_id is reachable whatever its name says',
		orphanedOverrides(
			[{ scout_name: 'typo', profile_id: 'uuid-1' }],
			[{ scout_name: 'Alex Wang' }],
			[]
		).length === 0
	);

	ok(
		'matching is case- and space-insensitive, like every other join',
		orphanedOverrides([{ scout_name: '  ALEX WANG ' }], [{ scout_name: 'alex wang' }], []).length === 0
	);

	const grouped = orphanedOverrides(
		[{ scout_name: 'Josh' }, { scout_name: 'Josh' }, { scout_name: 'Miles' }],
		[{ scout_name: 'Alex Wang' }],
		[]
	);
	ok(
		'rows are grouped per scout and counted, most first',
		grouped.length === 2 && grouped[0].scout === 'Josh' && grouped[0].count === 2
	);

	// The dormancy guard. Prefix matching would attach a stale "Josh" row to
	// Joshua Dai and silently override the assignments of a real person.
	ok(
		'"Josh" is not "Joshua Dai" — a prefix is a different person',
		orphanedOverrides([{ scout_name: 'Josh' }], [{ scout_name: 'Joshua Dai' }], []).length === 1
	);

	ok(
		'an empty name is skipped rather than reported',
		orphanedOverrides([{ scout_name: '   ' }], [{ scout_name: 'Alex Wang' }], []).length === 0
	);
	ok(
		'empty input does not throw',
		orphanedOverrides(null, null, null).length === 0
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
