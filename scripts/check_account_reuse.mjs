// Real PostgreSQL checks for the service-only orphan cleanup, including two
// concurrent transactions. Fixtures are isolated and removed on every run.
// npm run test:account-reuse (requires local Supabase on port 54322)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const uri = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(uri).hostname), 'These tests only run against a local database.');
const clients = [];
const ids = [];
async function connection() {
	const db = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 5000 });
	await db.connect();
	await db.query("SET statement_timeout = '8s'");
	clients.push(db);
	return db;
}
const db = await connection();
const sql = async (text, params = []) => (await db.query(text, params)).rows;
const call = 'SELECT public.delete_orphan_auth_user_for_email($1,$2,$3::public.app_role) AS removed';

async function user(role = null) {
	const id = randomUUID();
	const username = `reuse-${id.slice(0, 8)}`;
	const email = `${id}@example.com`;
	ids.push(id);
	await sql('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, email]);
	if (role) await profile(db, { id, username }, role);
	return { id, username, email };
}
const insertProfile = 'INSERT INTO public.profiles(id,username,first_name,last_name,role) VALUES($1,$2,\'Reuse\',\'Check\',$3)';
const profile = (client, who, role = 'scout') => client.query(insertProfile, [who.id, who.username, role]);
async function release(actor, email, role = 'scout') {
	await sql('BEGIN');
	try {
		await sql('SET LOCAL ROLE service_role');
		return (await sql(call, [actor.id, email, role]))[0].removed;
	} finally { await sql('COMMIT'); }
}
async function waitForLock(client) {
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		const [activity] = await sql('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [client.processID]);
		if (activity?.wait_event_type === 'Lock') return;
		await delay(20);
	}
	assert.fail('The concurrent request never reached its database lock.');
}

try {
	await sql(readFileSync(new URL('../supabase/migrations/0031_reuse_revoked_account_email.sql', import.meta.url), 'utf8'));
	const [installed] = await sql("SELECT to_regprocedure('public.delete_orphan_auth_user_for_email(uuid,text,public.app_role)') IS NOT NULL AS present");
	await test('migration installs the atomic cleanup operation', () => assert.equal(installed.present, true));
	if (installed.present) {
		const manager = await user('manager');
		const superUser = await user('super');
		const scout = await user('scout');
		const outsider = await user();

		await test('only service_role can execute the cleanup', async () => {
			const [grants] = await sql(`SELECT
				has_function_privilege('anon','public.delete_orphan_auth_user_for_email(uuid,text,public.app_role)','EXECUTE') AS anon,
				has_function_privilege('authenticated','public.delete_orphan_auth_user_for_email(uuid,text,public.app_role)','EXECUTE') AS authenticated,
				has_function_privilege('service_role','public.delete_orphan_auth_user_for_email(uuid,text,public.app_role)','EXECUTE') AS service`);
			assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
		});

		await test('a manager releases an orphan email with case and whitespace normalization', async () => {
			const orphan = await user();
			assert.equal(await release(manager, ` ${orphan.email.toUpperCase()} `), true);
			assert.deepEqual(await sql('SELECT id FROM auth.users WHERE id=$1', [orphan.id]), []);
		});

		await test('an active account and its profile survive cleanup', async () => {
			assert.equal(await release(manager, scout.email), false);
			assert.equal((await sql('SELECT id FROM auth.users WHERE id=$1', [scout.id])).length, 1);
			assert.equal((await sql('SELECT id FROM public.profiles WHERE id=$1', [scout.id])).length, 1);
		});

		await test('an unknown email needs no cleanup', async () => {
			assert.equal(await release(manager, `${randomUUID()}@example.com`), false);
		});

		for (const [label, actor, role] of [
			['a scout', scout, 'scout'], ['an account without a profile', outsider, 'scout'],
			['a manager requesting a manager', manager, 'manager'], ['a manager requesting a super', manager, 'super'],
			['a missing role', manager, null]
		]) {
			await test(`${label} cannot remove an orphan`, async () => {
				const orphan = await user();
				await assert.rejects(release(actor, orphan.email, role), (error) => error.code === '42501');
				assert.equal((await sql('SELECT id FROM auth.users WHERE id=$1', [orphan.id])).length, 1);
			});
		}

		await test('a super can release an orphan for a privileged replacement', async () => {
			for (const role of ['manager', 'super']) {
				const orphan = await user();
				assert.equal(await release(superUser, orphan.email, role), true);
			}
		});

		await test('registration that commits first protects the newly active account', async () => {
			const orphan = await user();
			const signup = await connection();
			const cleanup = await connection();
			await signup.query('BEGIN');
			await profile(signup, orphan); // FK holds KEY SHARE on auth.users until commit.
			await cleanup.query('BEGIN');
			await cleanup.query('SET LOCAL ROLE service_role');
			const pending = cleanup.query(call, [manager.id, orphan.email, 'scout']);
			// Convert rejections to values immediately so a timeout cannot leave an
			// unhandled rejection while the observer is checking the lock.
			const outcome = pending.then((result) => ({ result }), (error) => ({ error }));
			try {
				await waitForLock(cleanup);
				await signup.query('COMMIT');
				const result = await outcome;
				if (result.error) throw result.error;
				assert.equal(result.result.rows[0].removed, false);
				await cleanup.query('COMMIT');
				assert.equal((await sql('SELECT id FROM public.profiles WHERE id=$1', [orphan.id])).length, 1);
			} finally {
				await signup.query('ROLLBACK');
				await cleanup.query('ROLLBACK');
				await outcome;
			}
		});

		await test('cleanup that commits first prevents a dangling profile', async () => {
			const orphan = await user();
			const cleanup = await connection();
			const signup = await connection();
			await cleanup.query('BEGIN');
			await cleanup.query('SET LOCAL ROLE service_role');
			assert.equal((await cleanup.query(call, [manager.id, orphan.email, 'scout'])).rows[0].removed, true);
			await signup.query('BEGIN');
			const outcome = profile(signup, orphan).then(() => null, (error) => error);
			try {
				await waitForLock(signup);
				await cleanup.query('COMMIT');
				assert.equal((await outcome)?.code, '23503');
				assert.deepEqual(await sql('SELECT id FROM auth.users WHERE id=$1', [orphan.id]), []);
				assert.deepEqual(await sql('SELECT id FROM public.profiles WHERE id=$1', [orphan.id]), []);
			} finally {
				await cleanup.query('ROLLBACK');
				await signup.query('ROLLBACK');
				await outcome;
			}
		});
	}
} finally {
	for (const client of clients) await client.query('ROLLBACK');
	await sql('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [ids]);
	await Promise.all(clients.map((client) => client.end()));
}
