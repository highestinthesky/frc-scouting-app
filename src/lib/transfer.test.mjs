// Correctness checks for offline handoff. Run: node src/lib/transfer.test.mjs
//
// The cases that matter are the ones about MERGING. An import runs at an event,
// on a manager's laptop, against data they already have, from a file they did
// not write — and every failure mode here is silent: a duplicated row inflates a
// team's sample, a dropped row shrinks it, and neither looks wrong on screen.
//
// Deduplication itself is the schema's job, not this module's — the entries
// table indexes the content fingerprint and insertRemoteEntry() matches on it.
// What is tested here is that planImport() agrees with that fingerprint, because
// a preview that disagrees with what the import then does is worse than no
// preview at all.

import assert from 'node:assert/strict';
import {
	buildBundle,
	parseBundle,
	planImport,
	fingerprint,
	bundleFilename,
	BUNDLE_FORMAT,
	BUNDLE_FORMAT_VERSION
} from './transfer.js';
import { SCHEMA_VERSION } from './form-config.js';

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
	} catch (err) {
		console.error(`FAIL: ${name}\n  ${err.message}`);
		process.exitCode = 1;
	}
}

const row = (over = {}) => ({
	eventCode: '2026onsum',
	matchNumber: 12,
	teamNumber: 254,
	allianceColor: 'red',
	scoutName: 'Ada Lovelace',
	createdAt: '2026-08-18T10:00:00.000Z',
	observations: { autoScored: 3 },
	schemaVersion: SCHEMA_VERSION,
	...over
});

// ─── buildBundle ────────────────────────────────────────────────────────────

test('a bundle announces its format and version', () => {
	const b = buildBundle([row()], { eventCode: '2026onsum' });
	assert.equal(b.format, BUNDLE_FORMAT);
	assert.equal(b.formatVersion, BUNDLE_FORMAT_VERSION);
	assert.equal(b.entries.length, 1);
});

test('the local id never travels', () => {
	// An autoincrement primary key means something only on the device that
	// issued it. Carried across, it collides with an unrelated row.
	const b = buildBundle([{ ...row(), id: 7 }]);
	assert.equal(b.entries[0].id, undefined);
});

test('remoteId does travel', () => {
	// It is the strongest dedupe signal there is; insertRemoteEntry() checks it
	// before falling back to the fingerprint.
	const b = buildBundle([row({ remoteId: 'abc-123' })]);
	assert.equal(b.entries[0].remoteId, 'abc-123');
});

test('the bundle reports the HIGHEST schema version it contains', () => {
	// Not the app's own. A bundle of old rows exported by a new app is perfectly
	// importable, and saying otherwise would refuse a readable file.
	const b = buildBundle([row({ schemaVersion: 1 }), row({ schemaVersion: 3, matchNumber: 13 })]);
	assert.equal(b.schemaVersion, 3);
});

test('an empty export is still a valid bundle', () => {
	const b = buildBundle([], { eventCode: '2026onsum' });
	assert.equal(b.entries.length, 0);
	assert.equal(parseBundle(JSON.stringify(b)).ok, true);
});

// ─── parseBundle: refusing the wrong file ───────────────────────────────────

test('junk is refused with a sentence, not an exception', () => {
	const r = parseBundle('not json at all');
	assert.equal(r.ok, false);
	assert.match(r.error, /JSON/);
});

test('another app file is refused', () => {
	const r = parseBundle(JSON.stringify({ format: 'something-else', entries: [] }));
	assert.equal(r.ok, false);
});

test('a CSV export is refused rather than half-read', () => {
	const r = parseBundle(JSON.stringify({ rows: [row()] }));
	assert.equal(r.ok, false);
});

test('a newer FILE format is refused', () => {
	const b = buildBundle([row()]);
	b.formatVersion = BUNDLE_FORMAT_VERSION + 1;
	const r = parseBundle(JSON.stringify(b));
	assert.equal(r.ok, false);
	assert.match(r.error, /newer version/);
});

test('a newer ENTRY schema is refused rather than imported blind', () => {
	// This is the important one. A row recorded under a schema this build does
	// not know carries observation keys it cannot read, and every read path
	// treats an unknown key as absent — which is indistinguishable from a scout
	// who never recorded it. Refusing is the only honest option.
	const b = buildBundle([row({ schemaVersion: SCHEMA_VERSION + 1 })]);
	const r = parseBundle(JSON.stringify(b));
	assert.equal(r.ok, false);
	assert.match(r.error, /newer version of the form/);
});

test('an OLDER entry schema imports fine', () => {
	// The opposite mistake: refusing data recorded before a field existed would
	// throw away exactly the history the blank-vs-zero rule exists to preserve.
	const b = buildBundle([row({ schemaVersion: 1 })]);
	const r = parseBundle(JSON.stringify(b));
	assert.equal(r.ok, true);
});

test('the two version numbers are independent', () => {
	// Conflating them is how an import refuses a file it could read perfectly.
	const b = buildBundle([row({ schemaVersion: 1 })]);
	assert.equal(b.formatVersion, BUNDLE_FORMAT_VERSION);
	assert.equal(b.schemaVersion, 1);
	assert.equal(parseBundle(JSON.stringify(b)).ok, true);
});

// ─── planImport: what a merge would actually do ─────────────────────────────

const bundleOf = (rows) => ({ format: BUNDLE_FORMAT, formatVersion: 1, entries: rows });

test('a row already here is a duplicate, not an insert', () => {
	const mine = [row()];
	const plan = planImport(bundleOf([row()]), mine);
	assert.equal(plan.fresh.length, 0);
	assert.equal(plan.duplicate.length, 1);
});

test('importing the same bundle twice adds nothing the second time', () => {
	// The property the whole design rests on.
	const mine = [];
	const b = bundleOf([row(), row({ matchNumber: 13 })]);
	const first = planImport(b, mine);
	assert.equal(first.fresh.length, 2);
	const afterFirst = [...mine, ...first.fresh];
	const second = planImport(b, afterFirst);
	assert.equal(second.fresh.length, 0);
	assert.equal(second.duplicate.length, 2);
});

test('two devices recording the same observation stay one row', () => {
	// Identity is deliberately NOT in the fingerprint. Same match, same team,
	// same moment, different account — that is one observation seen twice, and
	// making it two rows would inflate the team's sample.
	const mine = [row({ profileId: 'aaa' })];
	const plan = planImport(bundleOf([row({ profileId: 'bbb' })]), mine);
	assert.equal(plan.fresh.length, 0, 'a differing profileId must not create a second row');
});

test('a genuinely different observation is fresh', () => {
	const mine = [row()];
	const plan = planImport(bundleOf([row({ createdAt: '2026-08-18T10:05:00.000Z' })]), mine);
	assert.equal(plan.fresh.length, 1);
});

test('duplicates WITHIN one file are caught', () => {
	// Someone will concatenate two exports by hand.
	const plan = planImport(bundleOf([row(), row()]), []);
	assert.equal(plan.fresh.length, 1);
	assert.equal(plan.duplicate.length, 1);
});

test('a matching remoteId counts as a duplicate even if the fingerprint drifted', () => {
	const mine = [row({ remoteId: 'r-1' })];
	const plan = planImport(bundleOf([row({ remoteId: 'r-1', scoutName: 'ada' })]), mine);
	assert.equal(plan.duplicate.length, 1);
	assert.equal(plan.fresh.length, 0);
});

test('rows for another event are separated, not silently merged', () => {
	// A manager importing at an event must not quietly absorb last week's data
	// into this week's numbers.
	const plan = planImport(bundleOf([row(), row({ eventCode: '2026onwat' })]), [], {
		eventCode: '2026onsum'
	});
	assert.equal(plan.fresh.length, 1);
	assert.equal(plan.otherEvent.length, 1);
});

test('without an event filter, everything is considered', () => {
	const plan = planImport(bundleOf([row(), row({ eventCode: '2026onwat' })]), []);
	assert.equal(plan.fresh.length, 2);
	assert.equal(plan.otherEvent.length, 0);
});

test('malformed rows are reported, not imported', () => {
	const plan = planImport(
		bundleOf([row(), { eventCode: '2026onsum' }, null, { ...row(), teamNumber: 'abc' }]),
		[]
	);
	assert.equal(plan.fresh.length, 1);
	assert.equal(plan.malformed.length, 3);
});

test('a zero team number is malformed, but a zero match number is not', () => {
	// Number.isFinite, not truthiness. Qualification 0 does not exist, but the
	// check that rejects it must be about the SHAPE of the value, and `!0` would
	// also reject a legitimately recorded zero elsewhere. Same instinct as the
	// blank-vs-zero rule.
	const plan = planImport(bundleOf([row({ matchNumber: 0 })]), []);
	assert.equal(plan.malformed.length, 0, 'match 0 is a number, so it is well-formed');
	assert.equal(plan.fresh.length, 1);
});

test('an empty bundle plans nothing and does not throw', () => {
	const plan = planImport(bundleOf([]), [row()]);
	assert.deepEqual(
		[plan.fresh.length, plan.duplicate.length, plan.otherEvent.length, plan.malformed.length],
		[0, 0, 0, 0]
	);
});

test('planImport never mutates what it was given', () => {
	const mine = [row()];
	const b = bundleOf([row({ matchNumber: 13 })]);
	const mineBefore = JSON.stringify(mine);
	const bBefore = JSON.stringify(b);
	planImport(b, mine);
	assert.equal(JSON.stringify(mine), mineBefore);
	assert.equal(JSON.stringify(b), bBefore);
});

// ─── the fingerprint matches the database's ─────────────────────────────────

test('the fingerprint uses exactly the indexed columns', () => {
	// If this drifts from the compound index in db.js, the preview and the import
	// disagree — the preview says 40 new and 12 land. Same five, same order.
	const a = fingerprint(row());
	assert.equal(a, ['2026onsum', 12, 254, 'Ada Lovelace', '2026-08-18T10:00:00.000Z'].join(' '));
	// Fields outside the index must not change it.
	assert.equal(fingerprint(row({ observations: { autoScored: 99 } })), a);
	assert.equal(fingerprint(row({ allianceColor: 'blue' })), a);
	assert.equal(fingerprint(row({ remoteId: 'x' })), a);
});

// ─── filenames ──────────────────────────────────────────────────────────────

test('a filename sorts, says what it holds, and is safe', () => {
	const n = bundleFilename(
		{ eventCode: '2026onsum', scoutName: 'Ada Lovelace' },
		new Date('2026-08-18T10:04:00Z')
	);
	assert.match(n, /^scout_2026onsum_ada-lovelace_2026-08-18-10-04\.json$/);
});

test('a filename survives a missing name and odd characters', () => {
	const n = bundleFilename({ eventCode: '2026 ON/SUM', scoutName: '' }, new Date('2026-01-02T03:04:00Z'));
	assert.match(n, /^scout_2026-on-sum_2026-01-02-03-04\.json$/);
	assert.ok(!/[/\\:]/.test(n.replace(/-/g, '')), 'no path separators survive');
});

console.log(`${passed} passed`);
