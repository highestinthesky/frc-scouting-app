// Behavioural RLS tests against a real Postgres.
//
//   supabase start && npm run test:rls
//
// ─── why this file exists ───────────────────────────────────────────────────
//
// `npm run check:sql` proves the migrations parse. `verify_migrations.sql`
// proves the objects exist. Neither proves a policy permits what its name
// claims, and a policy that permits the wrong thing looks exactly like one that
// does not — same name, same table, same green checkmark.
//
// Migrations 0008 through 0012 were written, reviewed and syntax-checked
// without ever executing. This is the file that makes "the cutover is safe" a
// measurement instead of a belief.
//
// It goes through PostgREST rather than psql on purpose. `current_session_header()`
// reads `request.headers`, which only exists when the request arrived over HTTP,
// so a psql test would have to fake the very mechanism that partitions events —
// and would pass whether or not the real one works. These requests are the
// same shape the app sends.
//
// ─── reading a failure ──────────────────────────────────────────────────────
//
// RLS filters, it does not raise. A SELECT that returns zero rows IS the
// denial, and an empty array is indistinguishable from an empty table, so
// every "cannot see" assertion below is paired with a fixture that would be
// visible if the policy allowed it.

// Fixtures are built over a direct SQL connection, never through PostgREST.
// The service_role key reaches the database through the same grant system these
// tests are measuring, so seeding with it would make the fixtures depend on the
// thing under test — and on this stack it cannot anyway: a table here is created
// with only REFERENCES/TRIGGER/TRUNCATE for anon, authenticated and service_role,
// so service_role has no DML on any application table.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import pg from 'pg';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── the stack, or a clean skip ────────────────────────────────────────────
//
// `npm test` must stay green on a plane. A missing local stack is not a
// failing test, it is an absent one, and saying so is more useful than a red
// suite that means "Docker is not running".

function localStack() {
	try {
		const out = execSync('supabase status -o json', {
			stdio: ['ignore', 'pipe', 'ignore']
		}).toString();
		const s = JSON.parse(out);
		if (!s.API_URL || !s.SERVICE_ROLE_KEY || !s.DB_URL) return null;
		return {
			url: s.API_URL,
			anonKey: s.ANON_KEY,
			serviceKey: s.SERVICE_ROLE_KEY,
			dbUrl: s.DB_URL
		};
	} catch {
		return null;
	}
}

const stack = localStack();
if (!stack) {
	console.log('  SKIP: no local Supabase. `supabase start`, then npm run test:rls');
	process.exit(0);
}

const { url, anonKey, serviceKey, dbUrl } = stack;

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const sql = async (text, params = []) => (await db.query(text, params)).rows;

// Two events, because "can this member see event data" and "can this member see
// THIS event's data" are different questions and only the second one is hard.
const EVENT_A = { session: '1a1a1a1a-0000-4000-8000-000000000001', code: 'rlstest-a' };
const EVENT_B = { session: '2b2b2b2b-0000-4000-8000-000000000002', code: 'rlstest-b' };

const PASSWORD = 'rls-test-password';
const MARK = 'rlstest';

const admin = createClient(url, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false }
});

/** A client shaped like the app's: anon key, a bearer token, an event header. */
async function clientFor(user, event) {
	const c = createClient(url, anonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { 'x-session-id': event.session } }
	});
	if (user) {
		const { error } = await c.auth.signInWithPassword({
			email: user.email,
			password: PASSWORD
		});
		if (error) throw new Error(`sign in ${user.username}: ${error.message}`);
	}
	return c;
}

async function makeUser(username, role) {
	const email = `${username}@scout.invalid`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: PASSWORD,
		email_confirm: true
	});
	if (error) throw new Error(`create ${username}: ${error.message}`);
	const id = data.user.id;
	// role null means an orphan: an auth user with no profile, which is both an
	// unfinished registration and a revoked account. Same state, same access.
	if (role) {
		await sql(
			`insert into public.profiles (id, username, first_name, last_name, role)
			 values ($1, $2, $3, 'Test', $4::app_role)`,
			[id, username, username, role]
		);
	}
	return { id, email, username, role };
}

const entryRow = (event, over = {}) => ({
	session_id: event.session,
	event_code: event.code,
	match_number: 1,
	team_number: 3419,
	alliance_color: 'red',
	scout_name: 'fixture',
	observations: {},
	schema_version: 3,
	created_at: new Date().toISOString(),
	...over
});

async function reset() {
	for (const t of EVENT_TABLES) {
		await sql(`delete from public.${t} where session_id = any($1::uuid[])`, [
			[EVENT_A.session, EVENT_B.session]
		]);
	}
	await sql(`delete from public.invites where code like $1`, [`${MARK}%`]);
	await sql(`delete from public.profiles where username like $1`, [`${MARK}%`]);
	// Auth users go through SQL rather than the admin API. Cleanup used to call
	// admin.deleteUser() for every listed account and it left every one of them
	// behind — the profiles were gone, the logins were not, and the next run died
	// on "already registered" instead of on anything it was testing. The FK from
	// profiles.id and the auth.identities/sessions cascades make this exact.
	await sql(`delete from auth.users where email like $1`, [`${MARK}%`]);
}

async function seed() {
	for (const e of [EVENT_A, EVENT_B]) {
		const args = [e.session, e.code];
		await sql(`insert into public.event_meta (session_id, event_code) values ($1, $2)`, args);
		await sql(
			`insert into public.entries
			   (session_id, event_code, match_number, team_number, alliance_color,
			    scout_name, observations, schema_version, created_at)
			 values ($1, $2, 1, 3419, 'red', 'fixture', '{}'::jsonb, 3, now())`,
			args
		);
		await sql(
			`insert into public.schedules (session_id, event_code, matches) values ($1, $2, '[]'::jsonb)`,
			args
		);
		await sql(
			`insert into public.assignments (session_id, event_code, scout_name, team_number)
			 values ($1, $2, 'fixture', 3419)`,
			args
		);
		await sql(
			`insert into public.assignment_overrides
			   (session_id, event_code, match_number, scout_name, team_number)
			 values ($1, $2, 1, 'fixture', 3419)`,
			args
		);
		await sql(
			`insert into public.reminders (session_id, event_code, message) values ($1, $2, 'fixture')`,
			args
		);
		await sql(
			`insert into public.picklist (session_id, event_code, team_number, rank)
			 values ($1, $2, 3419, 1)`,
			args
		);
		await sql(
			`insert into public.picklist_prefs (session_id, event_code, weights)
			 values ($1, $2, '{}'::jsonb)`,
			args
		);
	}
}

/**
 * Rows visible to this client, per table. RLS filtering shows up as 0.
 *
 * `profiles` needs an explicit column list. RLS hides rows, not columns, so
 * recovery_email is withheld by a column grant instead — which means `select *`
 * is refused outright for everyone, member or not. Asking for `*` here would
 * make every profiles assertion pass for the wrong reason, including the ones
 * that are supposed to prove a policy denied something.
 */
const ROSTER = 'id, username, first_name, last_name, role, created_at';

async function visible(client, table, columns = '*') {
	const { data, error } = await client.from(table).select(columns);
	return error ? -1 : (data?.length ?? 0);
}

/**
 * Was this write refused by the security model rather than by a constraint?
 *
 * From outside they look identical — the row is not there either way — and that
 * ambiguity already cost one assertion. `a scout cannot write schedules` was an
 * INSERT into a table keyed on session_id alone, so it collided with the row the
 * event already had and reported success at refusing something the policy would
 * happily have allowed. It stayed green with is_manager() stubbed to true.
 *
 * 23505 is a unique violation: the write was permitted and the data said no.
 * That is not a passing security test.
 */
const denied = (error) => Boolean(error) && error.code !== '23505';

const EVENT_TABLES = [
	'entries',
	'schedules',
	'assignments',
	'assignment_overrides',
	'reminders',
	'picklist',
	'picklist_prefs',
	'event_meta'
];

// ─── run ────────────────────────────────────────────────────────────────────

await reset();
await seed();

const scout = await makeUser(`${MARK}_scout`, 'scout');
const scout2 = await makeUser(`${MARK}_scout2`, 'scout');
const manager = await makeUser(`${MARK}_manager`, 'manager');
const superUser = await makeUser(`${MARK}_super`, 'super');
const orphan = await makeUser(`${MARK}_orphan`, null);

const anonA = await clientFor(null, EVENT_A);
const orphanA = await clientFor(orphan, EVENT_A);
const scoutA = await clientFor(scout, EVENT_A);
const scout2A = await clientFor(scout2, EVENT_A);
const managerA = await clientFor(manager, EVENT_A);
const superA = await clientFor(superUser, EVENT_A);
const scoutB = await clientFor(scout, EVENT_B);

// ─── anon sees nothing ──────────────────────────────────────────────────────
//
// The event code is published on The Blue Alliance, so before the cutover it
// was never a secret. After it, holding one must buy nothing at all.
{
	for (const t of EVENT_TABLES) {
		ok(`anon cannot read ${t}`, (await visible(anonA, t)) <= 0);
	}
	const { error } = await anonA.from('entries').insert(entryRow(EVENT_A));
	ok('anon cannot record an entry', denied(error), error?.code);
	ok('anon cannot read the roster', (await visible(anonA, 'profiles', ROSTER)) <= 0);
}

// ─── an auth user without a profile sees nothing ────────────────────────────
//
// Registration that stopped halfway, or access a manager revoked. Both leave a
// valid login. A valid login is not team membership.
{
	for (const t of EVENT_TABLES) {
		ok(`orphaned account cannot read ${t}`, (await visible(orphanA, t)) <= 0);
	}
	const { error } = await orphanA.from('entries').insert(entryRow(EVENT_A));
	ok('orphaned account cannot record an entry', denied(error), error?.code);
	ok('orphaned account cannot read the roster', (await visible(orphanA, 'profiles', ROSTER)) <= 0);
}

// ─── event scope holds in both directions ───────────────────────────────────
//
// Membership and event scope are separate requirements. A real member of the
// team pointed at another event is the case that matters, because that is one
// header away from normal use.
{
	ok('a member reads their own event', (await visible(scoutA, 'entries')) === 1);

	// Both events hold an identical fixture row, so a count alone cannot tell
	// "scoped correctly" from "scoped to the wrong event". Check which one came back.
	const { data: seenA } = await scoutA.from('entries').select('session_id');
	ok('and sees only that event', seenA?.every((r) => r.session_id === EVENT_A.session));

	const { data: seenB } = await scoutB.from('entries').select('session_id');
	ok(
		'switching the header switches the event, not the scope',
		seenB?.length === 1 && seenB[0].session_id === EVENT_B.session
	);

	// Header says A, row says B. The row must not land: otherwise the header is
	// a suggestion rather than a boundary.
	const { error } = await scoutA.from('entries').insert(entryRow(EVENT_B, { scout_name: 'crosser' }));
	ok('a member cannot write into another event by changing the row', denied(error), error?.code);

	const leaked = await sql(
		`select id from public.entries where session_id = $1 and scout_name = 'crosser'`,
		[EVENT_B.session]
	);
	ok('and nothing crossed', leaked.length === 0);
}

// ─── scouts record; managers operate ────────────────────────────────────────
{
	const { error: insErr } = await scoutA.from('entries').insert(entryRow(EVENT_A, { match_number: 7 }));
	ok('a scout records an entry', !insErr, insErr?.message);

	for (const [t, row] of [
		[
			'assignments',
			{ session_id: EVENT_A.session, event_code: EVENT_A.code, scout_name: 'x', team_number: 1 }
		],
		['reminders', { session_id: EVENT_A.session, event_code: EVENT_A.code, message: 'x' }],
		[
			'picklist',
			{ session_id: EVENT_A.session, event_code: EVENT_A.code, team_number: 1, rank: 2 }
		]
	]) {
		const { error } = await scoutA.from(t).insert(row);
		ok(`a scout cannot write ${t}`, denied(error), error?.code);
	}

	// schedules is keyed on session_id alone, so an INSERT collides with the row
	// this event already has and fails whatever the policy says. That is not a
	// hypothetical: this assertion was an INSERT, and it passed while is_manager()
	// was stubbed to return true. UPDATE is also the real operation — publishing a
	// schedule replaces the one row for the event.
	const { count: scoutSched, error: scoutSchedErr } = await scoutA
		.from('schedules')
		.update({ matches: [] }, { count: 'exact' })
		.eq('session_id', EVENT_A.session);
	ok('a scout cannot rewrite the schedule', denied(scoutSchedErr) || scoutSched === 0);

	const { count: mgrSched } = await managerA
		.from('schedules')
		.update({ matches: [] }, { count: 'exact' })
		.eq('session_id', EVENT_A.session);
	ok('a manager rewrites the schedule', mgrSched === 1);

	const { error: mgrErr } = await managerA
		.from('reminders')
		.insert({ session_id: EVENT_A.session, event_code: EVENT_A.code, message: 'from a manager' });
	ok('a manager writes a manager surface', !mgrErr, mgrErr?.message);

	const { error: mgrCross } = await managerA
		.from('reminders')
		.insert({ session_id: EVENT_B.session, event_code: EVENT_B.code, message: 'cross-event' });
	ok('a manager is still bound to one event', denied(mgrCross), mgrCross?.code);
}

// ─── attribution is a fact, not a claim ─────────────────────────────────────
{
	await scoutA.from('entries').insert(entryRow(EVENT_A, { match_number: 11, scout_name: 'attr' }));
	const [mine] = await sql(
		`select id, submitted_by from public.entries
		  where session_id = $1 and scout_name = 'attr'`,
		[EVENT_A.session]
	);
	ok('an insert is stamped from the token', mine?.submitted_by === scout.id);

	// The client asked to be someone else. The trigger overwrites it anyway.
	await scoutA
		.from('entries')
		.insert(entryRow(EVENT_A, { match_number: 12, scout_name: 'forged', submitted_by: manager.id }));
	const [forged] = await sql(
		`select submitted_by from public.entries
		  where session_id = $1 and scout_name = 'forged'`,
		[EVENT_A.session]
	);
	ok('a forged submitted_by is overwritten, not honoured', forged?.submitted_by === scout.id);

	// The grant withholds UPDATE(submitted_by), so this is refused rather than
	// silently ignored.
	const { error: clearErr } = await scoutA
		.from('entries')
		.update({ submitted_by: null })
		.eq('id', mine.id);
	ok('attribution cannot be cleared', Boolean(clearErr));

	const { error: ownErr } = await scoutA
		.from('entries')
		.update({ team_number: 9999 })
		.eq('id', mine.id);
	ok('a scout corrects their own entry', !ownErr, ownErr?.message);

	const { error: otherErr, count } = await scout2A
		.from('entries')
		.update({ team_number: 8888 }, { count: 'exact' })
		.eq('id', mine.id);
	ok("a scout cannot rewrite another scout's entry", Boolean(otherErr) || count === 0);

	const { count: mgrCount } = await managerA
		.from('entries')
		.update({ team_number: 7777 }, { count: 'exact' })
		.eq('id', mine.id);
	ok('a manager can correct any entry in the event', mgrCount === 1);
}

// ─── roles ──────────────────────────────────────────────────────────────────
//
// The interesting attacks are all self-directed: the account you control is
// the one you can most easily ask the database to promote.
{
	const { count: selfCount, error: selfErr } = await scoutA
		.from('profiles')
		.update({ role: 'manager' }, { count: 'exact' })
		.eq('id', scout.id);
	ok('a scout cannot promote themselves', Boolean(selfErr) || selfCount === 0);

	const { count: mgrSelf, error: mgrSelfErr } = await managerA
		.from('profiles')
		.update({ role: 'super' }, { count: 'exact' })
		.eq('id', manager.id);
	ok('a manager cannot promote themselves to super', Boolean(mgrSelfErr) || mgrSelf === 0);

	const { count: mintSuper, error: mintErr } = await managerA
		.from('profiles')
		.update({ role: 'super' }, { count: 'exact' })
		.eq('id', scout2.id);
	ok('a manager cannot mint a super', Boolean(mintErr) || mintSuper === 0);

	const { count: demote, error: demoteErr } = await managerA
		.from('profiles')
		.update({ role: 'scout' }, { count: 'exact' })
		.eq('id', superUser.id);
	ok('a manager cannot demote a super', Boolean(demoteErr) || demote === 0);

	const { count: mgrPromote } = await managerA
		.from('profiles')
		.update({ role: 'manager' }, { count: 'exact' })
		.eq('id', scout2.id);
	ok('a manager promotes a scout to manager', mgrPromote === 1);

	const { count: superPromote } = await superA
		.from('profiles')
		.update({ role: 'super' }, { count: 'exact' })
		.eq('id', scout2.id);
	ok('a super promotes to super', superPromote === 1);

	const { count: delSuper, error: delErr } = await managerA
		.from('profiles')
		.delete({ count: 'exact' })
		.eq('id', scout2.id);
	ok('a manager cannot delete a super', Boolean(delErr) || delSuper === 0);

	// Put it back so the identity checks below run against a known role.
	await sql(`update public.profiles set role = 'scout' where id = $1`, [scout2.id]);

	const { count: renameCount, error: renameErr } = await scoutA
		.from('profiles')
		.update({ username: 'somebodyelse' }, { count: 'exact' })
		.eq('id', scout.id);
	ok('a username is immutable', Boolean(renameErr) || renameCount === 0);

	ok('a member reads the roster', (await visible(scoutA, 'profiles', ROSTER)) > 0);

	// Not RLS — a column grant. Worth pinning separately because it means any
	// client doing select('*') on profiles is refused outright, member or not.
	ok('select * on the roster is refused', (await visible(scoutA, 'profiles')) === -1);

	const { error: recovErr } = await scoutA.from('profiles').select('recovery_email');
	ok('recovery_email is not in the roster response', Boolean(recovErr));
}

// ─── invites ────────────────────────────────────────────────────────────────
{
	await sql(`insert into public.invites (code, role) values ($1, 'scout'), ($2, 'super')`, [
		`${MARK}-scout`,
		`${MARK}-super`
	]);

	ok('a scout sees no invites', (await visible(scoutA, 'invites')) <= 0);

	const { data: mgrInvites } = await managerA.from('invites').select('code, role');
	ok('a manager sees ordinary invites', (mgrInvites ?? []).some((i) => i.role === 'scout'));
	ok(
		'a manager cannot see a super invite',
		!(mgrInvites ?? []).some((i) => i.role === 'super')
	);

	const { data: superInvites } = await superA.from('invites').select('code, role');
	ok('a super sees every invite', (superInvites ?? []).some((i) => i.role === 'super'));
}

// ─── the dual-write has somewhere to land ───────────────────────────────────
//
// 0010 added profile_id to the planning tables and 0011 rebuilt every grant and
// policy on them. The client now writes that column on every assignment,
// override and targeted reminder. entries proves the failure mode is real:
// UPDATE(submitted_by) is deliberately withheld there, so a column being
// present is not the same as a column being writable — and a dual-write that
// is silently refused looks exactly like one that works until the cutover
// needs the data.
{
	for (const [table, extra] of [
		['assignments', { team_number: 1234 }],
		['assignment_overrides', { match_number: 3, team_number: 1234 }],
		['reminders', { message: 'targeted at an account' }]
	]) {
		const { error } = await managerA.from(table).insert({
			session_id: EVENT_A.session,
			event_code: EVENT_A.code,
			scout_name: 'dualwrite',
			profile_id: scout.id,
			...extra
		});
		ok(`a manager can write profile_id on ${table}`, !error, error?.message);

		const [back] = await sql(
			`select profile_id from public.${table}
			  where session_id = $1 and scout_name = 'dualwrite'`,
			[EVENT_A.session]
		);
		ok(`and ${table}.profile_id survives the round trip`, back?.profile_id === scout.id);
	}

	// The account is what a scout will eventually be found by, so it has to be
	// readable back by an ordinary member, not just by the manager who wrote it.
	const { data: seen } = await scoutA.from('assignments').select('scout_name, profile_id');
	ok(
		'a scout can read the account on their own assignment',
		(seen ?? []).some((r) => r.profile_id === scout.id)
	);
}

// ─── archive / reset ────────────────────────────────────────────────────────
//
// The one operation that deletes. It must clear this event's planning state,
// keep the scouting entries, and not touch the other event at all.
{
	const countIn = async (table, event) =>
		Number(
			(
				await sql(`select count(*)::int as n from public.${table} where session_id = $1`, [
					event.session
				])
			)[0].n
		);

	const beforeEntries = await countIn('entries', EVENT_A);
	const beforeOther = await countIn('assignments', EVENT_B);

	const { error: scoutReset } = await scoutA.rpc('reset_event_data');
	ok('a scout cannot archive the event', Boolean(scoutReset));

	const { error: mgrReset } = await managerA.rpc('reset_event_data');
	ok('a manager archives the event', !mgrReset, mgrReset?.message);

	const afterEntries = await countIn('entries', EVENT_A);
	ok(
		'archiving preserves scouting entries',
		afterEntries === beforeEntries && afterEntries > 0,
		`${beforeEntries} -> ${afterEntries}`
	);

	ok('archiving clears this event planning state', (await countIn('assignments', EVENT_A)) === 0);

	const otherAssign = await countIn('assignments', EVENT_B);
	ok(
		'archiving leaves the other event alone',
		otherAssign === beforeOther && otherAssign > 0,
		`${beforeOther} -> ${otherAssign}`
	);
}

await reset();
await db.end();

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
