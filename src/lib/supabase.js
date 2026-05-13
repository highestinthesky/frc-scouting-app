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
 * Optionally include an x-manager-token header. That header is required by
 * the schedules and assignments tables' write policies (event_meta gates
 * everything via has_manager_token()). Reads don't need it.
 *
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.managerToken]  Hex SHA-256 hash of (passphrase + ':' + eventCode).
 */
export function createSupabaseClient(sessionId, opts = {}) {
	if (!isUuid(sessionId)) {
		throw new Error('Supabase client requires a valid session id.');
	}
	const headers = { 'x-session-id': sessionId };
	if (opts.managerToken) headers['x-manager-token'] = opts.managerToken;
	return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			// We don't use Supabase auth — the derived session id is our only
			// scoping primitive. Disable refresh and persistence so the SDK
			// doesn't write spurious data into IndexedDB.
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false
		},
		global: { headers }
	});
}

// ─── client-side passphrase hashing ────────────────────────────────────────

/**
 * Compute the manager-token hash for a passphrase + event code combination.
 * This is what gets sent as `x-manager-token` and stored in `event_meta`.
 *
 * Threat model: this hash is access-equivalent to the passphrase (replay), so
 * treat it like a password. Per-event salting (via the event code suffix)
 * means hashes from different events don't collide.
 *
 * @param {string} passphrase
 * @param {string} eventCode
 * @returns {Promise<string>}  64-char lowercase hex SHA-256
 */
export async function hashManagerToken(passphrase, eventCode) {
	if (!passphrase) return '';
	const code = (eventCode ?? '').trim().toLowerCase();
	const data = new TextEncoder().encode(`${passphrase}:${code}`);
	const buf = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** RFC 4122 / v8 UUID, lowercase, with hyphens. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when `s` is syntactically a UUID. */
export function isUuid(s) {
	return typeof s === 'string' && UUID_RE.test(s);
}
