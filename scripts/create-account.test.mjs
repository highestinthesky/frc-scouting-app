// Run the actual Edge Function with the real Supabase client. Only HTTP is
// replaced; the handler, SDK request bodies and response handling stay real.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';
import { createClient } from '@supabase/supabase-js';

const source = readFileSync(new URL('../supabase/functions/create-account/index.ts', import.meta.url), 'utf8')
	.replace(/^import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';$/m, '');
const { code } = await transformWithEsbuild(source, 'create-account.ts', { loader: 'ts', target: 'es2022' });
const MANAGER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_ID = '22222222-2222-4222-8222-222222222222';

function fixture({ existing = 'revoked', releaseError = null, retryError = null, profileError = null } = {}) {
	let handler;
	let attempts = 0;
	const calls = [];
	const reply = (body, status = 200) => new Response(JSON.stringify(body), {
		status, headers: { 'Content-Type': 'application/json' }
	});
	const fetch = async (input, options = {}) => {
		const url = new URL(input instanceof Request ? input.url : input);
		const method = options.method ?? 'GET';
		const body = options.body ? JSON.parse(options.body) : null;
		calls.push({ path: url.pathname, method, body });
		if (url.pathname === '/auth/v1/user') return reply({ id: MANAGER_ID, email: 'manager@example.com' });
		if (url.pathname === '/rest/v1/rpc/username_taken') return reply(false);
		if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
			attempts++;
			if ((attempts === 1 && existing) || (attempts === 2 && retryError)) {
				return reply({ code: 'email_exists', msg: retryError && attempts === 2 ? retryError : 'A user with this email address has already been registered' }, 422);
			}
			return reply({ user: { id: CREATED_ID, email: body.email } });
		}
		if (url.pathname === '/rest/v1/rpc/delete_orphan_auth_user_for_email') {
			assert.deepEqual(body, { p_actor: MANAGER_ID, p_email: 'scout@example.com', p_role: 'scout' });
			return releaseError ? reply(releaseError, releaseError.code === '42501' ? 403 : 500) : reply(existing === 'revoked');
		}
		if (url.pathname === '/rest/v1/rpc/create_managed_profile') {
			assert.equal(body.p_id, CREATED_ID);
			return profileError ? reply(profileError, 403) : new Response(null, { status: 204 });
		}
		if (url.pathname === `/auth/v1/admin/users/${CREATED_ID}` && method === 'DELETE') return reply({ user: { id: CREATED_ID } });
		// The old lookup-then-delete sequence must never be reached for reuse.
		return reply({ code: 'PGRST202', message: `Unexpected request: ${method} ${url.pathname}` }, 404);
	};
	vm.runInNewContext(code, {
		Request, Response, Uint8Array, crypto: webcrypto,
		createClient: (url, key, options = {}) => createClient(url, key, {
			...options, global: { ...options.global, fetch }, auth: { persistSession: false, autoRefreshToken: false }
		}),
		Deno: {
			env: { get: (name) => name === 'SUPABASE_URL' ? 'https://account.test' : 'test-key' },
			serve: (fn) => { handler = fn; }
		}
	});
	return {
		calls,
		invoke: (overrides = {}) => handler(new Request('https://account.test/functions/v1/create-account', {
			method: 'POST', headers: { Authorization: 'Bearer manager-token', 'Content-Type': 'application/json' },
			body: JSON.stringify({ firstName: 'Scout', lastName: 'Test', email: ' Scout@Example.com ', role: 'scout' }),
			...overrides
		}))
	};
}

await test('a revoked email is released atomically before a replacement is created', async () => {
	const f = fixture();
	const response = await f.invoke();
	assert.equal(response.status, 200, await response.clone().text());
	const body = await response.json();
	assert.match(body.username, /^st\d{6}$/);
	assert.equal(body.temporaryPassword.length, 10);
	assert.equal(body.role, 'scout');
	assert.deepEqual(f.calls.map((c) => c.path), [
		'/auth/v1/user', '/rest/v1/rpc/username_taken', '/auth/v1/admin/users',
		'/rest/v1/rpc/delete_orphan_auth_user_for_email', '/auth/v1/admin/users', '/rest/v1/rpc/create_managed_profile'
	]);
});

await test('an active account is preserved and reports an email conflict', async () => {
	const f = fixture({ existing: 'active' });
	const response = await f.invoke();
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error, 'That email address already has an account.');
	assert.equal(f.calls.filter((c) => c.path === '/auth/v1/admin/users').length, 1);
	assert.ok(!f.calls.some((c) => c.method === 'DELETE'));
});

await test('a fresh email creates an account without attempting orphan cleanup', async () => {
	const f = fixture({ existing: null });
	assert.equal((await f.invoke()).status, 200);
	assert.ok(!f.calls.some((c) => c.path.includes('orphan')));
});

for (const [label, error, status] of [
	['permission denial', { code: '42501', message: 'Only a manager can create accounts.' }, 403],
	['database failure', { code: 'XX000', message: 'Cleanup failed.' }, 500]
]) {
	await test(`${label} stops reuse before creating a replacement`, async () => {
		const f = fixture({ releaseError: error });
		const response = await f.invoke();
		assert.equal(response.status, status);
		assert.equal((await response.json()).error, error.message);
		assert.equal(f.calls.filter((c) => c.path === '/auth/v1/admin/users').length, 1);
		assert.ok(!f.calls.some((c) => c.method === 'DELETE'));
	});
}

await test('a failed retry reports the error without deleting another identity', async () => {
	const f = fixture({ retryError: 'Unable to create user' });
	const response = await f.invoke();
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error, 'Unable to create user');
	assert.equal(f.calls.filter((c) => c.path === '/auth/v1/admin/users').length, 2);
	assert.ok(!f.calls.some((c) => c.method === 'DELETE'));
});

await test('profile failure cleans up only the newly created account', async () => {
	const f = fixture({ profileError: { code: '42501', message: 'Manager access was revoked.' } });
	assert.equal((await f.invoke()).status, 403);
	assert.deepEqual(f.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), [`/auth/v1/admin/users/${CREATED_ID}`]);
});

await test('browser preflight accepts the headers used by the Supabase SDK', async () => {
	const f = fixture();
	const response = await f.invoke({ method: 'OPTIONS', body: undefined });
	assert.equal(response.status, 200);
	const allowed = response.headers.get('Access-Control-Allow-Headers').toLowerCase().split(/,\s*/);
	for (const name of ['authorization', 'content-type', 'apikey', 'x-client-info']) assert.ok(allowed.includes(name), name);
	assert.equal(f.calls.length, 0);
});

await test('a missing bearer token refuses account creation', async () => {
	const f = fixture();
	assert.equal((await f.invoke({ headers: { 'Content-Type': 'application/json' } })).status, 401);
	assert.equal(f.calls.length, 0);
});
