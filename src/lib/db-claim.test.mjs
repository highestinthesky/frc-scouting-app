// Claiming, against a real (faked) IndexedDB.
//   node src/lib/db-claim.test.mjs
//
// event-rules.test.mjs proves the RULE. This proves the write path applies it —
// that signing in really does attach the account to the rows this device
// recorded offline, and really does re-queue them so the attribution reaches
// the server.
//
// Separate from db.test.mjs on purpose: that file parses db.js as source to
// replay version blocks and never imports it. This one imports it for real, so
// it opens the actual `frc-scout` database under fake-indexeddb.

import 'fake-indexeddb/auto';
import {
	db,
	addEntry,
	claimEntriesForAccount,
	getOrCreateClientId,
	getUnsyncedEntries,
	clearEntries,
	getPullWatermark,
	setPullWatermark
} from './db.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

await db.open();
const mine = await getOrCreateClientId();

const base = {
	eventCode: '2026onto',
	matchNumber: 1,
	teamNumber: 3419,
	allianceColor: 'red',
	observations: {}
};

// Recorded signed out, on this device: the whole point of the feature.
const offline1 = await addEntry({ ...base, matchNumber: 1, scoutName: 'Ning' });
const offline2 = await addEntry({ ...base, matchNumber: 2, scoutName: 'Ning' });

// Already attributed — a row this device recorded while someone else was signed
// in. A shared tablet does this every time it changes hands.
const owned = await addEntry({ ...base, matchNumber: 3, scoutName: 'Ada' });
await db.entries.update(owned, { submittedBy: 'someone-else' });

// A teammate's row that arrived by sync. Not this device's to take.
const peer = await addEntry({ ...base, matchNumber: 4, scoutName: 'Ada' });
await db.entries.update(peer, { clientId: 'another-device', remoteId: 'r-peer' });

// Pushed before sync required a session, so the server copy is unattributed too.
const pushed = await addEntry({ ...base, matchNumber: 5, scoutName: 'Ning' });
await db.entries.update(pushed, { remoteId: 'r-pushed', pendingSync: false });

const claimed = await claimEntriesForAccount('profile-1', 'Haolun Ning');
ok('claims exactly this device\'s unowned rows', claimed === 3, `claimed ${claimed}`);

const after = Object.fromEntries((await db.entries.toArray()).map((r) => [r.id, r]));
ok('an offline row gains the account', after[offline1].submittedBy === 'profile-1');
ok('the second offline row too', after[offline2].submittedBy === 'profile-1');
ok('an already-owned row is untouched', after[owned].submittedBy === 'someone-else');
ok('a peer device row is untouched', after[peer].submittedBy === undefined, String(after[peer].submittedBy));

// The repair case: it was already on the server as nobody's, so it has to go
// back up carrying the account.
ok('a pushed-but-unowned row is claimed', after[pushed].submittedBy === 'profile-1');
ok('and is re-queued for push', after[pushed].pendingSync === true);
const unsynced = (await getUnsyncedEntries()).map((r) => r.id);
ok('re-queued means getUnsyncedEntries sees it', unsynced.includes(pushed), JSON.stringify(unsynced));

// The join key must not move. CLAUDE.md: overwriting a name a device already had
// detaches it from every assignment addressed to the old spelling.
ok('an existing scout name survives the claim', after[offline1].scoutName === 'Ning');

const blank = await addEntry({ ...base, matchNumber: 6, scoutName: '' });
await claimEntriesForAccount('profile-1', 'Haolun Ning');
ok('a blank scout name is filled from the account', (await db.entries.get(blank)).scoutName === 'Haolun Ning');

// Idempotence. Sign-in happens many times, and loadProfile() runs this on every
// session restore, so a second pass must be a no-op rather than a rewrite.
const again = await claimEntriesForAccount('profile-2', 'Someone Else');
ok('a second sign-in claims nothing', again === 0, `claimed ${again}`);
ok(
	'and does not reassign the first account\'s rows',
	(await db.entries.get(offline1)).submittedBy === 'profile-1'
);

ok('no account is a no-op', (await claimEntriesForAccount('', 'x')) === 0);
ok('a null account is a no-op', (await claimEntriesForAccount(null)) === 0);

// ─── the pull position kept across launches ─────────────────────────────────
//
// It means "every row up to here is on this device", so it is only as true as
// the rows are still here. Clearing them must clear it, or every one of them
// stays on the server and is never downloaded again.
{
	const a = 'profile-1|11111111-1111-4111-8111-111111111111';
	const b = 'profile-2|11111111-1111-4111-8111-111111111111';
	ok('nothing saved reads as no position', (await getPullWatermark(a)) === null);
	await setPullWatermark(a, '2026-10-05T12:00:05.123456+00:00');
	await setPullWatermark(b, '2026-10-05T09:00:00+00:00');
	ok('a position reads back exactly, microseconds included',
		(await getPullWatermark(a)) === '2026-10-05T12:00:05.123456+00:00');
	ok('another account at the same event keeps its own',
		(await getPullWatermark(b)) === '2026-10-05T09:00:00+00:00');
	await setPullWatermark(b, null);
	ok('null forgets one scope', (await getPullWatermark(b)) === null);
	ok('and leaves the others', (await getPullWatermark(a)) !== null);
	await setPullWatermark(b, 'not a time');
	ok('an unreadable position reads as none, so the pull backfills', (await getPullWatermark(b)) === null);

	ok('precondition: there are entries to clear', (await db.entries.count()) > 0);
	await clearEntries();
	ok('clearing entries clears them', (await db.entries.count()) === 0);
	ok('and forgets every pull position with them', (await getPullWatermark(a)) === null);
	ok('the device id survives a clear', (await getOrCreateClientId()) === mine);
}

await db.close();
console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
