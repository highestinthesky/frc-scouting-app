// Pure decisions the sync layer makes about a row. No Dexie, no Supabase, no
// runes — so they can be tested with plain node, which the modules that use
// them cannot.
//
// The rules here are small but they are the ones that lose data when wrong.

/** Fields a pull may refresh. createdAt, eventCode, scoutName and clientId
 * identify the row and are never rewritten by a sync. submittedBy is immutable
 * user data, but the server copy is authoritative when a remote row arrives. */
export const EDITABLE_FIELDS = [
	'matchNumber',
	'teamNumber',
	'allianceColor',
	'observations',
	'schemaVersion',
	'submittedBy'
];

/**
 * Should a peer's version of a row replace the copy we hold?
 *
 * Two guards, in order:
 *
 *   1. **Never clobber unpushed local edits.** Our change is the one the user
 *      just made and can see on screen; overwriting it would look like the app
 *      silently undid their work. Ours wins and goes out on the next tick.
 *      That is last-write-wins biased toward the person actually watching —
 *      a deliberate choice, not an accident, and the right one for a team
 *      where two people editing the same entry is already a mistake.
 *
 *   2. **Ignore no-op updates.** Our own writes echo back through the pull,
 *      and a peer's touch may carry identical values. Applying those would
 *      bump the inbound-changes counter and make pages re-render for nothing.
 *
 * @param {object|undefined} local   the row we hold, if any
 * @param {object} incoming          the peer's fields
 * @returns {boolean}
 */
export function shouldApplyRemote(local, incoming) {
	if (!local) return false;
	if (local.pendingSync) return false;
	return EDITABLE_FIELDS.some((k) => {
		if (incoming[k] === undefined) return false;
		if (k === 'observations') {
			return !sameObservations(incoming[k], local[k]);
		}
		return incoming[k] !== local[k];
	});
}

/**
 * Observations compared by content, key order ignored.
 *
 * JSON.stringify would call `{a:1,b:2}` and `{b:2,a:1}` different, and
 * Postgres jsonb does not preserve key order — so a round trip through the
 * server can reorder keys and every pull would look like a change.
 *
 * @param {object} [a]
 * @param {object} [b]
 */
export function sameObservations(a, b) {
	const x = a ?? {};
	const y = b ?? {};
	const kx = Object.keys(x);
	const ky = Object.keys(y);
	if (kx.length !== ky.length) return false;
	return kx.every((k) => Object.hasOwn(y, k) && String(x[k] ?? '') === String(y[k] ?? ''));
}

/**
 * Which way should a dirty local row go out — as a new cloud row, or an edit
 * to one that already exists?
 *
 * @param {object} local
 * @returns {'insert'|'update'}
 */
export function pushMode(local) {
	return local?.remoteId ? 'update' : 'insert';
}

/**
 * Build the two wire shapes for an entry.
 *
 * Attribution is a claim by the account performing the first sync and is only
 * sent when the entry first reaches the server. Migration 0011 independently
 * stamps the same value from auth.uid(); the client field keeps the additive
 * pre-cutover migration useful without trusting it after cutover. An edit must
 * never rewrite the original submitter.
 *
 * @param {object} row common database-column payload
 * @param {string|null|undefined} submittedBy
 * @returns {{insert: object, update: object}}
 */
export function entryWritePayloads(row, submittedBy) {
	return {
		insert: { ...row, submitted_by: submittedBy ?? null },
		update: { ...row }
	};
}
