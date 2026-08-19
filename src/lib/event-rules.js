// The pure decisions about events, and about claiming work recorded signed-out.
//
// No imports, no I/O, no Supabase — the same shape as scout-identity.js and for
// the same reason: these are the rules, and rules that can only be exercised
// through a network round trip do not get exercised.
//
// ─── why claiming exists ───────────────────────────────────────────────────
//
// Recording never depends on auth (CLAUDE.md), so a scout with no session still
// writes to IndexedDB. Those rows have no account attached. When they sign in,
// the rows they made need to become theirs — otherwise a whole afternoon of
// scouting syncs as nobody's, and `submitted_by` cannot become the identity.
//
// It happens locally, before the first push, because unsynced rows never left
// the phone. That is what makes a server-side claim RPC unnecessary, and it is
// also what makes the rule safe: the only rows in reach are this device's own.

/**
 * Lower-case and trim an event code, or null if there isn't one.
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function normalizeCode(code) {
	if (typeof code !== 'string') return null;
	const trimmed = code.trim().toLowerCase();
	return trimmed || null;
}

/**
 * What to show a human for an event.
 *
 * `0019`'s backfill set `name = code` for every event that predates it, because
 * there was no display name to migrate. Rendering both would give a picker full
 * of "2026onto — 2026onto".
 *
 * @param {{code?: string, name?: string}} event
 * @returns {string}
 */
export function eventLabel(event) {
	const name = typeof event?.name === 'string' ? event.name.trim() : '';
	const code = typeof event?.code === 'string' ? event.code.trim() : '';
	if (name && name.toLowerCase() !== code.toLowerCase()) return name;
	return name || code || 'Untitled event';
}

/**
 * Newest first, archived last. Returns a new array.
 *
 * An archived event stays reachable — last season's data is a legitimate thing
 * to open — but it never outranks a live one in the picker.
 *
 * @template {{starts_on?: string|null, archived_at?: string|null, name?: string, code?: string}} T
 * @param {T[]} events
 * @returns {T[]}
 */
export function sortEvents(events) {
	return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
		const archived = Number(Boolean(a?.archived_at)) - Number(Boolean(b?.archived_at));
		if (archived !== 0) return archived;
		// A dateless event sorts after dated ones rather than to the top, which is
		// where an empty string would put it.
		const da = a?.starts_on || '';
		const db = b?.starts_on || '';
		if (da !== db) {
			if (!da) return 1;
			if (!db) return -1;
			return db.localeCompare(da);
		}
		return eventLabel(a).localeCompare(eventLabel(b));
	});
}

/**
 * Which event this device should be looking at.
 *
 * @param {Array<{id: string, code?: string}>|null} events  events the device may see
 * @param {{eventId?: string|null, eventCode?: string|null}} remembered
 * @returns {object|null}
 */
export function pickCurrentEvent(events, remembered) {
	const list = Array.isArray(events) ? events : [];
	if (list.length === 0) return null;

	const wantId = remembered?.eventId ?? null;
	if (wantId) {
		// Deliberately no fallback. A device that remembers an event it can no
		// longer see has either been removed from it or is looking at a deleted
		// one, and quietly selecting a DIFFERENT event would file this match's
		// observations under the wrong one. Better to show nothing and say why.
		return list.find((e) => e.id === wantId) ?? null;
	}

	const wantCode = normalizeCode(remembered?.eventCode ?? null);
	if (wantCode) {
		// An install upgrading from before events had ids carries only the code.
		return list.find((e) => normalizeCode(e.code) === wantCode) ?? null;
	}

	// Nothing remembered: the newest event. A scout who opens the app to an empty
	// picker cannot record at all, and at a competition the newest event is
	// almost always the right guess.
	return sortEvents(list)[0] ?? null;
}

/**
 * The rows this device may claim on sign-in.
 *
 * Both conditions are load-bearing:
 *
 *   clientId === mine   — never take a teammate's work. Two scouts share an
 *                         account far less often than they share a match, but a
 *                         device tag is the only thing that distinguishes them.
 *   submittedBy empty   — never rewrite attribution that already exists. Without
 *                         this, a shared tablet would reassign every past entry
 *                         to whoever signed in most recently.
 *
 * Together they make the operation idempotent, which matters because sign-in
 * happens many times and this runs on every one.
 *
 * @template {{clientId?: string|null, submittedBy?: string|null}} T
 * @param {T[]|null} rows
 * @param {string|null} clientId  this device's id
 * @returns {T[]}
 */
export function claimableRows(rows, clientId) {
	if (!clientId || typeof clientId !== 'string') return [];
	if (!Array.isArray(rows)) return [];
	return rows.filter((r) => r?.clientId === clientId && !r?.submittedBy);
}

/**
 * Attach an account to one claimable row. Pure — returns a new row.
 *
 * The scout name is filled only when blank. CLAUDE.md: the name is still the
 * join key, so overwriting one a device already had would silently detach it
 * from every assignment, override and reminder addressed to the old spelling.
 *
 * @template {{scoutName?: string}} T
 * @param {T} row
 * @param {string} profileId
 * @param {string} [displayName]
 * @returns {T & {submittedBy: string}}
 */
export function claimRow(row, profileId, displayName = '') {
	const name = typeof row?.scoutName === 'string' ? row.scoutName.trim() : '';
	return {
		...row,
		submittedBy: profileId,
		scoutName: name || (typeof displayName === 'string' ? displayName.trim() : '') || ''
	};
}

/**
 * Does this look like a Blue Alliance event key?
 *
 * `events.code` has always been intended as the TBA key — migration 0019's own
 * table comment says so, "kept because the schedule import needs it" — and
 * PublishSchedule already defaults its TBA lookup to the event code. Nothing in
 * the UI ever said that, so codes got invented, and then the schedule fetch
 * needed a second, different string typed into a second box.
 *
 * A TBA key is a four-digit season followed by the event's short code:
 * `2026nyny`, `2024casj`, `2025onwat`. A trailing `-N` is allowed because
 * divisions and reruns use one, and this project's own production event is
 * `2026nyny-6`.
 *
 * Advisory, not a gate. An offseason scrimmage has no TBA entry and still has to
 * be scoutable, so the UI warns and lets the manager proceed. Blocking here
 * would trade a real use case for a tidier field.
 *
 * @param {unknown} code
 * @returns {boolean}
 */
export function looksLikeTbaKey(code) {
	const c = normalizeCode(code);
	if (!c) return false;
	return /^\d{4}[a-z][a-z0-9]*(-\d+)?$/.test(c);
}

/**
 * Settings that belong to an EVENT, not to a device.
 *
 * They were all stored device-global, and switching events carried them over.
 * The sharp one is `tbaEventKey`: the schedule page seeds its field from it once,
 * and `fetchAndCacheSchedule` uses `tbaEventKey || eventCode` — so a manager who
 * set it to `2026nyny` while scouting `2026nyny-6`, then created `2027nyny`,
 * pulled LAST SEASON'S schedule into the new event and got a plausible-looking
 * match list for the wrong competition.
 *
 * `assignedTeams` and `overrides` are the same shape of mistake with a quieter
 * failure: a scout keeps the previous event's teams until a sync happens to
 * overwrite them, and in a gym that sync may be a while.
 *
 * `tbaApiKey` is deliberately NOT here. It is a credential belonging to the
 * person, valid across every event, and clearing it would make a manager re-paste
 * it every time they switched.
 */
export const PER_EVENT_SETTINGS = ['tbaEventKey', 'assignedTeams', 'overrides'];

/**
 * What a session must forget when the event changes.
 *
 * Returns the patch to apply, or null when nothing needs clearing — which is the
 * common case, since most updates do not touch the event at all. Returning null
 * rather than an empty object lets the caller skip the write entirely.
 *
 * @param {unknown} from  the event code currently stored
 * @param {unknown} to    the event code being set
 * @returns {{tbaEventKey: string, assignedTeams: never[], overrides: never[]}|null}
 */
export function resetForEventChange(from, to) {
	const a = normalizeCode(from);
	const b = normalizeCode(to);
	// Setting the same event again is not a change. Nor is arriving at an event
	// from nothing — a device with no event yet has no stale per-event state, and
	// clearing on first selection would wipe assignments a sync had already
	// delivered.
	if (!b || !a || a === b) return null;
	return { tbaEventKey: '', assignedTeams: [], overrides: [] };
}

/**
 * The event a device should be on, when nobody has said.
 *
 * Choosing an event is ceremony: at a competition there is exactly one event
 * that matters, the dates say which, and making a human pick it from a list is
 * asking them to restate something the data already knows.
 *
 * Order of preference:
 *
 *   1. one whose dates contain today — you are AT it
 *   2. the soonest upcoming one — you are preparing for it
 *   3. the most recent past one — you are reviewing it
 *   4. the only event there is, dated or not
 *
 * Archived events are never chosen: archiving is the explicit statement that an
 * event is done with.
 *
 * Returns null when there is a genuine choice to make — several undated events,
 * or none at all — because guessing there would be worse than asking.
 *
 * @param {any[]} events
 * @param {Date} [now]
 * @returns {object|null}
 */
export function currentEvent(events, now = new Date()) {
	const live = (Array.isArray(events) ? events : []).filter((e) => e && !e.archived_at);
	if (live.length === 0) return null;
	if (live.length === 1) return live[0];

	// Compared as YYYY-MM-DD strings, which is what the columns hold. Building
	// Dates here would drag the device's timezone into a decision about which
	// competition somebody is standing at.
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate()
	).padStart(2, '0')}`;

	const dated = live.filter((e) => e.starts_on);

	const happeningNow = dated.filter((e) => e.starts_on <= today && (e.ends_on ?? e.starts_on) >= today);
	// Two events on the same day is a real ambiguity, not something to guess at.
	if (happeningNow.length === 1) return happeningNow[0];
	if (happeningNow.length > 1) return null;

	const upcoming = dated
		.filter((e) => e.starts_on > today)
		.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
	if (upcoming.length > 0) return upcoming[0];

	const past = dated
		.filter((e) => (e.ends_on ?? e.starts_on) < today)
		.sort((a, b) => (b.ends_on ?? b.starts_on).localeCompare(a.ends_on ?? a.starts_on));
	if (past.length > 0) return past[0];

	return null;
}
