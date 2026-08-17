// Tests for parsing a pasted roster.
//   node src/lib/roster.test.mjs
//
// The input is other people's spreadsheets, so the shapes below are not
// hypothetical: a team keeps its roster in a Google Sheet, a Discord message or
// a printout, and whatever comes out of those is what a manager pastes at 8am on
// the morning of an event. Anything this rejects is a person who does not get an
// invite.

import { parseRoster, formatRosterName } from './roster.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

const names = (r) => r.people.map((p) => `${p.firstName}|${p.lastName}`);

// ─── the ordinary case ──────────────────────────────────────────────────────
{
	const r = parseRoster('Haolun Ning\nAda Lovelace\nRey Ortiz');
	ok('one name per line', r.people.length === 3, JSON.stringify(names(r)));
	ok('first and last are split', names(r)[0] === 'Haolun|Ning');
	ok('nothing is rejected', r.problems.length === 0, JSON.stringify(r.problems));
}

// ─── the shapes a spreadsheet actually produces ─────────────────────────────
{
	// Trailing blank lines, Windows line endings, and the stray comma a CSV
	// column leaves behind.
	const r = parseRoster('Haolun Ning\r\n\r\nAda Lovelace,\n  Rey Ortiz  \n\n');
	ok('blank lines are skipped', r.people.length === 3, JSON.stringify(names(r)));
	ok('CRLF is handled', names(r)[0] === 'Haolun|Ning');
	ok('a trailing comma is not part of the name', names(r)[1] === 'Ada|Lovelace');
	ok('surrounding whitespace is trimmed', names(r)[2] === 'Rey|Ortiz');
}

{
	// "Last, First" is what a sorted spreadsheet column looks like.
	const r = parseRoster('Ning, Haolun\nLovelace, Ada');
	ok('"Last, First" is reversed', names(r)[0] === 'Haolun|Ning', JSON.stringify(names(r)));
	ok('and so is the second', names(r)[1] === 'Ada|Lovelace');
}

{
	// A tab-separated paste from a two-column sheet.
	const r = parseRoster('Haolun\tNing\nAda\tLovelace');
	ok('tabs separate columns', names(r)[0] === 'Haolun|Ning', JSON.stringify(names(r)));
}

// ─── multi-part names ───────────────────────────────────────────────────────
{
	const r = parseRoster('Ada Byron Lovelace\nJean de la Fontaine');
	// Everything after the first token is the surname. Splitting on the LAST
	// space instead would file "Ada Byron Lovelace" under "Ada Byron", and a
	// scout whose name the app gets wrong stops trusting the rest of it.
	ok('a middle name stays with the surname', names(r)[0] === 'Ada|Byron Lovelace', JSON.stringify(names(r)));
	ok('a particle stays with the surname', names(r)[1] === 'Jean|de la Fontaine');
}

// ─── what it refuses, and how loudly ────────────────────────────────────────
{
	const r = parseRoster('Haolun Ning\nMononym\nAda Lovelace');
	// One bad line must not cost the other nineteen. A roster that fails whole
	// is a roster the manager retypes by hand.
	ok('a bad line does not discard the good ones', r.people.length === 2, JSON.stringify(names(r)));
	ok('and it is reported', r.problems.length === 1, JSON.stringify(r.problems));
	ok('the problem names the line', r.problems[0].line === 2, JSON.stringify(r.problems[0]));
	ok('and quotes what was typed', r.problems[0].text === 'Mononym');
	ok('with a reason a human can act on', /both a first and last name/i.test(r.problems[0].why));
}

{
	const r = parseRoster('Haolun Ning\nHaolun Ning\nada lovelace\nAda Lovelace');
	// A duplicated line is a copy-paste artefact, not two people. Minting two
	// invites for one scout means one is wasted and both look valid.
	ok('an exact duplicate is dropped', r.people.length === 2, JSON.stringify(names(r)));
	ok('case does not make a new person', names(r).filter((n) => /ada/i.test(n)).length === 1);
	ok('and duplicates are reported', r.problems.length === 2, JSON.stringify(r.problems));
	ok('the duplicate says so', /already/i.test(r.problems[0].why));
	// The FIRST spelling wins, because that is the one the manager typed first
	// and the one their assignments will use.
	ok('the first spelling is kept', names(r)[1] === 'ada|lovelace' || names(r)[1] === 'Ada|Lovelace');
}

// ─── nothing at all ─────────────────────────────────────────────────────────
{
	ok('empty text is empty, not an error', parseRoster('').people.length === 0);
	ok('and reports no problems', parseRoster('   \n\n  ').problems.length === 0);
	ok('a null input is handled', parseRoster(null).people.length === 0);
}

// ─── display ────────────────────────────────────────────────────────────────
{
	ok('a person renders as one name', formatRosterName({ firstName: 'Ada', lastName: 'Lovelace' }) === 'Ada Lovelace');
	ok('a missing half does not leave a gap', formatRosterName({ firstName: 'Ada', lastName: '' }) === 'Ada');
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
