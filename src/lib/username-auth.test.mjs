import {
	CREDENTIAL_ERROR,
	NETWORK_ERROR,
	RATE_LIMIT_ERROR,
	establishUsernameSession
} from './username-auth.js';

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
	if (condition) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

function clientWith(invokeResult, sessionResult = { data: { session: { user: { id: 'u1' } } }, error: null }) {
	const calls = { invoke: [], setSession: [] };
	return {
		calls,
		client: {
			functions: {
				async invoke(...args) {
					calls.invoke.push(args);
					if (invokeResult instanceof Error) throw invokeResult;
					return invokeResult;
				}
			},
			auth: {
				async setSession(value) {
					calls.setSession.push(value);
					return sessionResult;
				}
			}
		}
	};
}

{
	const fixture = clientWith({
		data: { access_token: 'access', refresh_token: 'refresh' },
		error: null
	});
	// The password fixture carries surrounding spaces deliberately. Without them
	// the byte-for-byte assertion below cannot fail: the username one line up IS
	// trimmed, so trimming the password too is the natural next edit, and a scout
	// handed a one-time password ending in a space would silently stop matching.
	const result = await establishUsernameSession(fixture.client, '  Scout.One  ', '  do not normalize me  ');
	ok('a valid exchange succeeds', result.ok === true);
	ok('the private endpoint receives a normalized username',
		fixture.calls.invoke[0]?.[0] === 'username-sign-in' &&
		fixture.calls.invoke[0]?.[1]?.body?.username === 'scout.one');
	ok('the password is passed byte-for-byte',
		fixture.calls.invoke[0]?.[1]?.body?.password === '  do not normalize me  ');
	ok('returned tokens are installed in the persistent auth client',
		fixture.calls.setSession[0]?.access_token === 'access' &&
		fixture.calls.setSession[0]?.refresh_token === 'refresh');
}

for (const [name, status, expected] of [
	['invalid credentials stay generic', 401, CREDENTIAL_ERROR],
	['rate limiting has an actionable message', 429, RATE_LIMIT_ERROR],
	['server failures are not called bad passwords', 503, NETWORK_ERROR]
]) {
	const fixture = clientWith({ data: null, error: { name: 'FunctionsHttpError', context: { status } } });
	const result = await establishUsernameSession(fixture.client, 'scout', 'wrong');
	ok(name, result.ok === false && result.message === expected, result.message);
	ok(`${name}: no partial session is installed`, fixture.calls.setSession.length === 0);
}

{
	const fixture = clientWith(new Error('offline'));
	const result = await establishUsernameSession(fixture.client, 'scout', 'password');
	ok('a fetch failure reports connectivity', result.ok === false && result.message === NETWORK_ERROR);
}

{
	const fixture = clientWith({ data: { access_token: 'only-one-token' }, error: null });
	const result = await establishUsernameSession(fixture.client, 'scout', 'password');
	ok('a malformed success response is rejected', result.ok === false && result.message === NETWORK_ERROR);
	ok('a malformed response cannot install a partial session', fixture.calls.setSession.length === 0);
}

{
	const fixture = clientWith(
		{ data: { access_token: 'access', refresh_token: 'refresh' }, error: null },
		{ data: { session: null }, error: new Error('invalid token') }
	);
	const result = await establishUsernameSession(fixture.client, 'scout', 'password');
	ok('setSession validates the returned tokens', result.ok === false && result.message === NETWORK_ERROR);
}

console.log(`username auth: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
