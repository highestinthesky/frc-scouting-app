// Tests for the pure parts of the auth layer.
//   node src/lib/auth.test.mjs
//
// auth.svelte.js is runes and cannot be imported outside a Svelte runtime, so
// the two functions worth pinning down — the derived email and the username
// rule — are re-read from source and evaluated. They are pure and dependency
// free, which is what makes that safe.
//
// What they protect:
//
//   · The email derivation IS the login identity. If it ever changed shape,
//     every existing account would become unreachable — there is no lookup
//     table to fall back on, by design.
//   · usernameProblem must agree with the database CHECK in migration 0008.
//     If the form is laxer than the constraint, a scout fills in the whole
//     registration form and gets a raw Postgres error at the end.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, 'auth.svelte.js'), 'utf8');

// Lift the pure exports out. Everything above `const state = $state(` is free
// of runes; taking that prefix keeps this honest about what it is testing.
const pure = src.slice(0, src.indexOf('const state = $state(')).replace(
	/^import .*$/m,
	''
);
const { emailForUsername, usernameProblem, USERNAME_RE, AUTH_ENFORCED } = await import(
	'data:text/javascript,' + encodeURIComponent(pure)
);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── the derived email ─────────────────────────────────────────────────────
{
	ok('username maps to an address', emailForUsername('hzhang') === 'hzhang@scout.invalid');
	ok('case is normalised', emailForUsername('HZhang') === 'hzhang@scout.invalid');
	ok('surrounding space is trimmed', emailForUsername('  hz  ') === 'hz@scout.invalid');
	ok('the same name always maps the same way',
		emailForUsername('a.b') === emailForUsername('A.B '));

	// .invalid is reserved by RFC 2606 as permanently unroutable. A real
	// domain here would mean signup mail leaving for an address nobody owns.
	ok('the domain is the reserved unroutable one',
		emailForUsername('x').endsWith('@scout.invalid'));

	ok('empty input still produces a well-formed address, not a crash',
		emailForUsername(undefined) === '@scout.invalid');
}

// ─── username rule must match the database CHECK ───────────────────────────
{
	// migration 0008: CHECK (username ~ '^[a-z0-9._-]{3,24}$')
	const dbRe = /^[a-z0-9._-]{3,24}$/;
	ok('the client regex is the database regex', USERNAME_RE.source === dbRe.source);

	const good = ['abc', 'haolun.zhang', 'hz-2026', 'a_b.c-d', 'x'.repeat(24)];
	// "UPPER" is deliberately absent: the form lowercases before validating, so
	// a capitalised name is normalised rather than refused. Asserted below.
	const bad = ['ab', 'x'.repeat(25), 'Has Space', 'emoji🙂', 'semi;colon', '', 'a/b'];

	for (const u of good) {
		ok(`accepts "${u}"`, usernameProblem(u) === null, usernameProblem(u) ?? '');
		ok(`...and the database would too`, dbRe.test(u.trim().toLowerCase()));
	}
	for (const u of bad) {
		ok(`rejects ${JSON.stringify(u)}`, usernameProblem(u) !== null);
	}

	// The form lowercases before checking, so a capitalised name is accepted
	// and stored lowercase rather than rejected outright.
	ok('mixed case is accepted and normalised, not refused',
		usernameProblem('HaolunZhang') === null);

	ok('a too-short name says so specifically', /3 characters/.test(usernameProblem('ab')));
	ok('a too-long name says so specifically', /24 characters/.test(usernameProblem('x'.repeat(30))));
}

// ─── the cutover flag ──────────────────────────────────────────────────────
{
	// Not a correctness assertion — a tripwire. Flipping this locks every
	// device out until its user signs in, and it must happen together with
	// migration 0009. If this test fails, that is the reminder.
	ok(
		'auth is still additive (flip with migration 0009, not before)',
		AUTH_ENFORCED === false,
		'AUTH_ENFORCED is true — 0009 must be applied and every user must have an account'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
