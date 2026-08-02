// Tests for reading TBA's alliances payload.
//   node src/lib/alliances.test.mjs
//
// The cost of being wrong here is asymmetric and immediate: showing a taken
// team as available wastes a captain's turn in front of a crowd, and showing an
// available team as taken loses the best robot left. Both happen in the ninety
// seconds between picks, with no chance to check.

import {
	teamNumberFromKey,
	standings,
	standingsByTeam,
	selectionStarted,
	partition,
	nextAvailable,
	describe
} from './alliances.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};
const eq = (name, actual, expected) =>
	ok(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

// A realistic mid-selection payload: four alliances seated, alliance 3 has one
// pick so far, and 1234 turned alliance 2 down.
const MID = [
	{ name: 'Alliance 1', picks: ['frc254', 'frc1678', 'frc2056'], declines: [] },
	{ name: 'Alliance 2', picks: ['frc118', 'frc971'], declines: ['frc1234'] },
	{ name: 'Alliance 3', picks: ['frc148'], declines: [] },
	{ name: 'Alliance 4', picks: ['frc33'], declines: [] }
];

// ─── teamNumberFromKey ─────────────────────────────────────────────────────
{
	eq('parses a team key', teamNumberFromKey('frc254'), 254);
	eq('is case insensitive', teamNumberFromKey('FRC254'), 254);
	eq('tolerates whitespace', teamNumberFromKey('  frc254 '), 254);
	eq('rejects a bare number', teamNumberFromKey('254'), null);
	eq('rejects an event key', teamNumberFromKey('2027nyny'), null);
	eq('rejects null', teamNumberFromKey(null), null);
	eq('rejects an empty string', teamNumberFromKey(''), null);
	// Leading zeros are not something TBA emits, but parsing them as a number
	// is the only reasonable reading if it ever does.
	eq('handles a padded number', teamNumberFromKey('frc0033'), 33);
}

// ─── standings ─────────────────────────────────────────────────────────────
{
	// 3 + 2 picks + 1 decline + 1 + 1 = 8.
	const s = standings(MID);
	eq('every seated and declined team appears', s.length, 8);

	const by = standingsByTeam(MID);

	// picks[0] is the captain, not a pick. Getting this wrong mislabels eight
	// teams at every event.
	eq('picks[0] is the captain', by.get(254).slot, 'captain');
	eq('picks[1] is the first pick', by.get(1678).slot, 'pick1');
	eq('picks[2] is the second pick', by.get(2056).slot, 'pick2');
	eq('alliance number is 1-based', by.get(254).alliance, 1);
	eq('...and tracks position in the array', by.get(33).alliance, 4);

	// A decline removes a team from selection without putting it on an alliance.
	eq('a declining team is recorded', by.get(1234).slot, 'declined');
	eq('...and belongs to no alliance', by.get(1234).alliance, 0);

	ok('a team not in the payload has no standing', !by.has(9999));
}

// Edge shapes TBA emits.
{
	eq('null means selection has not happened', standings(null).length, 0);
	eq('undefined is the same', standings(undefined).length, 0);
	eq('an empty array is the same', standings([]).length, 0);
	eq('a non-array is not a crash', standings({ nope: true }).length, 0);

	// Seen in practice: captains seated with no picks yet.
	const seatedOnly = [
		{ picks: ['frc254'], declines: [] },
		{ picks: ['frc118'] } // declines omitted entirely
	];
	eq('captains-only parses', standings(seatedOnly).length, 2);
	eq('a missing declines key is not a crash', standingsByTeam(seatedOnly).get(118).slot, 'captain');

	const missingPicks = [{ name: 'Alliance 1' }];
	eq('a missing picks key is not a crash', standings(missingPicks).length, 0);

	// Junk in the pick list is skipped rather than poisoning the map.
	const junk = [{ picks: ['frc254', null, 'not-a-key', 'frc118'], declines: [] }];
	const j = standings(junk);
	eq('unparseable keys are skipped', j.length, 2);
	// Position, not order of appearance, decides the slot. Compacting past a
	// hole would relabel a real backup as a first pick — a wrong answer stated
	// confidently, where "backup" is at least honest about the position we
	// could read. TBA's array is dense in practice; this is the safe reading if
	// it ever isn't.
	eq(
		'...and position still determines the slot',
		standingsByTeam(junk).get(118).slot,
		'backup'
	);

	// A fourth pick is a backup.
	const withBackup = [{ picks: ['frc1', 'frc2', 'frc3', 'frc4'], declines: [] }];
	eq('the fourth slot is a backup', standingsByTeam(withBackup).get(4).slot, 'backup');
	const withFive = [{ picks: ['frc1', 'frc2', 'frc3', 'frc4', 'frc5'], declines: [] }];
	eq('and so is anything past it', standingsByTeam(withFive).get(5).slot, 'backup');

	// TBA has emitted a team on two alliances mid-selection while a backup is
	// processed. The first standing is the one that took it out of the pool.
	const dupe = [
		{ picks: ['frc254'], declines: [] },
		{ picks: ['frc118', 'frc254'], declines: [] }
	];
	const d = standingsByTeam(dupe);
	eq('a duplicated team keeps its first standing', d.get(254).alliance, 1);
	eq('...and is counted once', standings(dupe).length, 2);
}

// ─── selectionStarted ──────────────────────────────────────────────────────
{
	ok('not started when TBA has nothing', !selectionStarted(null));
	ok('not started on an empty array', !selectionStarted([]));
	ok('not started when alliances exist but are empty', !selectionStarted([{ picks: [] }]));
	ok('started once a single captain is seated', selectionStarted([{ picks: ['frc254'] }]));
	ok('started mid-selection', selectionStarted(MID));
}

// ─── partition ─────────────────────────────────────────────────────────────
{
	const ranked = [
		{ teamNumber: 254 }, // captain of 1
		{ teamNumber: 9999 }, // free
		{ teamNumber: 1234 }, // declined
		{ teamNumber: 4321 }, // free
		{ teamNumber: 971 } // pick1 on 2
	];
	const by = standingsByTeam(MID);
	const { available, taken } = partition(ranked, by);

	eq(
		'available holds only the free teams',
		available.map((t) => t.teamNumber).join(),
		'9999,4321'
	);
	ok(
		'available preserves the caller ranking',
		available[0].teamNumber === 9999 && available[1].teamNumber === 4321
	);
	eq('taken holds the rest', taken.length, 3);

	// A declined team is NOT available. This is the rule most likely to be got
	// wrong, because "declined" sounds like "still out there".
	ok(
		'a declining team is taken, not available',
		taken.some((t) => t.teamNumber === 1234) &&
			!available.some((t) => t.teamNumber === 1234)
	);
	eq('taken rows carry their standing', taken.find((t) => t.teamNumber === 971).standing.slot, 'pick1');

	// Before selection, everything is available.
	const none = partition(ranked, standingsByTeam(null));
	eq('before selection nothing is taken', none.taken.length, 0);
	eq('...and everything is available', none.available.length, 5);

	eq('an empty team list is fine', partition([], by).available.length, 0);
}

// ─── nextAvailable ─────────────────────────────────────────────────────────
{
	const by = standingsByTeam(MID);
	const ranked = [{ teamNumber: 254 }, { teamNumber: 118 }, { teamNumber: 9999 }, { teamNumber: 4321 }];
	eq('skips taken teams to the first free one', nextAvailable(ranked, by).teamNumber, 9999);
	eq('returns null when everything is taken', nextAvailable([{ teamNumber: 254 }], by), null);
	eq('returns null on an empty list', nextAvailable([], by), null);
	eq(
		'before selection it is simply the top of the list',
		nextAvailable(ranked, standingsByTeam(null)).teamNumber,
		254
	);
}

// ─── describe ──────────────────────────────────────────────────────────────
{
	const by = standingsByTeam(MID);
	eq('captain reads naturally', describe(by.get(254)), 'captain of 1');
	eq('first pick reads naturally', describe(by.get(1678)), '1st pick, alliance 1');
	eq('second pick reads naturally', describe(by.get(2056)), '2nd pick, alliance 1');
	eq('a decline says so', describe(by.get(1234)), 'declined');
	eq(
		'a backup says so',
		describe(standingsByTeam([{ picks: ['frc1', 'frc2', 'frc3', 'frc4'] }]).get(4)),
		'backup on 1'
	);
	eq('an absent standing is empty, not "undefined"', describe(undefined), '');
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
