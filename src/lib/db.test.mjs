// IndexedDB schema upgrades, against a real (faked) IndexedDB.
//   node src/lib/db.test.mjs
//
// A Dexie version bump is the one change in this app that runs exactly once per
// device, in the field, with the user's only copy of their data, and cannot be
// re-run to see what went wrong. It either works on the first open or the
// person has lost their entries.
//
// Nothing else in the suite exercises it: every other test operates on plain
// objects. So this one replays the real `.version()` blocks out of db.js —
// parsed from the source, so it cannot drift from what ships — seeds them the
// way a returning user's database actually looks, and opens at the new version.
//
// It also runs the legacy picklist migration, which is the part that reads a
// key written by a version of the app that is being replaced.

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'db.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── the real version blocks ───────────────────────────────────────────────

const blocks = [...source.matchAll(/db\.version\((\d+)\)\.stores\((\{[\s\S]*?\})\);/g)].map(
	([, n, literal]) => ({
		version: Number(n),
		// Strip comments; the blocks are heavily annotated and the literal has
		// to survive eval.
		stores: eval(`(${literal.replace(/\/\/[^\n]*/g, '')})`)
	})
);

ok('found every version block in db.js', blocks.length >= 3, `found ${blocks.length}`);
ok(
	'versions are contiguous from 1',
	blocks.every((b, i) => b.version === i + 1),
	blocks.map((b) => b.version).join()
);

const LATEST = blocks[blocks.length - 1].version;

/** A database declared up to `upTo`, so we can open at an old version first. */
function dbAt(name, upTo) {
	const d = new Dexie(name);
	for (const b of blocks) if (b.version <= upTo) d.version(b.version).stores(b.stores);
	return d;
}

// ─── the upgrade a returning user actually performs ────────────────────────

{
	const name = `frc-scout-upgrade-${Date.now()}`;

	// Seed at v2: an entry, the identity settings, and the pre-sync picklist
	// blob under its old key.
	const old = dbAt(name, 2);
	await old.open();
	await old.table('entries').add({
		eventCode: '2027hvr',
		matchNumber: 12,
		teamNumber: 254,
		scoutName: 'ning',
		createdAt: '2026-03-14T10:00:00Z',
		observations: { strengths: 'fast' }
	});
	await old.table('settings').bulkPut([
		{ key: 'scoutName', value: 'ning' },
		{ key: 'eventCode', value: '2027hvr' },
		{
			key: 'picklist:2027hvr',
			value: { primary: [254, 118, 1678], doNotPick: [9999], weights: { autoNotes: 2 } }
		}
	]);
	old.close();

	// Open at the current version — this is the upgrade.
	const now = await dbAt(name, LATEST).open();

	ok('the database opens at the current version', now.verno === LATEST, `verno ${now.verno}`);
	ok('entries survive the upgrade', (await now.table('entries').count()) === 1);
	ok(
		'...with their contents intact',
		(await now.table('entries').toArray())[0].observations.strengths === 'fast'
	);
	ok('settings survive the upgrade', (await now.table('settings').count()) === 3);
	ok(
		'the legacy picklist key is NOT destroyed by the bump',
		Boolean((await now.table('settings').get('picklist:2027hvr'))?.value),
		"it is the user's only copy until migrateLegacy has run"
	);
	ok('the picklist table exists', now.tables.some((t) => t.name === 'picklist'));

	// The indexes the store actually queries. A store declared without one of
	// these throws at read time, not at open time — so it would ship.
	await now.table('picklist').bulkPut([
		mkRow('2027hvr', 254, 'pick', 1024),
		mkRow('2027hvr', 118, 'pick', 2048),
		mkRow('2027hvr', 9999, 'avoid', 1024),
		mkRow('2028abc', 33, 'pick', 1024)
	]);
	ok(
		'where(eventCode) works and scopes to one event',
		(await now.table('picklist').where('eventCode').equals('2027hvr').toArray()).length === 3
	);
	ok(
		'the [eventCode+status] compound index works',
		(await now.table('picklist').where('[eventCode+status]').equals(['2027hvr', 'pick']).toArray())
			.length === 2
	);
	ok(
		'the primary key is per event, so two events can hold the same team',
		(await now.table('picklist').get('2028abc:33')) !== undefined
	);

	await now.delete();
}

// ─── a fresh install skips straight to the latest version ──────────────────

{
	const fresh = dbAt(`frc-scout-fresh-${Date.now()}`, LATEST);
	await fresh.open();
	ok('a brand new database opens at the latest version', fresh.verno === LATEST);
	ok('...with every table present', fresh.tables.length === 3, fresh.tables.map((t) => t.name).join());
	await fresh.delete();
}

// ─── migrateLegacy: the blob becomes rows, exactly once ────────────────────

{
	// picklist-store.js imports the shared `db` singleton, so the fixture has to
	// go through that instance rather than a local one.
	const { db, markEntrySynced } = await import('./db.js');
	const store = await import('./picklist-store.js');
	await db.open();

	const attributionFixture = await db.entries.add({
		eventCode: '2027hvr',
		matchNumber: 1,
		teamNumber: 254,
		scoutName: 'ning',
		createdAt: '2026-08-03T12:00:00Z',
		pendingSync: true
	});
	await markEntrySynced(attributionFixture, 'remote-attribution-row', 'server-profile');
	const attributed = await db.entries.get(attributionFixture);
	ok('the authoritative INSERT attribution is persisted locally',
		attributed.submittedBy === 'server-profile');
	ok('persisting server attribution also marks the outbox row clean',
		attributed.pendingSync === false && attributed.remoteId === 'remote-attribution-row');

	await db.settings.put({
		key: 'picklist:2027hvr',
		value: { primary: [254, 118, 1678], doNotPick: [9999], weights: { autoNotes: 2 } }
	});

	const created = await store.migrateLegacy('2027hvr');
	ok('every team in the blob becomes a row', created === 4, `created ${created}`);

	// localRows returns BOTH lists — the page splits them by status, because
	// nothing ranks a pick against an avoid.
	const rows = await store.localRows('2027hvr');
	const picks = rows.filter((r) => r.status === 'pick');
	ok('rows come back in the blob order', picks.map((r) => r.teamNumber).join() === '254,118,1678');
	ok('...because rank was assigned in that order', picks[0].rank < picks[1].rank);
	ok(
		'do-not-pick teams carry the avoid status',
		(await db.picklist.get('2027hvr:9999')).status === 'avoid'
	);
	ok('both lists start their ranks from the same base', rows.filter((r) => r.rank === 1024).length === 2);

	// Which is exactly why a rebalance has to look at each list separately.
	// Judging them together sees two rows at rank 1024, reads it as exhausted
	// precision, and rewrites every row in the event on every load — marking
	// them all pending and pushing all of them.
	ok(
		'a freshly migrated list needs no rebalance',
		(await store.rebalanceIfNeeded('2027hvr')) === 0,
		'two lists sharing a base rank is not a collapsed gap'
	);
	ok(
		'...and nothing became pending as a result',
		(await store.localPending('2027hvr')).length === 4
	);
	ok('weights come across too', (await store.localWeights('2027hvr'))?.weights.autoNotes === 2);
	ok(
		'migrated rows are pending, so they reach the server',
		(await store.localPending('2027hvr')).length === 4
	);

	// Running twice must not resurrect anything. This is the failure that
	// matters: a manager migrates, deletes three teams they no longer want,
	// reloads, and gets them back.
	await store.remove('2027hvr', 118);
	const again = await store.migrateLegacy('2027hvr');
	ok('a second run creates nothing', again === 0);
	ok(
		'a team deleted after migrating stays deleted',
		!(await store.localRows('2027hvr')).some((r) => r.teamNumber === 118)
	);

	// An event that never had a picklist is not an error.
	ok('an event with no legacy blob migrates zero rows', (await store.migrateLegacy('2029zzz')) === 0);
	ok('an empty event code is ignored', (await store.migrateLegacy('')) === 0);

	await db.delete();
}

function mkRow(eventCode, teamNumber, status, rank) {
	return {
		key: `${eventCode}:${teamNumber}`,
		eventCode,
		teamNumber,
		status,
		rank,
		note: null,
		updatedAt: '2026-08-01T00:00:00Z',
		pushedAt: null,
		deleted: false
	};
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
