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

// Production by default, overridable at BUILD time for local work.
//
// The values are intentionally public — the anon key is a JWT scoped to the
// `anon` role and, since 0020, that role can reach nothing at all.
//
// The override exists because signed-in surfaces could not be exercised
// locally: the dev server pointed at production, so testing Studio or the event
// picker meant having a production password. `import.meta.env` is inlined by
// Vite at build time, so a missing variable falls back to production and a
// deployed bundle is unchanged.
//
//   echo 'VITE_SUPABASE_URL=http://127.0.0.1:54321' >> .env.local
//   echo 'VITE_SUPABASE_ANON_KEY=<supabase status ANON_KEY>' >> .env.local
//
// .env.local is gitignored by SvelteKit's default template.
export const SUPABASE_URL =
	import.meta.env?.VITE_SUPABASE_URL || 'https://hhvpkgwgkuiemxyarsuk.supabase.co';
export const SUPABASE_ANON_KEY =
	import.meta.env?.VITE_SUPABASE_ANON_KEY ||
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodnBrZ3dna3VpZW14eWFyc3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzM3NjAsImV4cCI6MjA5MzQ0OTc2MH0.rDd0ZX3KxJ5SXKjNr11rn1QXS1_9t2cLEOaOnbcClKs';

/**
 * Derive a deterministic UUID-shaped session id from an event code so the
 * Postgres `event_id uuid` column doesn't have to change. The same event
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
 * UUID).
 *
 * **The `x-session-id` header no longer authorises anything.** It used to be the
 * partition: policies read it through `current_setting('request.headers')` and
 * every scoped request carried the event that way. `0020` dropped all of that —
 * the column, 29 policies, and the passphrase's `has_manager_token()` with them.
 * Access is membership now, and the policies ask `manages_event()`.
 *
 * The header is still sent, and is inert. It stays only because removing it
 * touches 28 call sites for no behavioural gain; `check_rls.mjs` deliberately
 * sends NO header in its membership block precisely so the suite cannot pass on
 * the strength of this vestige. Treat it as a label, like `events.code`.
 *
 * @param {string} sessionId
 * @param {object} [opts]  reserved; no options are read today
 */
export function createSupabaseClient(sessionId, opts = {}) {
	if (!isUuid(sessionId)) {
		throw new Error('Supabase client requires a valid session id.');
	}
	// One client per event, for the life of the tab.
	//
	// This built a new client on every call, and 24 call sites call it — four of
	// them on every 30-second sync tick (schedule, assignments, overrides,
	// reminders). Each one came with its own GoTrueClient, and a GoTrueClient in
	// a browser adds a `visibilitychange` listener to `window` that nothing ever
	// removes. So no client was ever collected: roughly 500 an hour, every one of
	// them woken each time the phone was unlocked or the tab came back, and a
	// "Multiple GoTrueClient instances" warning for each in the console. Only the
	// sync layer kept a cache; everything else leaked.
	let client = clients.get(sessionId);
	if (!client) {
		client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			// The token comes from the one auth client, asked at request time — not at
			// construction, so a cached client sees sign-in, sign-out and every
			// refresh. Supplying it this way also means supabase-js builds no auth
			// client of its own at all, which is what the leak above was made of.
			// No session answers null, and the request goes out under the anon key.
			accessToken: currentAccessToken,
			global: { headers: { 'x-session-id': sessionId } }
		});
		clients.set(sessionId, client);
	}
	return client;
}

/** @type {Map<string, import('@supabase/supabase-js').SupabaseClient>} */
const clients = new Map();

/**
 * The current user's access token, or null when nobody is signed in. A failed
 * read is null too: the request goes out under the anon key, is refused by RLS,
 * and the sync layer retries once auth recovers.
 */
async function currentAccessToken() {
	try {
		const { data } = await getAuthClient().auth.getSession();
		return data.session?.access_token ?? null;
	} catch (_error) {
		return null;
	}
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
