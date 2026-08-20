// The greeting must not move while someone is reading it.
//
// Home re-derives `now` once a minute so relative times stay honest, and that
// re-runs every $derived on the page. A greeting seeded on the clock — or picked
// at random — would therefore reshuffle under the reader every 60 seconds. That
// is the bug these tests exist to prevent; the variety is the easy half.

import { greetingFor, bandFor } from './greeting.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

/** A Date on 2026-08-20 at the given hour/minute, in local time. */
const at = (h, min = 0) => new Date(2026, 7, 20, h, min, 0);

// ── bands ──────────────────────────────────────────────────────────────────
ok('midnight is morning', bandFor(at(0)) === 'morning');
ok('11:59 is still morning', bandFor(at(11, 59)) === 'morning');
ok('noon is afternoon', bandFor(at(12)) === 'afternoon');
ok('17:59 is still afternoon', bandFor(at(17, 59)) === 'afternoon');
ok('18:00 is evening', bandFor(at(18)) === 'evening');
ok('23:59 is evening', bandFor(at(23, 59)) === 'evening');

// ── stability: the whole point ─────────────────────────────────────────────
{
	// The minute hand moving must not change the answer.
	const first = greetingFor(at(9, 0), 'Ning');
	let steady = true;
	for (let m = 1; m < 60; m += 1) {
		if (greetingFor(at(9, m), 'Ning') !== first) steady = false;
	}
	ok('the greeting does not change as the minutes tick', steady);

	// Nor may remounting the page produce a different one.
	ok('it is the same on a second call', greetingFor(at(9), 'Ning') === first);

	// Whole band, one answer.
	let sameAllMorning = true;
	for (let h = 0; h < 12; h += 1) {
		if (greetingFor(at(h), 'Ning') !== first) sameAllMorning = false;
	}
	ok('and holds across the whole morning band', sameAllMorning);
}

// ── variety ────────────────────────────────────────────────────────────────
{
	// Across a month of mornings, one person should see several different ones.
	const seen = new Set();
	for (let d = 1; d <= 28; d += 1) seen.add(greetingFor(new Date(2026, 7, d, 9), 'Ning'));
	ok('a month of mornings is not one repeated greeting', seen.size >= 4,
		`saw ${seen.size}: ${[...seen].join(', ')}`);

	// Two scouts on the same morning need not match, but the app must not crash
	// on a blank name — a device can be signed in with no display name yet.
	ok('a blank name still returns a greeting',
		typeof greetingFor(at(9), '') === 'string' && greetingFor(at(9), '').length > 0);
	ok('an undefined name still returns a greeting',
		typeof greetingFor(at(9)) === 'string' && greetingFor(at(9)).length > 0);
}

// ── the time-appropriate one is never wrong for the hour ───────────────────
{
	// Whatever is chosen, it must never name the wrong part of the day.
	let wrongBand = false;
	for (let d = 1; d <= 28; d += 1) {
		for (const [h, band] of [[9, 'morning'], [14, 'afternoon'], [20, 'evening']]) {
			const g = greetingFor(new Date(2026, 7, d, h), `scout${d}`);
			if (/^Good (morning|afternoon|evening)$/.test(g) && g !== `Good ${band}`) wrongBand = true;
		}
	}
	ok('a time-of-day greeting always names the right part of the day', !wrongBand);

	// The name is seed salt only — it must never be echoed back in the string.
	ok('the greeting never contains the name',
		!greetingFor(at(9), 'Ning').includes('Ning'));
}

console.log(fail === 0 ? `greeting: ${pass} passed` : `greeting: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
