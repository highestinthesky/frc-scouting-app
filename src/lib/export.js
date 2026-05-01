// Build and download a `.scout` file: gzipped JSON of all entries.
//
// Format (after un-gzipping):
//   {
//     format: "frc-scout",
//     schemaVersion: <int>,
//     kind: "scout-export" | "manager-export",
//     exportedAt: <ISO string>,
//     exportedBy: <scout or manager name>,
//     eventCode:  <string | null>,   // primary event in this file
//     entries: [
//       { eventCode, matchNumber, teamNumber, allianceColor, scoutName,
//         createdAt, observations: { strengths, weaknesses, defense, failures } }
//     ]
//   }
//
// `id` is omitted because it's a local-only auto-increment.

import { gzip } from 'pako';
import { listEntries } from './db.js';
import { SCHEMA_VERSION } from './form-config.js';

/** Build the export payload (still a JS object, not yet a file). */
export async function buildPayload({ kind, exportedBy, eventCode = null }) {
	const all = await listEntries();
	// Drop the local `id` from each row so re-imports don't collide.
	const entries = all.map(({ id: _drop, ...rest }) => rest);
	return {
		format: 'frc-scout',
		schemaVersion: SCHEMA_VERSION,
		kind,
		exportedAt: new Date().toISOString(),
		exportedBy,
		eventCode,
		entries
	};
}

/** Trigger a download for the given payload. */
export function download(payload, filename) {
	const json = JSON.stringify(payload);
	const compressed = gzip(new TextEncoder().encode(json));
	// Wrap the Uint8Array in a fresh ArrayBuffer copy. Some browsers refuse
	// SharedArrayBuffer-backed views in Blob constructors.
	const blob = new Blob([compressed.buffer.slice(0)], {
		type: 'application/octet-stream'
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Slight delay before revoking so Safari has time to start the download.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build a friendly default filename. */
export function defaultFilename({ kind, eventCode, exportedBy }) {
	const date = new Date().toISOString().slice(0, 10);
	const ev = (eventCode || 'event').replace(/\s+/g, '-').toLowerCase();
	const tag =
		kind === 'manager-export'
			? 'aggregated'
			: (exportedBy || 'scout').replace(/\s+/g, '-').toLowerCase();
	return `${ev}-${tag}-${date}.scout`;
}

/** One-shot helper used from buttons in the UI. */
export async function exportToFile({ kind, exportedBy, eventCode }) {
	const payload = await buildPayload({ kind, exportedBy, eventCode });
	const filename = defaultFilename({ kind, eventCode, exportedBy });
	download(payload, filename);
	return { filename, count: payload.entries.length };
}
