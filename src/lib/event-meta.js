// Event-level operations that are not a row the app edits directly.
//
// ─── what used to be here ──────────────────────────────────────────────────
//
// Four passphrase functions: isPassphraseSet, setPassphrase, verifyPassphrase
// and rotatePassphrase. `event_meta.manager_token` held a SHA-256 of
// (passphrase + ':' + eventCode), the client sent it as `x-manager-token`, and
// has_manager_token() was what stood between a stranger and every manager write
// on the project.
//
// That was one shared secret for a whole team, typed into a form, with no way
// to tell who used it and no way to revoke it for one person. It existed
// because there were no accounts. There are accounts now: 0019 replaced the
// check with manages_event() — membership plus role — and 0020 dropped the
// function, the column and the policies that called it.
//
// Deleted rather than left inert on purpose. A dead credential path that still
// looks live is how someone later mistakes it for protection.

import { createSupabaseClient } from './supabase.js';
import { eventIdForCode } from './events.js';

/**
 * Archive the event: clear its planning state, keep every scouting entry.
 *
 * The one operation in the app that deletes. Server-side it is reset_event_data(),
 * which 0020 re-gates on manages_event() — so authority is the caller's role at
 * this event, checked by Postgres, rather than a header the client chose to
 * send.
 *
 * @param {string} eventCode
 */
export async function resetEventData(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event chosen.');
	const eventId = await eventIdForCode(code);
	if (!eventId) {
		throw new Error('That event is not one you are on.');
	}
	const client = createSupabaseClient(eventId);
	// The event is an argument now. It used to be read from the x-session-id
	// header, and 0020 stopped sending one — the function still falls back to the
	// header for a cached PWA that has not reloaded, but this client must not
	// rely on that.
	const { error } = await client.rpc('reset_event_data', { p_event: eventId });
	if (error) throw mapErr(error, 'archive the event');
}

function mapErr(err, action) {
	const msg = err?.message || String(err);
	return new Error(`Couldn't ${action}: ${msg}`);
}
