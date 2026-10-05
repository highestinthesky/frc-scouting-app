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
	return sameValue(a ?? {}, b ?? {});
}

/**
 * Structural equality for what a row carries: objects by key (order ignored),
 * arrays by position, scalars by their string form.
 *
 * Scalars compare as strings because a value round-trips through a form field
 * and jsonb — "0" and 0 are the same reading — while blank stays distinct from
 * zero: `String(null ?? '')` is '' and `String(0)` is '0'.
 *
 * Objects recurse. This compared every value with String(), and the auto
 * recording is an object, so every track was "[object Object]": a manager's
 * correction or a scout's re-recording looked identical to the copy a device
 * already held and was never applied there.
 */
function sameValue(x, y) {
	const ox = x !== null && typeof x === 'object';
	const oy = y !== null && typeof y === 'object';
	if (ox !== oy) return false;
	if (!ox) return String(x ?? '') === String(y ?? '');
	if (Array.isArray(x) !== Array.isArray(y)) return false;
	if (Array.isArray(x)) return x.length === y.length && x.every((v, i) => sameValue(v, y[i]));
	const kx = Object.keys(x);
	if (kx.length !== Object.keys(y).length) return false;
	return kx.every((k) => Object.hasOwn(y, k) && sameValue(x[k], y[k]));
}

// ─── the pull watermark ────────────────────────────────────────────────────
//
// Pull is "rows whose updated_at is past what I have seen", and updated_at is
// stamped by a trigger with now() — the time the writing transaction STARTED,
// not when it committed. Two writes in flight commit in either order, so a row
// can become visible after a later-stamped one has already been pulled. A
// strict `updated_at > watermark` then skips it forever: an entry that simply
// never arrives on that device, with nothing anywhere saying so.
//
// So every pull reaches back by an overlap and re-reads the recent past.
// Re-reading is free of side effects — an unchanged row compares equal and is
// not applied — so the only cost is a few rows per tick.

/**
 * How far each pull reaches back behind the newest row it has seen.
 *
 * It has to outlast the longest gap between a write's stamp and its commit.
 * Every client write goes through PostgREST as `authenticated`, whose
 * statement_timeout is 8s (measured on the local stack; Supabase's default), so
 * nothing commits more than 8s after it was stamped. 30s is that with margin.
 * It is also a cost: every row changed inside the window is re-read on every
 * tick — 1,200 rows inserted at once were re-read for the whole window.
 */
export const PULL_OVERLAP_MS = 30_000;

/** Rows per request. Below PostgREST's 1000-row cap, so a page is never cut short. */
export const PULL_PAGE = 500;

/**
 * Where a pull starts: null for a full backfill, else the watermark less the
 * overlap. A watermark that does not parse backfills rather than guessing.
 *
 * @param {string|null} watermark
 * @returns {string|null}
 */
export function pullFrom(watermark) {
	if (!watermark) return null;
	const ms = Date.parse(watermark);
	if (!Number.isFinite(ms)) return null;
	return new Date(ms - PULL_OVERLAP_MS).toISOString();
}

/**
 * The PostgREST `or` filter for the page after the row at `cursor`.
 *
 * Keyset rather than offset: ordered by (updated_at, id) and continued strictly
 * after the last row read. An offset shifts under rows edited mid-pull — the
 * edited row jumps to the end, everything after it moves up one, and the row
 * at the page boundary is skipped. Null for the first page, which filters on
 * time alone (`gte`).
 *
 * @param {{ts: string, id: string|null}} cursor
 * @returns {string|null}
 */
export function pageAfter(cursor) {
	if (!cursor?.id) return null;
	const ts = `"${cursor.ts}"`;
	return `updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${cursor.id})`;
}

/**
 * The later of two updated_at stamps, compared as times rather than text. Text
 * order holds only while both strings spell the offset the same way: `Z` sorts
 * after `.`, so 12:00:05Z reads as later than 12:00:05.5+00:00. Parsing drops
 * microseconds, which can only leave the watermark a hair early — harmless
 * behind the overlap.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {string|null}
 */
export function laterOf(a, b) {
	if (!a) return b ?? null;
	if (!b) return a;
	return Date.parse(b) > Date.parse(a) ? b : a;
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
