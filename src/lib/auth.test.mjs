// Tests for the pure parts of the auth layer.
//   node src/lib/auth.test.mjs
//
// auth.svelte.js is runes and cannot be imported outside a Svelte runtime, so
// the pure helpers worth pinning down — derived email, username rules and auth
// user-id extraction — are re-read from source and evaluated. They are dependency
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
//
// /gm, not /m. Without the global flag this stripped only the FIRST import, so
// the day auth.svelte.js gained a second one the leftover relative specifier
// went into a data: URL that cannot resolve it, and the whole suite died with
// ERR_INVALID_URL — a failure that names the loader rather than the cause.
const pure = src.slice(0, src.indexOf('const state = $state(')).replace(
	/^import .*$/gm,
	''
);
const {
	emailForUsername,
	usernameProblem,
	USERNAME_RE,
	authUserId,
	authUsername,
	AUTH_ENFORCED
} = await import(
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

// ─── profile reads must target the signed-in user ───────────────────────────
{
	ok('gets the user id from getSession data',
		authUserId({ session: { user: { id: 'session-user' } } }) === 'session-user');
	ok('gets the user id from sign-in data',
		authUserId({ user: { id: 'signed-in-user' }, session: null }) === 'signed-in-user');
	ok('missing auth data has no user id', authUserId(null) === null);
	ok('recovers the immutable username from a stored auth session',
		authUsername({ session: { user: { email: 'Scout.One@scout.invalid' } } }) === 'scout.one');
	ok('does not treat an unrelated email address as an app username',
		authUsername({ user: { email: 'scout@example.com' } }) === null);

	const loadProfileSrc = src.slice(src.indexOf('async function loadProfile'));
	ok('loadProfile scopes the roster query to the current user',
		/\.from\('profiles'\)[\s\S]*?\.eq\('id', userId\)[\s\S]*?\.maybeSingle\(\)/.test(loadProfileSrc));
}

// ─── additive client cutover invariants ────────────────────────────────────
{
	const supabaseSrc = readFileSync(path.join(here, 'supabase.js'), 'utf8');
	const registerSrc = readFileSync(path.join(here, '../routes/register/+page.svelte'), 'utf8');
	const layoutSrc = readFileSync(path.join(here, '../routes/+layout.svelte'), 'utf8');
	const editSrc = readFileSync(path.join(here, '../routes/scouting/edit/+page.svelte'), 'utf8');

	ok('event clients fetch the current auth-client session for each request',
		/fetchWithCurrentAuth[\s\S]*?getAuthClient\(\)\.auth\.getSession\(\)/.test(supabaseSrc));
	ok('event clients do not persist a second, stale auth session',
		/persistSession:\s*false[\s\S]*?fetch:\s*fetchWithCurrentAuth/.test(supabaseSrc));
	ok('an orphaned signed-in user is allowed to remain on the registration route',
		/onRegisterRoute\s*&&\s*!auth\.orphaned/.test(layoutSrc));
	ok('the registration form supports finishing an orphaned account',
		/auth\.orphaned[\s\S]*?Finish account setup/.test(registerSrc));
	ok('registration no longer promises an unsupported recovery-email flow',
		!/recoveryEmail|Recovery email|reset your own password/i.test(registerSrc));
	ok('a last-known profile keeps account role UI available on a cold offline launch',
		/readCachedProfile\(userId\)[\s\S]*?state\.profile = cached/.test(src));
	ok('the profile UI cache is cleared on sign-out',
		/event === 'SIGNED_OUT'[\s\S]*?clearCachedProfile\(\)/.test(src));
	ok('post-cutover peer entries are read-only for ordinary scouts',
		/AUTH_ENFORCED[\s\S]*?entry\.submittedBy === auth\.profile\?\.id/.test(editSrc));
}

// ─── the cutover flag ──────────────────────────────────────────────────────
{
	// Not a correctness assertion — a tripwire. Flipping this locks every
	// device out until its user signs in, and it must happen together with
	// the policy cutover migration. If this test fails, that is the reminder.
	ok(
		'auth is still additive (flip with migration 0011, not before)',
		AUTH_ENFORCED === false,
		'AUTH_ENFORCED is true — 0011 must be applied and every user must have an account'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
