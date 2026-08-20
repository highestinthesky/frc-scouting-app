// Pure half of draft persistence. The IndexedDB half is exercised in the browser.
//
// What these protect:
//
//   · A draft is keyed by what the form was OPENED for, not by the values being
//     typed. Key it on the live values and the key moves under you mid-edit,
//     which scatters one form across several slots.
//   · An untouched form must not be saved, or every abandoned tap leaves a
//     draft and "you have unsaved work" stops meaning anything.
//   · Pruning bounds the map. Without it a season of opened-and-abandoned forms
//     accumulates in a store the app reads on every launch.

import { draftSlot, hasContent, pruneDrafts, DRAFT_MAX, DRAFT_MAX_AGE_MS } from './draft.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

// ── slots ──────────────────────────────────────────────────────────────────
ok('a match and team make a slot', draftSlot({ matchNumber: 3, teamNumber: 9030 }) === '3:9030');
ok('strings and numbers agree', draftSlot({ matchNumber: '3', teamNumber: '9030' }) === '3:9030');
ok('a blank form is its own slot', draftSlot({}) === 'new');
ok('undefined target is the blank slot', draftSlot(undefined) === 'new');
ok('a match with no team still keys', draftSlot({ matchNumber: 7 }) === '7:');
ok('two matches do not share a slot',
	draftSlot({ matchNumber: 3, teamNumber: 1 }) !== draftSlot({ matchNumber: 4, teamNumber: 1 }));

// ── has anything been typed ────────────────────────────────────────────────
{
	const blank = { matchNumber: '', teamNumber: '', notes: '', broke: false };
	ok('an untouched form has no content', hasContent({ ...blank }, blank) === false);
	ok('whitespace only is still untouched', hasContent({ ...blank, notes: '   ' }, blank) === false);
	ok('a typed note is content', hasContent({ ...blank, notes: 'tipped' }, blank) === true);
	ok('a flipped boolean is content', hasContent({ ...blank, broke: true }, blank) === true);
	ok('a filled match number is content', hasContent({ ...blank, matchNumber: '3' }, blank) === true);
	ok('null values are not content', hasContent({ ...blank, notes: null }, blank) === false);
	ok('a missing values object is not content', hasContent(null, blank) === false);
}

// ── pruning ────────────────────────────────────────────────────────────────
{
	const now = 1_000_000_000;
	const fresh = { values: {}, savedAt: now - 1000 };
	const stale = { values: {}, savedAt: now - DRAFT_MAX_AGE_MS - 1 };
	const kept = pruneDrafts({ a: fresh, b: stale }, now);
	ok('a fresh draft survives', 'a' in kept);
	ok('a stale draft is dropped', !('b' in kept));

	// Exactly at the age limit is stale — the boundary must not be ambiguous.
	const edge = pruneDrafts({ e: { values: {}, savedAt: now - DRAFT_MAX_AGE_MS } }, now);
	ok('a draft exactly at the age limit is dropped', !('e' in edge));

	const many = {};
	for (let i = 0; i < DRAFT_MAX + 5; i += 1) many[`s${i}`] = { values: {}, savedAt: now - i * 10 };
	const capped = pruneDrafts(many, now);
	ok(`no more than ${DRAFT_MAX} are kept`, Object.keys(capped).length === DRAFT_MAX);
	ok('and the newest are the ones kept', 's0' in capped && !(`s${DRAFT_MAX + 4}` in capped));

	ok('junk in is an empty map', Object.keys(pruneDrafts(null, now)).length === 0);
	ok('a draft with no timestamp is dropped',
		!('x' in pruneDrafts({ x: { values: {} } }, now)));
}

console.log(fail === 0 ? `draft: ${pass} passed` : `draft: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
