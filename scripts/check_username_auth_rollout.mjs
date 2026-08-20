// End-to-end regression test for the username-auth privacy rollout.
//
//   supabase start
//   supabase migration up --local
//   supabase functions serve username-sign-in --no-verify-jwt
//   npm run test:auth-rollout
//
// It deliberately exercises account CREATION before username sign-in. Closing
// the lookup leak is only safe if invite redemption, orphan resume, and the
// manager-created temporary-password path all still produce reachable accounts.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
	if (condition) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

function localStack() {
	try {
		const status = JSON.parse(execSync('supabase status -o json', {
			stdio: ['ignore', 'pipe', 'ignore']
		}).toString());
		if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY || !status.DB_URL) return null;
		return {
			url: status.API_URL,
			anonKey: status.ANON_KEY,
			serviceKey: status.SERVICE_ROLE_KEY,
			dbUrl: status.DB_URL
		};
	} catch {
		return null;
	}
}

const stack = localStack();
if (!stack) {
	console.log('  SKIP: no local Supabase. Start it before npm run test:auth-rollout');
	process.exit(0);
}

const db = new pg.Client({ connectionString: stack.dbUrl });
await db.connect();
const sql = async (text, params = []) => (await db.query(text, params)).rows;
const admin = createClient(stack.url, stack.serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false }
});

const mark = `authroll${Date.now().toString(36)}`;
const password = 'rollout-test-password';
const ids = [];
const inviteCodes = [];

async function makeAuthUser(label, role = null) {
	const email = `${mark}.${label}@example.com`;
	const username = `${mark.slice(0, 14)}.${label}`.slice(0, 24);
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	if (error || !data.user) throw new Error(`create ${label}: ${error?.message ?? 'no user'}`);
	ids.push(data.user.id);
	if (role) {
		await sql(
			`insert into public.profiles
			   (id, username, first_name, last_name, role, recovery_email)
			 values ($1, $2, $3, 'Rollout', $4::public.app_role, $5)`,
			[data.user.id, username, label, role, email]
		);
	}
	return { id: data.user.id, email, username };
}

async function makeInvite(label) {
	// Six characters from the same unambiguous alphabet as production invites.
	const code = `${label.toUpperCase().replace(/[^A-Z2-9]/g, 'X')}XXXXXX`.slice(0, 6);
	inviteCodes.push(code);
	await sql(
		`insert into public.invites
		   (code, role, created_by, expires_at, first_name, last_name)
		 values ($1, 'scout', null, now() + interval '1 hour', $2, 'Rollout')`,
		[code, label]
	);
	return code;
}

async function usernameSignIn(username, suppliedPassword) {
	const response = await fetch(`${stack.url}/functions/v1/username-sign-in`, {
		method: 'POST',
		headers: {
			apikey: stack.anonKey,
			authorization: `Bearer ${stack.anonKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ username, password: suppliedPassword })
	});
	let body = null;
	try {
		body = await response.json();
	} catch {
		body = {};
	}
	return { response, body };
}

async function sessionAccepts(body) {
	if (!body?.access_token || !body?.refresh_token) return false;
	const client = createClient(stack.url, stack.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data, error } = await client.auth.setSession({
		access_token: body.access_token,
		refresh_token: body.refresh_token
	});
	return !error && Boolean(data.session?.user?.id);
}

try {
	// Existing accounts: the new exchange returns usable tokens, never an email.
	const existing = await makeAuthUser('existing', 'scout');
	const valid = await usernameSignIn(existing.username, password);
	ok('existing account signs in through the private endpoint', valid.response.status === 200,
		`${valid.response.status} ${JSON.stringify(valid.body)}`);
	ok('the response contains no email address', !JSON.stringify(valid.body).includes(existing.email));
	ok('the returned token pair installs as a real session', await sessionAccepts(valid.body));

	const wrong = await usernameSignIn(existing.username, 'wrong-password');
	const missing = await usernameSignIn(`${mark.slice(0, 14)}.missing`.slice(0, 24), 'wrong-password');
	ok('wrong passwords are rejected', wrong.response.status === 401);
	ok('unknown usernames are rejected identically',
		missing.response.status === 401 && JSON.stringify(missing.body) === JSON.stringify(wrong.body));
	ok('credential failures do not disclose an address',
		!/@/.test(JSON.stringify(wrong.body)) && !/@/.test(JSON.stringify(missing.body)));

	// Invite signup: create auth user, redeem while authenticated, sign out, then
	// prove the newly chosen username reaches that same account.
	const inviteCode = await makeInvite('INV');
	const inviteEmail = `${mark}.invite@example.com`;
	const inviteUsername = `${mark.slice(0, 14)}.invite`.slice(0, 24);
	const inviteClient = createClient(stack.url, stack.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: inviteAuth, error: inviteSignUpError } = await inviteClient.auth.signUp({
		email: inviteEmail,
		password
	});
	if (inviteAuth.user?.id) ids.push(inviteAuth.user.id);
	ok('invite signup still creates an authenticated user', !inviteSignUpError && Boolean(inviteAuth.session));
	const { error: redeemError } = await inviteClient.rpc('redeem_invite', {
		p_code: inviteCode,
		p_username: inviteUsername,
		p_first: 'ignored',
		p_last: 'ignored',
		p_recovery_email: inviteEmail
	});
	ok('invite redemption still creates the profile', !redeemError, redeemError?.message);
	await inviteClient.auth.signOut();
	const invitedLogin = await usernameSignIn(inviteUsername, password);
	ok('an invite-created account can sign out and return by username',
		invitedLogin.response.status === 200 && await sessionAccepts(invitedLogin.body),
		`${invitedLogin.response.status} ${JSON.stringify(invitedLogin.body)}`);

	// Resume path: signUp succeeds, redemption fails, and the same authenticated
	// orphan redeems a corrected invite without creating a second auth user.
	const orphanEmail = `${mark}.orphan@example.com`;
	const orphanUsername = `${mark.slice(0, 14)}.orphan`.slice(0, 24);
	const orphanClient = createClient(stack.url, stack.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: orphanAuth, error: orphanSignUpError } = await orphanClient.auth.signUp({
		email: orphanEmail,
		password
	});
	if (orphanAuth.user?.id) ids.push(orphanAuth.user.id);
	ok('orphan fixture starts as a signed-in auth user', !orphanSignUpError && Boolean(orphanAuth.session));
	const { error: firstRedeemError } = await orphanClient.rpc('redeem_invite', {
		p_code: 'BADBAD',
		p_username: orphanUsername,
		p_first: 'ignored',
		p_last: 'ignored',
		p_recovery_email: orphanEmail
	});
	ok('an invalid invite leaves setup unfinished', Boolean(firstRedeemError));
	const resumeCode = await makeInvite('RES');
	const { error: resumeError } = await orphanClient.rpc('redeem_invite', {
		p_code: resumeCode,
		p_username: orphanUsername,
		p_first: 'ignored',
		p_last: 'ignored',
		p_recovery_email: orphanEmail
	});
	ok('the signed-in orphan can resume with a valid invite', !resumeError, resumeError?.message);
	await orphanClient.auth.signOut();
	const resumedLogin = await usernameSignIn(orphanUsername, password);
	ok('the resumed account remains reachable by username', resumedLogin.response.status === 200,
		`${resumedLogin.response.status} ${JSON.stringify(resumedLogin.body)}`);

	// Manager-created path: invoke the actual Edge Function, then use the returned
	// temporary password through the new endpoint. This is the onboarding flow most
	// likely to be broken by an auth rollout while ordinary signup still passes.
	const manager = await makeAuthUser('manager', 'manager');
	const managerClient = createClient(stack.url, stack.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { error: managerLoginError } = await managerClient.auth.signInWithPassword({
		email: manager.email,
		password
	});
	if (managerLoginError) throw managerLoginError;
	const managedEmail = `${mark}.managed@example.com`;
	const { data: managed, error: managedError } = await managerClient.functions.invoke('create-account', {
		body: { firstName: 'Managed', lastName: 'Rollout', email: managedEmail, role: 'scout' }
	});
	ok('manager-created account flow still succeeds', !managedError && Boolean(managed?.username), managedError?.message);
	const managedRows = await sql(
		`select p.id, p.must_change_password
		   from public.profiles p join auth.users u on u.id = p.id
		  where u.email = $1`,
		[managedEmail]
	);
	if (managedRows[0]?.id) ids.push(managedRows[0].id);
	ok('managed account still requires its temporary password to be replaced',
		managedRows[0]?.must_change_password === true);
	const managedLogin = await usernameSignIn(managed?.username ?? 'missing', managed?.temporaryPassword ?? 'missing');
	ok('managed temporary credentials work through private username sign-in',
		managedLogin.response.status === 200 && await sessionAccepts(managedLogin.body),
		`${managedLogin.response.status} ${JSON.stringify(managedLogin.body)}`);

	// Ten failures are allowed for one account/network pair; the next is stopped
	// before another password hash. Invalid usernames receive the same protection.
	const rateUsername = `${mark.slice(0, 14)}.rate`.slice(0, 24);
	let rateResponse;
	for (let i = 0; i < 11; i += 1) rateResponse = await usernameSignIn(rateUsername, 'wrong-password');
	ok('the eleventh failure is rate limited', rateResponse?.response.status === 429);
	ok('rate-limit responses tell the client when to retry', Boolean(rateResponse?.response.headers.get('retry-after')));
} finally {
	if (ids.length) {
		await sql('delete from public.profiles where id = any($1::uuid[])', [ids]);
		await sql('delete from auth.users where id = any($1::uuid[])', [ids]);
	}
	if (inviteCodes.length) await sql('delete from public.invites where code = any($1::text[])', [inviteCodes]);
	await sql('delete from public.username_sign_in_limits');
	await db.end();
}

console.log(`username auth rollout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
