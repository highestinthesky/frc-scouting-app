// Exchange a team username + password for a Supabase session without revealing
// the real email address that Supabase Auth uses internally.
//
// This function is intentionally public (`verify_jwt = false`): it runs before a
// session exists. That makes each guard below part of the authentication boundary.
// Never return the resolved email, distinguish an unknown username from a wrong
// password, or log either credential.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			...CORS,
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...extra
		}
	});

const INVALID = { error: 'That username and password do not match.' };
const USERNAME_RE = /^[a-z0-9._-]{3,24}$/;
const ATTEMPT_LIMIT = 10;
const WINDOW_SECONDS = 15 * 60;

function clientIp(req: Request): string {
	// Supabase's gateway supplies the first two in production. x-forwarded-for is
	// last because a caller can append values; only its first hop is relevant.
	return (
		req.headers.get('cf-connecting-ip') ??
		req.headers.get('x-real-ip') ??
		req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown'
	);
}

async function rateBucket(ip: string, username: string): Promise<string> {
	// HMAC rather than a bare hash: someone with database read access cannot turn
	// a bucket back into a known scout + address pair. Rotating service_role simply
	// resets the short-lived buckets, which is harmless.
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(SERVICE_KEY),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(`${ip}\u0000${username}`)
	);
	return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
	if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

	let body: { username?: unknown; password?: unknown };
	try {
		body = await req.json();
	} catch {
		return json(INVALID, 401);
	}

	const username = String(body.username ?? '').trim().toLowerCase();
	const password = typeof body.password === 'string' ? body.password : '';
	// Keep malformed requests on the same observable path as unknown credentials.
	// Length caps also stop an unauthenticated caller sending unbounded bodies into
	// the database or password hasher.
	const syntacticallyValid = USERNAME_RE.test(username) && password.length >= 1 && password.length <= 1024;
	const bucket = await rateBucket(clientIp(req), username.slice(0, 64));

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: rateRows, error: rateError } = await admin.rpc(
		'consume_username_sign_in_attempt',
		{ p_bucket: bucket, p_limit: ATTEMPT_LIMIT, p_window_seconds: WINDOW_SECONDS }
	);
	if (rateError) return json({ error: 'Sign-in is temporarily unavailable.' }, 503);

	const decision = Array.isArray(rateRows) ? rateRows[0] : rateRows;
	if (!decision?.allowed) {
		const retryAfter = Math.max(1, Number(decision?.retry_after_seconds) || WINDOW_SECONDS);
		return json(
			{ error: 'Too many sign-in attempts. Try again later.' },
			429,
			{ 'Retry-After': String(retryAfter) }
		);
	}

	let email: string | null = null;
	if (syntacticallyValid) {
		// Application tables intentionally grant service_role no direct DML. The
		// existing SECURITY DEFINER lookup is the narrow bridge into auth.users;
		// migration 0024 grants it to service_role, and the rollout gate removes its
		// browser grants while retaining this one.
		const { data: resolved, error: lookupError } = await admin.rpc('email_for_username', {
			p_username: username
		});
		if (!lookupError && typeof resolved === 'string') email = resolved;
	}

	// Still call GoTrue for an unknown username. Besides keeping the response
	// generic, this avoids making account existence obvious from request timing.
	const login = createClient(SUPABASE_URL, ANON_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const dummyEmail = `missing-${bucket.slice(0, 24)}@scout.invalid`;
	const { data, error } = await login.auth.signInWithPassword({
		email: email ?? dummyEmail,
		password: syntacticallyValid ? password : 'invalid-credential'
	});

	if (error || !data.session?.access_token || !data.session?.refresh_token) {
		return json(INVALID, 401);
	}

	// A successful password proves this is the account owner. Clear their typo
	// history so a later mistake does not inherit today's near-lockout state.
	await admin.rpc('clear_username_sign_in_attempt', { p_bucket: bucket });

	// Tokens are all the client needs for setSession(). The email and profile never
	// cross this pre-auth boundary; after setSession, ordinary authenticated APIs
	// may of course return the signed-in user's own account data.
	return json({
		access_token: data.session.access_token,
		refresh_token: data.session.refresh_token
	});
});
