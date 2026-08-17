// Events, as rows the database issues rather than a hash of a public string.
//
// Everything here needs a session. `events` and `event_scouts` are granted to
// `authenticated` and to nobody else (0019), so an anonymous caller does not get
// an empty list — it gets nothing at all, which is the point. Knowing an event
// code stopped being a credential.
//
// ─── how this replaces deriveSessionId() ───────────────────────────────────
//
// The old model hashed the event code into a UUID and every shared table was
// partitioned on it. 31 call sites did `deriveSessionId(code)` and handed the
// result to createSupabaseClient(). This module answers the same question —
// "what uuid scopes this event" — from a real row instead.
//
// The important consequence: it can FAIL. A code that no event has, or an event
// this device is not a member of, has no id, where the hash always produced
// one. That is the model change working; a scout who is not on an event should
// not be silently writing into it.
//
// ─── one key ───────────────────────────────────────────────────────────────
//
// Through 0019's expand window writes carried both event_id and session_id, so
// the old policy path and the new membership path could each permit the same
// row and neither deploy had to be simultaneous. 0020 closed that: session_id is
// gone from all eight tables and this is the only key there is.

import { getAuthClient } from './supabase.js';
import { normalizeCode, sortEvents } from './event-rules.js';

/**
 * code -> event id, for the lifetime of the tab.
 *
 * Every one of those 31 call sites resolves an id before it can do anything, so
 * without a cache a single page render is a dozen round trips. Cleared on sign
 * out, because membership is what the answer depends on.
 *
 * @type {Map<string, string|null>}
 */
const idByCode = new Map();

/** Drop the cache. Called on sign-in and sign-out — membership just changed. */
export function forgetEvents() {
	idByCode.clear();
}

/**
 * Every event this device may see.
 *
 * RLS decides the contents: a scout sees the events they are a member of, a
 * manager sees all of them so they can staff one they are not on yet. This is
 * the question the event-code model could not answer at all — you needed the
 * code to read event_meta, so there was no way to ask what you had access to.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listMyEvents() {
	const { data, error } = await getAuthClient()
		.from('events')
		.select('id, code, name, starts_on, ends_on, archived_at, created_by');
	if (error) throw new Error(`Could not load events: ${error.message}`);
	const rows = data ?? [];
	for (const e of rows) {
		const code = normalizeCode(e.code);
		if (code) idByCode.set(code, e.id);
	}
	return sortEvents(rows);
}

/**
 * The event id for a code, or null if there is no such event in reach.
 *
 * Null is a real answer, not an error: the caller decides whether "you are not
 * on this event" is a failure or just a reason not to sync.
 *
 * @param {string} code
 * @returns {Promise<string|null>}
 */
export async function eventIdForCode(code) {
	const key = normalizeCode(code);
	if (!key) return null;
	if (idByCode.has(key)) return idByCode.get(key) ?? null;

	const { data, error } = await getAuthClient()
		.from('events')
		.select('id')
		.eq('code', key)
		.maybeSingle();
	// A failed lookup is not cached. A network blip would otherwise pin "no such
	// event" for the rest of the session and the scout would see an event that
	// silently never syncs.
	if (error) throw new Error(`Could not resolve event ${key}: ${error.message}`);

	const id = data?.id ?? null;
	idByCode.set(key, id);
	return id;
}

/**
 * Create an event and join it, in one call.
 *
 * Goes through the create_event RPC rather than an INSERT because creating and
 * belonging are one act — `events` has no INSERT policy at all, so a direct
 * insert fails by design. A manager who made an event they were not a member of
 * would have made something they cannot see.
 *
 * @param {{code: string, name?: string, startsOn?: string|null, endsOn?: string|null}} input
 * @returns {Promise<string>}  the new event id
 */
export async function createEvent(input) {
	const code = normalizeCode(input?.code);
	if (!code) throw new Error('An event needs a code.');
	if (!/^[a-z0-9._-]{2,32}$/.test(code)) {
		// Same shape the events_code_shape constraint enforces. Checked here too so
		// the message names the problem instead of quoting a constraint name.
		throw new Error('An event code is 2–32 characters: letters, digits, dot, dash or underscore.');
	}
	const name = String(input?.name ?? '').trim() || code;

	const { data, error } = await getAuthClient().rpc('create_event', {
		p_code: code,
		p_name: name,
		p_starts_on: input?.startsOn || null,
		p_ends_on: input?.endsOn || null
	});
	if (error) {
		if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
			throw new Error(`An event with the code "${code}" already exists.`);
		}
		throw new Error(error.message);
	}
	idByCode.set(code, data);
	return data;
}

/**
 * Archive or restore an event.
 *
 * Archiving is the ordinary end of an event. Deleting one cascades to every row
 * recorded at it and is restricted to supers, which is why the app offers this
 * instead.
 *
 * @param {string} eventId
 * @param {boolean} [archived]
 */
export async function setEventArchived(eventId, archived = true) {
	const { error } = await getAuthClient()
		.from('events')
		.update({ archived_at: archived ? new Date().toISOString() : null })
		.eq('id', eventId);
	if (error) throw new Error(`Could not archive the event: ${error.message}`);
	forgetEvents();
}

/**
 * Who is on this event.
 *
 * @param {string} eventId
 * @returns {Promise<Array<object>>}
 */
export async function eventRoster(eventId) {
	const { data, error } = await getAuthClient()
		.from('event_scouts')
		// The FK is named explicitly because event_scouts has TWO references to
		// profiles — profile_id and added_by — and a bare `profiles(...)` embed is
		// ambiguous. PostgREST refuses it outright: "more than one relationship was
		// found", which surfaced as an empty roster with an error underneath it.
		.select(
			'profile_id, added_at, profiles!event_scouts_profile_id_fkey(id, username, first_name, last_name, role)'
		)
		.eq('event_id', eventId);
	if (error) throw new Error(`Could not load the event roster: ${error.message}`);
	return (data ?? []).map((r) => ({
		profileId: r.profile_id,
		addedAt: r.added_at,
		...(r.profiles ?? {})
	}));
}

/**
 * Put someone on an event, or take them off.
 *
 * Both are manager-gated server-side by manages_event(), so a scout calling
 * these gets a policy denial rather than a silent no-op.
 *
 * @param {string} eventId
 * @param {string} profileId
 */
export async function addScoutToEvent(eventId, profileId) {
	const { error } = await getAuthClient()
		.from('event_scouts')
		.insert({ event_id: eventId, profile_id: profileId });
	// Adding someone already on the event is what a double-click looks like, and
	// it is not a failure worth showing anyone.
	if (error && error.code !== '23505') {
		throw new Error(`Could not add them to the event: ${error.message}`);
	}
}

/**
 * @param {string} eventId
 * @param {string} profileId
 */
export async function removeScoutFromEvent(eventId, profileId) {
	const { error } = await getAuthClient()
		.from('event_scouts')
		.delete()
		.eq('event_id', eventId)
		.eq('profile_id', profileId);
	if (error) throw new Error(`Could not remove them from the event: ${error.message}`);
}
