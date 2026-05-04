// Read a `.scout` file (or plain JSON) and merge its entries into the
// local database. Imports are idempotent: re-importing the same file is
// a no-op because the dedupe key (event+match+team+scout+createdAt) is
// unique per record.

import { ungzip } from 'pako';
import { bulkInsertEntries } from './db.js';

/** Parse a File or Blob into a payload object. */
export async function readPayload(fileOrBlob) {
	const buf = await fileOrBlob.arrayBuffer();
	const bytes = new Uint8Array(buf);
	let text;
	try {
		// Most files will be gzipped.
		const inflated = ungzip(bytes);
		text = new TextDecoder().decode(inflated);
	} catch (_e) {
		// Fall back to assuming plain JSON.
		text = new TextDecoder().decode(bytes);
	}
	let payload;
	try {
		payload = JSON.parse(text);
	} catch (_e) {
		throw new Error('File is not valid JSON. Is this a FRC Scout export?');
	}
	if (!payload || payload.format !== 'frc-scout') {
		throw new Error("File doesn't look like a FRC Scout export.");
	}
	if (!Array.isArray(payload.entries)) {
		throw new Error('File is missing the entries list.');
	}
	return payload;
}

/**
 * Schema-version shim. Older exports recorded "did the robot fail?" as a
 * free-text `observations.failures` textarea. v2 replaced that with a
 * boolean `brokeDown` flag plus a generic `comments` textarea.
 *
 * On import, if a row only carries the legacy shape, we mirror it forward:
 *   - non-empty `failures`  →  brokeDown = true,  comments prepended with the failures text
 *   - empty/missing failures →  brokeDown = false (so downstream code can rely on the boolean)
 *
 * The original `failures` field is preserved on the row so re-exports of
 * old data don't silently lose information for anyone still on the old app.
 */
function normalizeLegacyObservations(rows) {
	return rows.map((row) => {
		const obs = row.observations ?? {};
		if (typeof obs.brokeDown === 'boolean') return row;

		const failuresText = typeof obs.failures === 'string' ? obs.failures.trim() : '';
		const newObs = { ...obs };
		if (failuresText) {
			newObs.brokeDown = true;
			const existingComments = typeof obs.comments === 'string' ? obs.comments.trim() : '';
			newObs.comments = existingComments
				? `${failuresText}\n\n${existingComments}`
				: failuresText;
		} else {
			newObs.brokeDown = false;
		}
		return { ...row, observations: newObs };
	});
}

/** Merge a parsed payload into the local DB. */
export async function importPayload(payload) {
	const normalized = normalizeLegacyObservations(payload.entries);
	return bulkInsertEntries(normalized);
}

/** One-shot helper for an import button. */
export async function importFile(fileOrBlob) {
	const payload = await readPayload(fileOrBlob);
	const { inserted, skipped } = await importPayload(payload);
	return {
		inserted,
		skipped,
		total: payload.entries.length,
		exportedBy: payload.exportedBy ?? 'unknown',
		exportedAt: payload.exportedAt,
		kind: payload.kind
	};
}
