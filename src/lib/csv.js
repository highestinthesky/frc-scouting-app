// CSV export for the manager view.
//
// Columns are derived from form-config.js rather than hardcoded, so adding a
// field to the form automatically adds it to the export. Identity columns come
// first, then createdAt, then every observation field in form order.

import { listEntries } from './db.js';
import { IDENTITY_FIELDS, OBSERVATION_FIELDS } from './form-config.js';

/** Escape one cell per RFC 4180. */
function esc(val) {
	const s = String(val ?? '');
	return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Render one observation value as a CSV cell. Counters that were never
 * touched stay blank rather than becoming 0 — a missing reading and a
 * genuine zero are different facts.
 */
function cell(entry, field) {
	const v = entry.observations?.[field.key];
	if (v === undefined || v === null || v === '') return '';
	if (field.type === 'boolean') return v ? 'true' : 'false';
	return v;
}

/** Column headers, in the order rows are written. */
export function csvColumns() {
	return [
		...IDENTITY_FIELDS.map((f) => f.key),
		'scoutName',
		'eventCode',
		'createdAt',
		...OBSERVATION_FIELDS.map((f) => f.key)
	];
}

/**
 * Build and download a CSV of every entry, one row per entry.
 *
 * @param {object} opts
 * @param {string} [opts.eventCode]  used for the filename only
 * @returns {Promise<{filename: string, count: number}>}
 */
export async function exportToCsv({ eventCode } = {}) {
	const all = await listEntries();
	const header = csvColumns().join(',');

	const rows = all.map((e) =>
		[
			...IDENTITY_FIELDS.map((f) =>
				esc(f.key === 'matchNumber' || f.key === 'teamNumber' || f.key === 'allianceColor'
					? e[f.key]
					: cell(e, f))
			),
			esc(e.scoutName),
			esc(e.eventCode),
			esc(e.createdAt),
			...OBSERVATION_FIELDS.map((f) => esc(cell(e, f)))
		].join(',')
	);

	const csv = [header, ...rows].join('\r\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const ev = (eventCode || 'event').replace(/\s+/g, '-').toLowerCase();
	const filename = `${ev}-${new Date().toISOString().slice(0, 10)}.csv`;

	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Delay the revoke so Safari has time to start the download.
	setTimeout(() => URL.revokeObjectURL(url), 1000);

	return { filename, count: all.length };
}
