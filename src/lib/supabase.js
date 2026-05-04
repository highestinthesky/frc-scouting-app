// Supabase client factory for the wireless sync layer.
//
// We don't keep one long-lived client. Sessions are scoped by an `x-session-id`
// header that has to be set on the client at construction time, and the active
// session can change at runtime (a scout joins a different team mid-event,
// rotates their session, etc.). So we recreate the client whenever the session
// id changes.
//
// The URL and anon key below are *intentionally public*. The anon key is
// signed with a JWT that grants only the `anon` role, which has no power
// outside what RLS policies allow. Our RLS policies require the
// `x-session-id` header on every request — knowing the anon key without
// knowing a session UUID gets you nothing.

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://hhvpkgwgkuiemxyarsuk.supabase.co';
export const SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodnBrZ3dna3VpZW14eWFyc3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzM3NjAsImV4cCI6MjA5MzQ0OTc2MH0.rDd0ZX3KxJ5SXKjNr11rn1QXS1_9t2cLEOaOnbcClKs';

/**
 * Build a Supabase client scoped to a session UUID. The header is read by
 * Postgres in the RLS policy via `current_setting('request.headers')` — every
 * SELECT/INSERT/DELETE we make automatically carries the team's scope.
 *
 * @param {string} sessionId  the team's session UUID
 */
export function createSupabaseClient(sessionId) {
	if (!isUuid(sessionId)) {
		throw new Error('Supabase client requires a valid session UUID.');
	}
	return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			// We don't use Supabase auth — the session UUID is our only credential.
			// Disable auto-refresh and persistence so the SDK doesn't write spurious
			// data into IndexedDB.
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false
		},
		global: {
			headers: { 'x-session-id': sessionId }
		}
	});
}

/** RFC 4122 v4 UUID, lowercase, with hyphens. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when `s` is a syntactically valid UUID. */
export function isUuid(s) {
	return typeof s === 'string' && UUID_RE.test(s);
}

/** Generate a fresh session UUID using the platform's CSPRNG. */
export function newSessionId() {
	// crypto.randomUUID is available in every browser we target (since 2022)
	// and in Node 19+. Avoid manual entropy — it's the JS equivalent of
	// rolling your own crypto.
	return crypto.randomUUID();
}
