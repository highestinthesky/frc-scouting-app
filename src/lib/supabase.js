// Supabase client factory for the wireless sync layer.
//
// Sync scope is the FRC event code. Two devices typing the same event code
// in Settings end up sharing data. We don't issue per-team UUIDs — the event
// code itself, hashed into a UUID-shaped string, is the session id.
//
// Trade-off: there's no secret. Anyone who knows your event code (it's
// public on TBA) and has the app URL can read your scouting and write
// junk to it. The user has accepted that — files are still the offline
// fallback if a real venue ever needs locked-down data.
//
// The URL and anon key below are *intentionally public*. The anon key
// is a JWT scoped to the `anon` role and can't do anything outside what
// RLS policies allow. RLS scopes by the `x-session-id` header we set
// per request; without that header, every read returns zero rows.

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://hhvpkgwgkuiemxyarsuk.supabase.co';
export const SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodnBrZ3dna3VpZW14eWFyc3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzM3NjAsImV4cCI6MjA5MzQ0OTc2MH0.rDd0ZX3KxJ5SXKjNr11rn1QXS1_9t2cLEOaOnbcClKs';

/**
 * Derive a deterministic UUID-shaped session id from an event code so the
 * Postgres `session_id uuid` column doesn't have to change. The same event
 * code always produces the same UUID; different codes produce different
 * UUIDs.
 *
 * @param {string} eventCode  e.g. "2027hvr"
 * @returns {Promise<string|null>}  RFC 4122 v8-shaped UUID, or null if input
 *                                  is empty/invalid.
 */
export async function deriveSessionId(eventCode) {
	if (typeof eventCode !== 'string') return null;
	const code = eventCode.trim().toLowerCase();
	if (!code) return null;
	// Namespace the input so the same event code can't accidentally collide
	// with anyone else hashing event codes for some unrelated app.
	const data = new TextEncoder().encode(`frc-scout:event:${code}`);
	const hashBuf = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(hashBuf, 0, 16);
	// Set version (high nibble of byte 6) to 8 — a "custom" UUID variant.
	bytes[6] = (bytes[6] & 0x0f) | 0x80;
	// Set variant (high bits of byte 8) to 10 — RFC 4122.
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = (start, end) =>
		[...bytes.slice(start, end)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}`;
}

/**
 * Build a Supabase client bound to a specific session id (an event-derived
 * UUID). The header is read by Postgres in the RLS policy via
 * `current_setting('request.headers')` — every SELECT/INSERT/DELETE we make
 * automatically carries the event's scope.
 *
 * No credential header any more. Manager writes used to carry x-manager-token,
 * a hash of a shared passphrase, and 0020 dropped the function that read it.
 * Authorisation now rides the access token: the policies ask manages_event(),
 * which is membership plus role.
 *
 * @param {string} sessionId
 * @param {object} [opts]  reserved; no options are read today
 */
export function createSupabaseClient(sessionId, opts = {}) {
	if (!isUuid(sessionId)) {
		throw new Error('Supabase client requires a valid session id.');
	}
	const headers = { 'x-session-id': sessionId };
	return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			// Event clients never own or persist an auth session. Their fetch
			// wrapper below asks the single auth client for its current token on
			// every request. Reading the same storage key here only captures the
			// session when this client is constructed; cached event clients would
			// otherwise keep sending a token from before the latest refresh.
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false
		},
		global: { headers, fetch: fetchWithCurrentAuth }
	});
}

/**
 * Supabase's data client starts each request with the anon-key Authorization
 * header. Replace it with the access token owned by the current auth client,
 * when one exists. With no session (the pre-cutover legacy path), leaving the
 * header alone intentionally keeps anonymous event-code sync working.
 *
 * This runs at request time, not client-construction time, so a cached event
 * client immediately sees sign-in, sign-out and token refreshes.
 */
async function fetchWithCurrentAuth(input, init = {}) {
	try {
		const { data } = await getAuthClient().auth.getSession();
		const token = data.session?.access_token;
		if (token) {
			const headers = new Headers(init.headers);
			headers.set('authorization', `Bearer ${token}`);
			return fetch(input, { ...init, headers });
		}
	} catch (_error) {
		// A refresh/read failure must not break the legacy anonymous path. The
		// request will either work under the additive policies or be rejected
		// after cutover and retried by the sync layer when auth recovers.
	}
	return fetch(input, init);
}

// ─── auth ──────────────────────────────────────────────────────────────────
//
// One persisted auth session, owned by one client. Event-scoped data clients
// borrow its current access token through fetchWithCurrentAuth() above.

const AUTH_STORAGE = {
	persistSession: true,
	detectSessionInUrl: false,
	storageKey: 'frc-scout-auth'
};

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let authClient = null;

/**
 * The one client that owns the auth session and its refresh loop. Also the
 * client for RPCs that aren't scoped to an event — redeem_invite,
 * create_invite — and for reading profiles.
 */
export function getAuthClient() {
	if (!authClient) {
		authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { ...AUTH_STORAGE, autoRefreshToken: true }
		});
	}
	return authClient;
}

/** RFC 4122 / v8 UUID, lowercase, with hyphens. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when `s` is syntactically a UUID. */
export function isUuid(s) {
	return typeof s === 'string' && UUID_RE.test(s);
}
