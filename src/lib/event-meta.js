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

/**
 * Rotate the manager passphrase. Requires the current token (so a stolen
 * device can't quietly change it) — RLS on UPDATE checks has_manager_token().
 *
 * @param {string} eventCode
 * @param {string} currentToken   the device's locally-known managerToken
 * @param {string} newPassphrase  the new passphrase the manager just chose
 * @returns {Promise<string>}  the new hashed token (also store this locally)
 */
export async function rotatePassphrase(eventCode, currentToken, newPassphrase) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event code.');
	if (!currentToken) throw new Error('Current manager token missing on this device.');
	if (!newPassphrase || !newPassphrase.trim()) throw new Error('New passphrase is empty.');
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id.');
	const newToken = await hashManagerToken(newPassphrase.trim(), code);
	const client = createSupabaseClient(sid, { managerToken: currentToken });
	const { data, error } = await client
		.from('event_meta')
		.update({ manager_token: newToken, updated_at: new Date().toISOString() })
		.eq('session_id', sid)
		.select('session_id');
	if (error) throw mapErr(error, 'rotate passphrase');
	if (!Array.isArray(data) || data.length !== 1) {
		throw new Error('Rotation did not match a row — your current passphrase may be stale.');
	}
	return newToken;
}

/**
 * Wipe scheduling state for the event: event_meta, schedules, and
 * assignments. Entries are untouched. Requires a valid manager token.
 *
 * After a successful reset the event re-enters bootstrap mode — the next
 * device to set a passphrase wins. Useful when a passphrase needs to be
 * fully invalidated (e.g., a previous manager left the team).
 *
 * @param {string} eventCode
 * @param {string} managerToken
 */
export async function resetEventData(eventCode, managerToken) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event code.');
	if (!managerToken) {
		throw new Error('Manager passphrase required on this device to reset.');
	}
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id.');
	const client = createSupabaseClient(sid, { managerToken });
	const { error } = await client.rpc('reset_event_data');
	if (error) throw mapErr(error, 'reset event data');
}

function mapErr(err, action) {
	const msg = err?.message || String(err);
	return new Error(`Couldn't ${action}: ${msg}`);
}
