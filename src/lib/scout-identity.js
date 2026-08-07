// Who a row is about.
//
// `scout_name` is a join key, not a label. Assignments, per-match overrides,
// targeted reminders, coverage, auto-assign and CSV all decide "is this row
// mine?" by comparing it, and nothing makes two phones spell it the same way.
// Before this module the codebase did not even agree with itself: the
// assignment join, the override filter and the reminder targeting compared
// `trim().toLowerCase()`, while the insights scout filter, the duplicate-entry
// warning and the distinct-scout count compared the raw string. "Ning" and
// "ning" were one scout to the first three and two scouts to the last three.
//
// Migration 0010 added the real answer — `profiles.id` — beside the typed name
// on every table that carries one. This is the only place that knows how the
// two relate.
//
// ─── the precedence rule ────────────────────────────────────────────────────
//
// Two accounts: compare accounts. Anything else: compare names.
//
// Both halves matter. Comparing accounts first is the entire point of the
// migration — two people genuinely can be called Ning, and the UUID is the only
// thing that can tell them apart. Falling back to the name is what keeps the app
// working during the years when most rows predate accounts: an entry recorded in
// 2026 has no UUID and never will, and if it stopped matching its author, their
// own history would disappear from their coverage.
//
// Two blanks never match. An unknown scout is not a person, and treating all
// unknowns as one would merge every unattributed row in the event into a single
// phantom scout.

/**
 * @typedef {object} ScoutRef
 * @property {string|null} profileId  the account, when one is known
 * @property {string} key             normalised — compare and group on this
 * @property {string} label           what the human typed — display this
 */

/**
 * @param {unknown} name
 * @param {string|null} [profileId]
 * @returns {ScoutRef}
 */
export function scoutRef(name, profileId = null) {
	const label = name === null || name === undefined ? '' : String(name).trim();
	return { profileId: profileId || null, key: label.toLowerCase(), label };
}

/**
 * Read identity off a row, whichever shape it arrived in.
 *
 * Three column names for two concepts, none of which callers should have to
 * remember: the planning tables carry `profile_id`, `entries` carries the same
 * thing under the older name `submitted_by`, and IndexedDB stores both in
 * camelCase because Dexie mirrors the client object rather than the wire.
 *
 * @param {Record<string, any>|null|undefined} row
 * @returns {ScoutRef}
 */
export function rowScout(row) {
	if (!row) return scoutRef('');
	return scoutRef(
		row.scout_name ?? row.scoutName,
		row.profile_id ?? row.profileId ?? row.submitted_by ?? row.submittedBy ?? null
	);
}

/**
 * Do these two references describe the same person?
 *
 * @param {ScoutRef|null|undefined} a
 * @param {ScoutRef|null|undefined} b
 * @returns {boolean}
 */
export function sameScout(a, b) {
	if (!a || !b) return false;
	if (a.profileId && b.profileId) return a.profileId === b.profileId;
	return a.key !== '' && a.key === b.key;
}

/**
 * Resolve a typed name to an account, or admit that it cannot be done.
 *
 * The client-side twin of `profile_for_name()` in migration 0010, and
 * deliberately just as conservative: an exact match on username or on
 * "first last", case-insensitively, and only when exactly ONE profile matches.
 *
 * Two people called Alex resolve to null. That is the point — a wrong UUID
 * silently attributes one scout's work to another and looks like data, while a
 * null is visible and asks a human. Leaving it unresolved costs a fallback to
 * name matching, which is what happens today anyway.
 *
 * @param {unknown} name
 * @param {{id: string, username?: string, first_name?: string, last_name?: string}[]|null|undefined} roster
 * @returns {string|null}
 */
export function resolveScout(name, roster) {
	const key = scoutRef(name).key;
	if (!key || !Array.isArray(roster)) return null;
	const hits = roster.filter((p) => {
		const username = String(p?.username ?? '').trim().toLowerCase();
		const full = `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`
			.trim()
			.toLowerCase();
		return key === username || (full !== '' && key === full);
	});
	return hits.length === 1 ? hits[0].id : null;
}

/**
 * The identity columns for an outgoing row — both of them, always.
 *
 * The name is still what every join uses, so it is written even when the
 * account is known; the UUID is written even though nothing reads it yet, so
 * that `0011`'s preconditions become reachable instead of resting entirely on
 * one backfill's guesses.
 *
 * @param {ScoutRef} ref
 * @param {'profile_id'|'submitted_by'} [uuidColumn]
 * @returns {Record<string, string|null>}
 */
export function identityFields(ref, uuidColumn = 'profile_id') {
	return { scout_name: ref.label, [uuidColumn]: ref.profileId };
}
