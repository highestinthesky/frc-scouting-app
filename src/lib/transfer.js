// Getting entries off a phone when there is no internet.
//
// Sync needs a network. A competition gym does not have one, and everything
// this app does well is undone by six phones holding data nobody can collect.
// This is the path that does not need a server: export a file, move it by any
// means the devices already have — AirDrop, Nearby Share, a cable, a memory
// stick, email once there is signal — and import it on the other side.
//
// ─── why a file and not a QR code ─────────────────────────────────────────────
//
// QR is what Scouting PASS and QRScout do, and it is the right answer when you
// have no file system. A phone and a laptop both have one, and both already
// have a nearby-transfer mechanism, so QR would mean chunking an event across
// forty codes and shipping a decoder in an offline bundle to solve a problem
// this situation does not have. A file carries the whole event, and it either
// arrived or it did not.
//
// If QR is ever wanted it feeds planImport() unchanged; the transport is the
// only part that would differ.
//
// ─── why importing twice is safe ──────────────────────────────────────────────
//
// Nothing here invents deduplication. `entries` has a compound index that is a
// CONTENT fingerprint — [eventCode+matchNumber+teamNumber+scoutName+createdAt] —
// and insertRemoteEntry() already matches against it, because sync needed the
// same guarantee for rows echoed back by realtime. Identity is deliberately not
// in that fingerprint: two devices' record of one observation must stay one row.
//
// So a bundle imported twice cannot duplicate, and two bundles that overlap
// merge rather than double. That is a property of the schema, not of this file.

import { SCHEMA_VERSION } from './form-config.js';

/** What a bundle file announces itself as. Wrong value, wrong file. */
export const BUNDLE_FORMAT = 'frc-scout-entries';

/**
 * The envelope version, not the entry schema version. They move independently:
 * this changes when the FILE's shape changes, SCHEMA_VERSION changes when an
 * observation is added. Conflating them is how an import refuses a file it could
 * have read perfectly well.
 */
export const BUNDLE_FORMAT_VERSION = 1;

/** Row fields that travel. */
const ROW_FIELDS = [
	'eventCode',
	'matchNumber',
	'teamNumber',
	'allianceColor',
	'scoutName',
	'createdAt',
	'observations',
	'schemaVersion',
	'remoteId',
	'profileId',
	'submittedBy',
	'deletedAt'
];

/**
 * Build a bundle from local entries.
 *
 * The local `id` is deliberately dropped: it is an autoincrement primary key
 * that means something only on the device that issued it, and carrying it across
 * would collide with a completely unrelated row on the receiving device.
 *
 * `remoteId` IS carried, because it is the strongest dedupe signal available —
 * insertRemoteEntry() checks it before falling back to the fingerprint.
 *
 * @param {object[]} entries
 * @param {{eventCode?: string, scoutName?: string, deviceId?: string}} [meta]
 * @returns {object}
 */
export function buildBundle(entries, meta = {}) {
	const rows = (entries ?? []).map((e) => {
		const row = {};
		for (const f of ROW_FIELDS) if (e[f] !== undefined) row[f] = e[f];
		return row;
	});

	return {
		format: BUNDLE_FORMAT,
		formatVersion: BUNDLE_FORMAT_VERSION,
		exportedAt: new Date().toISOString(),
		eventCode: meta.eventCode ?? null,
		scoutName: meta.scoutName ?? null,
		deviceId: meta.deviceId ?? null,
		// The HIGHEST schema version present, so the receiver can refuse a file it
		// would have to guess about. Max, not the app's own: a bundle of old rows
		// from a new app is perfectly importable.
		schemaVersion: rows.reduce((hi, r) => Math.max(hi, Number(r.schemaVersion) || 0), 0),
		entries: rows
	};
}

/**
 * Parse and validate a bundle file's text.
 *
 * Returns `{ ok: false, error }` rather than throwing, because every caller is a
 * UI that has to say what is wrong with the file a human just picked, and an
 * exception message is not that sentence.
 *
 * @param {string} text
 * @returns {{ok: true, bundle: object}|{ok: false, error: string}}
 */
export function parseBundle(text) {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return { ok: false, error: 'That file is not readable as JSON.' };
	}
	if (!data || typeof data !== 'object') {
		return { ok: false, error: 'That file does not contain a bundle.' };
	}
	if (data.format !== BUNDLE_FORMAT) {
		return {
			ok: false,
			error: 'That is not a scouting bundle. It may be a CSV export or another app file.'
		};
	}
	if (Number(data.formatVersion) > BUNDLE_FORMAT_VERSION) {
		return {
			ok: false,
			error: `That bundle was written by a newer version of this app (format ${data.formatVersion}). Update this device first.`
		};
	}
	if (!Array.isArray(data.entries)) {
		return { ok: false, error: 'That bundle has no entries in it.' };
	}
	// Refuse rather than guess. A row recorded under a schema this build does not
	// know has observation keys it cannot interpret, and importing it would put
	// data on the device that every read path silently treats as absent — which
	// looks exactly like the scout never recorded it.
	if (Number(data.schemaVersion) > SCHEMA_VERSION) {
		return {
			ok: false,
			error: `Those entries were recorded on a newer version of the form (v${data.schemaVersion}, this device reads v${SCHEMA_VERSION}). Update this device first.`
		};
	}
	return { ok: true, bundle: data };
}

/** The content fingerprint the entries table indexes on. */
export function fingerprint(row) {
	return [row?.eventCode, row?.matchNumber, row?.teamNumber, row?.scoutName, row?.createdAt].join(
		' '
	);
}

/**
 * Work out what importing this bundle would do, WITHOUT doing it.
 *
 * A manager pressing import at an event is choosing to merge someone else's
 * afternoon into their device. "Are you sure?" is not a useful question;
 * "47 new, 12 already here, 3 for another event" is.
 *
 * @param {object} bundle       a bundle that already passed parseBundle()
 * @param {object[]} existing   every entry already on this device
 * @param {{eventCode?: string}} [opts]
 * @returns {{fresh: object[], duplicate: object[], otherEvent: object[], malformed: object[]}}
 */
export function planImport(bundle, existing, opts = {}) {
	const have = new Set((existing ?? []).map(fingerprint));
	const haveRemote = new Set(
		(existing ?? []).map((e) => e.remoteId).filter((r) => r !== null && r !== undefined)
	);

	const fresh = [];
	const duplicate = [];
	const otherEvent = [];
	const malformed = [];

	// Within-bundle duplicates count as duplicates too. A file built by
	// concatenating two exports is a thing a person will do.
	const seen = new Set();

	for (const row of bundle.entries ?? []) {
		if (
			!row ||
			!row.eventCode ||
			!Number.isFinite(Number(row.matchNumber)) ||
			!Number.isFinite(Number(row.teamNumber)) ||
			!row.createdAt
		) {
			malformed.push(row);
			continue;
		}
		if (opts.eventCode && row.eventCode !== opts.eventCode) {
			otherEvent.push(row);
			continue;
		}
		const fp = fingerprint(row);
		if (have.has(fp) || seen.has(fp) || (row.remoteId && haveRemote.has(row.remoteId))) {
			duplicate.push(row);
			continue;
		}
		seen.add(fp);
		fresh.push(row);
	}

	return { fresh, duplicate, otherEvent, malformed };
}

/**
 * A filename that sorts, says what it holds, and does not collide.
 * @param {{eventCode?: string|null, scoutName?: string|null}} meta
 * @param {Date} [now]
 */
export function bundleFilename(meta, now = new Date()) {
	const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
	const who = String(meta?.scoutName ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const event = String(meta?.eventCode ?? 'event')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-');
	return ['scout', event, who, stamp].filter(Boolean).join('_') + '.json';
}
