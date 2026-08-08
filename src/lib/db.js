// Local database for the FRC scouting app.
//
// Dexie wraps IndexedDB. This is the write target for every entry — the sync
// layer pushes rows up to Supabase afterwards, so a scout with no signal can
// still record a match and have it land when the connection comes back.

import Dexie from 'dexie';
import { SCHEMA_VERSION } from './form-config.js';
import { shouldApplyRemote } from './sync-rules.js';

export const db = new Dexie('frc-scout');

// Schema versions: bump the number and add a new .version() block when
// the shape of the data changes. Don't edit old version blocks.
db.version(1).stores({
	entries: '++id, eventCode, matchNumber, teamNumber, scoutName, createdAt',
	settings: 'key'
});

// v2: compound index for fast import dedupe.
db.version(2).stores({
	// `++id` = auto-incrementing primary key
	// individual indexes for filtering, plus one compound index used to
	// deduplicate identical rows from re-imported files.
	entries:
		'++id, eventCode, matchNumber, teamNumber, scoutName, createdAt, ' +
		'[eventCode+matchNumber+teamNumber+scoutName+createdAt]',
	// `key` is the primary key (string), `value` is freeform JSON.
	settings: 'key'
});

// v3: the picklist moves out of `settings` and into rows.
//
// It used to be one blob under `picklist:<event>`, which meant syncing it would
// have been last-write-wins over the whole list — a stale phone could erase an
// afternoon of ranking. One row per team makes each edit independent. See
// src/lib/picklist.js.
//
// The old setting is left in place; picklist-store.js reads it once to seed the
// rows and then ignores it. Deleting a user's only copy of their picklist as
// part of a schema bump is not a trade worth making for one dead key.
db.version(3).stores({
	entries:
		'++id, eventCode, matchNumber, teamNumber, scoutName, createdAt, ' +
		'[eventCode+matchNumber+teamNumber+scoutName+createdAt]',
	settings: 'key',
	// `key` is `${eventCode}:${teamNumber}`. Indexed on eventCode because every
	// read is "the list for this event", and on status for the two sub-lists.
	picklist: 'key, eventCode, teamNumber, status, [eventCode+status]'
});

// v4: index remoteId. The pull path looks a row up by it once PER INBOUND ROW,
// and without an index each lookup is a full table scan.
//
// That cost is quadratic in entries and it never showed up, because it scales
// with how much the WHOLE TEAM has recorded, not with this device. Measured
// cold-start backfill:
//
//     100 entries  (a few scouts, part of an event)   0.23s
//     480 entries  (20 scouts covering 40 teams)      4.65s
//     720 entries  (60-team event)                   10.98s
//
// 480 is the ordinary shape of a full event with a real scouting crew, and the
// backfill runs on EVERY cold start: lastSeenAt lives in a module-level
// variable, so a reload, a PWA relaunch or an event-code change re-pulls the
// entire event. While it runs the outbox is stalled behind it and the sync
// indicator reads "connecting" — the app looks broken at exactly the moment a
// scout opens it to record.
db.version(4).stores({
	entries:
		'++id, eventCode, matchNumber, teamNumber, scoutName, createdAt, remoteId, ' +
		'[eventCode+matchNumber+teamNumber+scoutName+createdAt]',
	settings: 'key',
	picklist: 'key, eventCode, teamNumber, status, [eventCode+status]'
});

/**
 * Add a new scouting entry. New rows are stamped with a stable per-device
 * `clientId` and a null `remoteId` — the sync layer fills the `remoteId` in
 * once the row is pushed to Supabase.
 *
 * @param {object} entry - { eventCode, matchNumber, teamNumber, allianceColor, scoutName, observations }
 * @returns {Promise<number>} the new entry id
 */
export async function addEntry(entry) {
	const clientId = await getOrCreateClientId();
	return db.entries.add({
		...entry,
		createdAt: new Date().toISOString(),
		// Stamp the form shape this entry was recorded under, at record time.
		// Without it the sync layer has to guess, and a guess is wrong in the
		// one case the field exists for: telling a metric that was never
		// collected apart from one a scout recorded as zero. See metrics.js.
		schemaVersion: SCHEMA_VERSION,
		clientId,
		remoteId: null
	});
}

/** Get every entry, newest first. */
export async function listEntries() {
	return db.entries.orderBy('createdAt').reverse().toArray();
}

/** Delete a single entry by id. */
export async function deleteEntry(id) {
	return db.entries.delete(id);
}

/** Wipe all entries (used after a confirmed export, if the user wants). */
export async function clearEntries() {
	return db.entries.clear();
}

/** Read a setting value (or undefined if not set). */
export async function getSetting(key) {
	const row = await db.settings.get(key);
	return row?.value;
}

/** Save a setting value (object, string, etc.).
 *
 * The value is JSON-round-tripped before persisting so that Svelte 5 `$state`
 * proxies (which IndexedDB's structured-clone algorithm rejects with
 * `DataCloneError`) are unwrapped to plain objects/arrays first. All our
 * settings are JSON-compatible (no Date instances, no class wrappers, no
 * functions), so the trip is loss-free.
 */
export async function setSetting(key, value) {
	const safe = value == null ? value : JSON.parse(JSON.stringify(value));
	return db.settings.put({ key, value: safe });
}

/**
 * A stable random ID for this physical device. Used as a tiebreaker when
 * two devices submit otherwise-identical rows, and stored on every entry
 * so the sync layer can tell its own writes apart from peer writes.
 *
 * Generated lazily on first call and persisted forever (or until the user
 * clears site data).
 */
export async function getOrCreateClientId() {
	const existing = await getSetting('clientId');
	if (typeof existing === 'string' && existing.length > 0) return existing;
	const fresh = crypto.randomUUID();
	await setSetting('clientId', fresh);
	return fresh;
}

/**
 * Entries waiting to be pushed to Supabase — never sent, or edited since.
 *
 * The `pendingSync` half is the fix for a data-loss bug: this used to filter
 * on `!remoteId` alone, so once a row had synced it could never be pushed
 * again. An edit on /edit changed the local copy, the cloud row kept the old
 * values forever, and nothing surfaced the disagreement.
 *
 * No Dexie index on either field, but at scouting volume (a few hundred rows)
 * a full scan is plenty fast.
 */
export async function getUnsyncedEntries() {
	return db.entries.filter((e) => !e.remoteId || e.pendingSync).toArray();
}

/**
 * Mark a local entry as successfully pushed: stamp the remote UUID and clear
 * the dirty flag. Clearing matters — a row left dirty is retried on every
 * 3-second tick forever.
 */
export async function markEntrySynced(localId, remoteId, submittedBy = undefined) {
	const patch = { remoteId, pendingSync: false };
	// The INSERT response is authoritative for attribution. Migration 0011
	// stamps auth.uid() server-side, so persist what Postgres actually accepted
	// rather than the claim the pre-cutover client sent.
	if (submittedBy !== undefined) patch.submittedBy = submittedBy;
	return db.entries.update(localId, patch);
}

/**
 * Apply a peer's version of a row we already hold locally.
 *
 * Refuses to overwrite a local row with unpushed edits: our own change is the
 * one the user can see and is waiting on, and clobbering it would look like
 * the app silently undid their work. Ours wins and gets pushed on the next
 * tick, which is last-write-wins with a bias toward the person watching.
 *
 * @param {number} localId
 * @param {object} fields
 * @returns {Promise<boolean>} true if the local row was changed
 */
export async function applyRemoteUpdate(localId, fields) {
	const local = await db.entries.get(localId);
	if (!shouldApplyRemote(local, fields)) return false;
	await db.entries.update(localId, fields);
	return true;
}

/** The local row holding a given remote UUID, or undefined. */
export async function getEntryByRemoteId(remoteId) {
	if (!remoteId) return undefined;
	// where(), not filter(). filter() walks every row, and the pull path calls
	// this once per inbound row — so a backfill was O(entries²) and took eleven
	// seconds on a large event. The v4 index makes it a lookup.
	//
	// The null guard above is load-bearing now: Dexie leaves rows whose indexed
	// property is undefined out of the index entirely, so an unsynced row is
	// unreachable this way. Nothing wants to find one by a remoteId it has not
	// got, but the guard is what makes that explicit rather than a silent miss.
	return db.entries.where('remoteId').equals(remoteId).first();
}

/** Fetch a single entry by its local id. Returns undefined if not found. */
export async function getEntry(id) {
	return db.entries.get(typeof id === 'string' ? Number(id) : id);
}

/**
 * Update fields on an existing entry in place. Only pass the fields you
 * want to change — other fields are left untouched.
 *
 * Note: observations is a nested object. To update observation sub-fields,
 * load the entry first, merge observations manually, then pass the merged
 * object as `patch.observations`.
 *
 * @param {number} id - local Dexie id
 * @param {object} patch - partial entry fields to apply
 * @returns {Promise<number>} number of rows updated (0 = not found, 1 = ok)
 */
export async function updateEntry(id, patch) {
	// Always flag the row for re-push. Leaving this to callers is how the
	// original bug survived: /edit patched the row and the sync layer had no
	// way to know it had changed.
	return db.entries.update(id, { ...patch, pendingSync: true });
}

/**
 * Insert a row that arrived from a peer device via the sync layer. Returns
 * `{ inserted: true }` if it was new, `{ inserted: false }` if a duplicate
 * was already present locally (matched on remoteId or the dedupe compound).
 */
export async function insertRemoteEntry(remoteRow) {
	// Same row arriving twice (via realtime echo, or two import paths) — skip.
	if (remoteRow.remoteId) {
		const byRemote = await db.entries.where('remoteId').equals(remoteRow.remoteId).first();
		if (byRemote) return { inserted: false };
	}
	const byCompound = await db.entries
		.where('[eventCode+matchNumber+teamNumber+scoutName+createdAt]')
		.equals([
			remoteRow.eventCode,
			remoteRow.matchNumber,
			remoteRow.teamNumber,
			remoteRow.scoutName,
			remoteRow.createdAt
		])
		.first();
	if (byCompound) {
		// Same row already here under a different id — stamp its remoteId so
		// future sync ticks don't push a duplicate.
		if (!byCompound.remoteId && remoteRow.remoteId) {
			await db.entries.update(byCompound.id, { remoteId: remoteRow.remoteId });
		}
		return { inserted: false };
	}
	const { localId: _drop, ...rest } = remoteRow;
	await db.entries.add(rest);
	return { inserted: true };
}

/**
 * Distinct, non-empty values for a given observations key across every entry.
 * Used by autocomplete fields to suggest previously-recorded values
 * (e.g. auto pathing names) so scouts converge on consistent labels instead
 * of typing the same path slightly differently each time.
 *
 * @param {string} observationKey  e.g. 'autoPathing'
 * @returns {Promise<string[]>}    distinct trimmed values, sorted A→Z
 */
export async function getDistinctObservationValues(observationKey) {
	const all = await db.entries.toArray();
	const seen = new Set();
	for (const row of all) {
		const v = row.observations?.[observationKey];
		if (typeof v !== 'string') continue;
		const trimmed = v.trim();
		if (trimmed) seen.add(trimmed);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Top-N most-used phrases for a given observations key, ordered by
 * frequency desc. For tag-preset rendering above textareas: when scouts
 * keep typing "fast cycles" we want that to be a one-tap pill.
 *
 * @param {string} observationKey
 * @param {number} [limit=6]
 * @returns {Promise<{value: string, count: number}[]>}
 */
export async function getMostUsedObservationValues(observationKey, limit = 6) {
	const all = await db.entries.toArray();
	const counts = new Map();
	for (const row of all) {
		const v = row.observations?.[observationKey];
		if (typeof v !== 'string') continue;
		const trimmed = v.trim();
		if (!trimmed) continue;
		counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, limit);
}

/**
 * Distinct, non-empty values for a given observations key scoped to a
 * single team number. Used by autocomplete fields to suggest previously-
 * recorded values for the specific team being scouted.
 *
 * @param {string} observationKey  e.g. 'autoPathing'
 * @param {number} teamNumber
 * @returns {Promise<string[]>}    distinct trimmed values, sorted A→Z
 */
export async function getDistinctObservationValuesForTeam(observationKey, teamNumber) {
	const all = await db.entries.where('teamNumber').equals(teamNumber).toArray();
	const seen = new Set();
	for (const row of all) {
		const v = row.observations?.[observationKey];
		if (typeof v !== 'string') continue;
		const trimmed = v.trim();
		if (trimmed) seen.add(trimmed);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Top-N most-used phrases for a given observations key scoped to a single
 * team number. Used by tag-pill rendering above textareas so scouts see
 * phrases relevant to the team they're currently watching.
 *
 * @param {string} observationKey
 * @param {number} teamNumber
 * @param {number} [limit=6]
 * @returns {Promise<{value: string, count: number}[]>}
 */
export async function getMostUsedObservationValuesForTeam(observationKey, teamNumber, limit = 6) {
	const all = await db.entries.where('teamNumber').equals(teamNumber).toArray();
	const counts = new Map();
	for (const row of all) {
		const v = row.observations?.[observationKey];
		if (typeof v !== 'string') continue;
		const trimmed = v.trim();
		if (!trimmed) continue;
		counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, limit);
}
