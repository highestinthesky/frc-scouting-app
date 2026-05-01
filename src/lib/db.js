// Local-only database for the FRC scouting app.
// Uses Dexie, which is a friendly wrapper around IndexedDB (the browser's
// built-in database). Everything saved here lives in the user's browser
// and never leaves the device unless they export a file.

import Dexie from 'dexie';

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

/**
 * Add a new scouting entry.
 * @param {object} entry - { eventCode, matchNumber, teamNumber, allianceColor, scoutName, observations }
 * @returns {Promise<number>} the new entry id
 */
export async function addEntry(entry) {
	return db.entries.add({
		...entry,
		createdAt: new Date().toISOString()
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

/** Save a setting value (object, string, etc.). */
export async function setSetting(key, value) {
	return db.settings.put({ key, value });
}

/**
 * Insert several entries, skipping any that already exist (matched on
 * the compound index of event+match+team+scout+createdAt).
 * Returns { inserted, skipped }.
 */
export async function bulkInsertEntries(rows) {
	let inserted = 0;
	let skipped = 0;
	for (const row of rows) {
		const existing = await db.entries
			.where('[eventCode+matchNumber+teamNumber+scoutName+createdAt]')
			.equals([
				row.eventCode,
				row.matchNumber,
				row.teamNumber,
				row.scoutName,
				row.createdAt
			])
			.first();
		if (existing) {
			skipped++;
		} else {
			// Strip any incoming `id` so Dexie auto-assigns a new local one.
			const { id: _drop, ...rest } = row;
			await db.entries.add(rest);
			inserted++;
		}
	}
	return { inserted, skipped };
}
