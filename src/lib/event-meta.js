// Event-level metadata stored on Supabase. Today this is just the manager
// passphrase hash — `event_meta` has one row per event, keyed by
// session_id (the UUID derived from the event code).
//
// The raw passphrase never leaves the manager's device. The client hashes
// it as `SHA-256(passphrase + ':' + eventCode)` and uploads the hash. That
// hash is what `has_manager_token()` checks server-side when gating writes
// to `schedules` and `assignments`.

import { createSupabaseClient, deriveSessionId, hashManagerToken } from './supabase.js';

/**
 * Has a manager passphrase been set for this event yet?
 *
 * @param {string} eventCode
 * @returns {Promise<boolean>}
 */
export async function isPassphraseSet(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return false;
	const sid = await deriveSessionId(code);
	if (!sid) return false;
	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('event_meta')
		.select('manager_token')
		.eq('session_id', sid)
		.maybeSingle();
	if (error) throw mapErr(error, 'check passphrase');
	return Boolean(data?.manager_token);
}

/**
 * Set the manager passphrase for this event for the first time. Fails if
 * one is already set (server-side INSERT policy blocks it).
 *
 * @param {string} eventCode
 * @param {string} passphrase
 * @returns {Promise<string>}  the hashed token, also stored locally
 */
export async function setPassphrase(eventCode, passphrase) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event code.');
	if (!passphrase || !passphrase.trim()) throw new Error('Passphrase is empty.');
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id.');
	const token = await hashManagerToken(passphrase.trim(), code);
	const client = createSupabaseClient(sid);
	const { error } = await client.from('event_meta').insert({
		session_id: sid,
		event_code: code,
		manager_token: token
	});
	if (error) {
		// Duplicate key (passphrase already set) → unique_violation.
		if (error.code === '23505') {
			throw new Error(
				'A passphrase has already been set for this event. Ask whoever set it, or clear the event_meta row from Supabase Studio to reset.'
			);
		}
		throw mapErr(error, 'set passphrase');
	}
	return token;
}

/**
 * Verify a passphrase against the stored hash by attempting a no-op update
 * on the event_meta row. If the policy passes, the update succeeds; if
 * not, RLS silently returns zero rows. Either way we leave the row alone.
 *
 * @param {string} eventCode
 * @param {string} passphrase
 * @returns {Promise<{ ok: boolean, token: string }>}  token is the hash to
 *          stash locally on success
 */
export async function verifyPassphrase(eventCode, passphrase) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return { ok: false, token: '' };
	const sid = await deriveSessionId(code);
	if (!sid) return { ok: false, token: '' };
	const token = await hashManagerToken((passphrase ?? '').trim(), code);
	const client = createSupabaseClient(sid, { managerToken: token });
	// Touch updated_at — succeeds iff has_manager_token() returns true.
	const { data, error } = await client
		.from('event_meta')
		.update({ updated_at: new Date().toISOString() })
		.eq('session_id', sid)
		.select('session_id');
	if (error) throw mapErr(error, 'verify passphrase');
	return { ok: Array.isArray(data) && data.length === 1, token };
}

function mapErr(err, action) {
	const msg = err?.message || String(err);
	return new Error(`Couldn't ${action}: ${msg}`);
}
