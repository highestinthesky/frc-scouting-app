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

/**
 * Build and download a CSV of all entries. One row per entry, RFC 4180
 * compliant — values containing commas, double-quotes, or newlines are
 * wrapped in double-quotes with internal quotes doubled.
 *
 * Columns: eventCode, matchNumber, teamNumber, allianceColor, scoutName,
 *          createdAt, autoPathing, strengths, weaknesses, defense, brokeDown,
 *          comments
 *
 * Returns { filename, count } matching exportToFile.
 */
export async function exportToCsv({ exportedBy: _by, eventCode }) {
	const all = await listEntries();

	// Escape a single CSV cell value per RFC 4180.
	function esc(val) {
		const s = String(val ?? '');
		return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	}

	const header = [
		'eventCode', 'matchNumber', 'teamNumber', 'allianceColor',
		'scoutName', 'createdAt', 'autoPathing', 'strengths',
		'weaknesses', 'defense', 'brokeDown', 'comments'
	].join(',');

	const rows = all.map((e) =>
		[
			esc(e.eventCode),
			esc(e.matchNumber),
			esc(e.teamNumber),
			esc(e.allianceColor),
			esc(e.scoutName),
			esc(e.createdAt),
			esc(e.observations?.autoPathing ?? ''),
			esc(e.observations?.strengths ?? ''),
			esc(e.observations?.weaknesses ?? ''),
			esc(e.observations?.defense ?? ''),
			esc(e.observations?.brokeDown ?? ''),
			esc(e.observations?.comments ?? '')
		].join(',')
	);

	const csv = [header, ...rows].join('\r\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	const ev = (eventCode || 'event').replace(/\s+/g, '-').toLowerCase();
	const date = new Date().toISOString().slice(0, 10);
	const filename = `${ev}-aggregated-${date}.csv`;
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	return { filename, count: all.length };
}
