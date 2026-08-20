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
//   · Username sign-in must cross the private Edge Function. Putting the email
//     lookup back in the browser restores anonymous address harvesting.
//   · usernameProblem must agree with the database CHECK in migration 0008.
//     If the form is laxer than the constraint, a scout fills in the whole
//     registration form and gets a raw Postgres error at the end.

import { readFileSync, existsSync } from 'node:fs';
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
	usernameProblem,
	USERNAME_RE,
	authUserId,
	authEmail,
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

// ─── the address is looked up, not derived ─────────────────────────────────
//
// It used to be `username + '@scout.invalid'`. That needed no round trip and
// leaked nothing — and made password recovery impossible, because .invalid is
// permanently unroutable and Supabase sends recovery to auth.users.email.
// Someone was locked out of a super account with no way back; that is what paid
// for this change.
{
	// A regression guard with teeth. If derivation ever comes back, every account
	// it creates is unrecoverable. If email_for_username comes back, knowing a
	// username reveals the real address again.
	//
	// Comments are stripped first. The file explains at length why the address
	// USED to be derived, so a naive search finds the reserved domain in prose
	// and reports the bug it is describing.
	const code = src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !l.trim().startsWith('//'))
		.join('\n');
	ok('no executable code mentions the reserved domain', !/@scout\.invalid/.test(code));

	ok('the browser never calls the address lookup RPC', !/email_for_username/.test(code));

	// All credential decisions now belong to the private endpoint; the auth store
	// should only install the returned session and propagate its generic result.
	const signInStart = src.indexOf('async signIn(');
	const signInSrc = src.slice(signInStart, src.indexOf('\n\t},', signInStart) + 4);
	ok('signIn uses the private username session exchange',
		/establishUsernameSession\(getAuthClient\(\), username, password\)/.test(signInSrc));
	ok('signIn no longer receives or handles an email address',
		!/lookupEmail|signInWithPassword|\bemail\b/.test(signInSrc));

	// Registration must collect somewhere reachable, or recovery is theatre.
	const registerSrc = src.slice(src.indexOf('async register('));
	ok('registration requires an address', /Enter the email address you want password resets sent to/.test(registerSrc));
	ok('registration signs up with the address the human typed',
		/signUp\(\{[\s\S]{0,60}\bemail,/.test(registerSrc));
	ok('the address is also stored where a manager can read it',
		/p_recovery_email/.test(registerSrc));
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
	ok('gets the address from a stored auth session',
		authEmail({ session: { user: { email: 'scout@example.com' } } }) === 'scout@example.com');
	ok('gets the address from sign-in data',
		authEmail({ user: { email: 'a@b.com' }, session: null }) === 'a@b.com');
	ok('missing auth data has no address', authEmail(null) === null);

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

// ─── the local role toggle is gone ─────────────────────────────────────────
//
// It was a self-asserted checkbox in IndexedDB that revealed the manager
// surfaces to anyone who ticked it, and its own header still described the
// file-import workflow that was removed. The account answers the question now.
{
	const shellSrc = readFileSync(path.join(here, '../routes/+layout.svelte'), 'utf8');
	const settingsSrc = readFileSync(path.join(here, '../routes/settings/+page.svelte'), 'utf8');
	// The manager surfaces moved to Studio in v0.73 — /scouting is the act of
	// scouting now, which is what the word always meant. This assertion follows
	// the job, not the path: whichever page renders the manager components is the
	// one that must ask auth rather than re-deriving the answer.
	const scoutingSrc = readFileSync(
		path.join(here, '../routes/studio/schedule/+page.svelte'),
		'utf8'
	);

	ok('role.svelte.js is gone', !existsSync(path.join(here, 'role.svelte.js')));
	for (const [label, text] of [
		['the layout', shellSrc],
		['settings', settingsSrc],
		['the studio schedule page', scoutingSrc]
	]) {
		ok(`${label} no longer imports the local role store`, !/role\.svelte\.js/.test(text));
	}

	// Showing the surface and being allowed to write it used to be different
	// questions, because the passphrase form lived inside the surface it unlocked
	// — gating the surface on already holding the passphrase sealed the only door
	// to it. There is no door now, so both collapse to the role.
	//
	// This assertion previously required showsManagerTools to branch on
	// `state.signedIn ? this.isManager`. It now requires the opposite: that
	// neither question consults a passphrase, because a device that still
	// believed in one would render manager buttons whose every write is refused
	// by manages_event().
	ok('auth owns whether manager surfaces render', /get showsManagerTools\(\)/.test(src));
	ok(
		'both manager questions are the role and nothing else',
		/get canManage\(\) \{\s*return this\.isManager;/.test(src) &&
			/get showsManagerTools\(\) \{\s*return this\.isManager;/.test(src)
	);
	ok('no passphrase survives in auth', !/session\.managerToken/.test(src));
	ok(
		'the manager surface asks auth rather than re-deriving',
		/isManager = \$derived\(auth\.showsManagerTools\)/.test(scoutingSrc)
	);
}

// ─── the scout name fills itself, but never overwrites ─────────────────────
//
// scout_name is still the join key for assignments, overrides and targeted
// reminders. Filling a blank one costs nothing; replacing one that already
// exists would detach the device from everything addressed to the old spelling.
{
	ok('signing in adopts the account name', /adoptScoutName\(/.test(src));
	ok(
		'and only when the local name is empty',
		/adoptScoutName\([\s\S]*?if \(session\.scoutName\?\.trim\(\)\) return;/.test(src)
	);
	ok(
		'it writes "First Last", the form resolveScout matches on',
		/adoptScoutName\([\s\S]*?first_name[\s\S]*?last_name/.test(src)
	);
}

// ─── the cutover flag ──────────────────────────────────────────────────────
{
	// This was a tripwire asserting AUTH_ENFORCED === false, with the note that
	// flipping it locks every device out until its user signs in and must happen
	// together with the policy cutover migration.
	//
	// It fired, and the cutover is what got finished: 0020 dropped session_id,
	// the legacy policies and has_manager_token(), and the client lost the
	// passphrase entirely. This is the assertion changing last, which is the
	// order the tripwire asked for.
	//
	// It stays as an assertion rather than being deleted, pointing the other way.
	// Turning the flag back off would now be the dangerous move — the database no
	// longer has an anonymous path, so a client that thinks auth is optional
	// would offer a UI where every write fails.
	ok(
		'auth is enforced, and 0020 is what made that safe',
		AUTH_ENFORCED === true,
		'AUTH_ENFORCED is false — the database has no anon path any more, so every write would fail'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
