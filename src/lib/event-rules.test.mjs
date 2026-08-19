// Tests for the pure decisions around events and claiming.
//   node src/lib/event-rules.test.mjs
//
// Two questions live here, both pure so they can be tested without a database:
// which event a device should be looking at, and which locally-recorded rows a
// scout may claim when they sign in.
//
// The claim rules are the sharp ones. Claiming is how work recorded signed-out
// becomes attributed, and getting it wrong means either losing a scout's
// afternoon or stealing a teammate's.

import {
	normalizeCode,
	eventLabel,
	sortEvents,
	pickCurrentEvent,
	claimableRows,
	claimRow
,
	looksLikeTbaKey
} from './event-rules.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── codes ──────────────────────────────────────────────────────────────────
{
	ok('a code lower-cases and trims', normalizeCode('  2026ONTO ') === '2026onto');
	ok('a blank code is null', normalizeCode('   ') === null);
	ok('a non-string code is null', normalizeCode(undefined) === null);
	ok('a code keeps its digits', normalizeCode('2026onsum') === '2026onsum');
}

// ─── labels ─────────────────────────────────────────────────────────────────
{
	ok(
		'an event shows its name',
		eventLabel({ code: '2026onto', name: 'Ontario Provincials' }) === 'Ontario Provincials'
	);
	// The backfill set name = code for every pre-0019 event, and a screen full of
	// "2026onto — 2026onto" is worse than just the code.
	ok('a name equal to the code shows once', eventLabel({ code: '2026onto', name: '2026onto' }) === '2026onto');
	ok('a missing name falls back to the code', eventLabel({ code: '2026onto' }) === '2026onto');
	ok('a nameless codeless event still renders', eventLabel({}) === 'Untitled event');
}

// ─── ordering ───────────────────────────────────────────────────────────────
{
	const events = [
		{ id: 'a', code: 'aaa', name: 'Alpha', starts_on: '2026-03-01' },
		{ id: 'b', code: 'bbb', name: 'Bravo', starts_on: '2026-09-01' },
		{ id: 'c', code: 'ccc', name: 'Charlie', starts_on: null },
		{ id: 'd', code: 'ddd', name: 'Delta', starts_on: '2026-09-01', archived_at: '2026-09-10' }
	];
	const sorted = sortEvents(events);
	ok('the newest event comes first', sorted[0].id === 'b', sorted.map((e) => e.id).join(','));
	// An archived event is still reachable — a manager may need last season's
	// data — but it never outranks a live one.
	ok('archived events sink to the bottom', sorted[sorted.length - 1].id === 'd');
	ok('a dateless event sorts after dated ones', sorted[2].id === 'c', sorted.map((e) => e.id).join(','));
	ok('sorting does not mutate the input', events[0].id === 'a');
}

// ─── which event is current ─────────────────────────────────────────────────
{
	const events = [
		{ id: 'e1', code: '2026onto', name: 'Ontario', starts_on: '2026-03-01' },
		{ id: 'e2', code: '2026onsum', name: 'Summer', starts_on: '2026-09-01' }
	];

	ok('a remembered id wins', pickCurrentEvent(events, { eventId: 'e1' })?.id === 'e1');

	// The device may have been on this event since before events had ids. The
	// code is the only thing an upgrading install carries, so it has to resolve.
	ok(
		'a remembered code resolves when the id is unknown',
		pickCurrentEvent(events, { eventCode: '2026onto' })?.id === 'e1'
	);
	ok(
		'a remembered code is matched case-insensitively',
		pickCurrentEvent(events, { eventCode: '  2026ONTO ' })?.id === 'e1'
	);

	// Falling back to *something* matters: a scout who opens the app to an empty
	// picker cannot record, and the most recent event is the overwhelmingly
	// likely answer at a competition.
	ok('with nothing remembered, the newest event is chosen', pickCurrentEvent(events, {})?.id === 'e2');

	// But a remembered event the device has since lost access to must NOT
	// silently become a different event — that would file this match's
	// observations under last season.
	ok(
		'an unknown remembered id does not silently fall through',
		pickCurrentEvent(events, { eventId: 'gone' }) === null
	);
	ok('no events means no current event', pickCurrentEvent([], { eventId: 'e1' }) === null);
	ok('a null list is handled', pickCurrentEvent(null, {}) === null);
}

// ─── claiming ───────────────────────────────────────────────────────────────
//
// A row is claimable when it was recorded by THIS device and belongs to nobody
// yet. Both halves are load-bearing and each has a way of going wrong that
// loses or steals work.
{
	const me = 'device-A';
	const rows = [
		{ id: 1, clientId: 'device-A', submittedBy: null, scoutName: 'Ning' },
		{ id: 2, clientId: 'device-A', submittedBy: 'someone-else', scoutName: 'Ning' },
		{ id: 3, clientId: 'device-B', submittedBy: null, scoutName: 'Ada' },
		{ id: 4, clientId: null, submittedBy: null, scoutName: 'Ning' },
		{ id: 5, clientId: 'device-A', submittedBy: null, scoutName: 'Ning' }
	];

	const claimable = claimableRows(rows, me);
	const ids = claimable.map((r) => r.id);
	ok('only this device and only unowned rows', JSON.stringify(ids) === '[1,5]', JSON.stringify(ids));

	// Row 2 is the "already mine or already someone's" case. Re-claiming it would
	// let a shared device rewrite history every time a different scout signed in.
	ok('an already-attributed row is never re-claimed', !ids.includes(2));
	// Row 3 is a teammate's phone syncing through the same account later.
	ok('another device is never claimed', !ids.includes(3));
	// Row 4 predates client_id. Claiming it would be a guess.
	ok('a row with no client_id is never claimed', !ids.includes(4));

	ok('a null client id claims nothing', claimableRows(rows, null).length === 0);
	ok('an empty client id claims nothing', claimableRows(rows, '').length === 0);
	ok('a null row list is handled', claimableRows(null, me).length === 0);

	// Idempotence: running the claim twice must be a no-op the second time,
	// because sign-in happens more than once.
	const claimed = claimable.map((r) => claimRow(r, 'profile-1', 'Haolun Ning'));
	ok('claiming sets the account', claimed.every((r) => r.submittedBy === 'profile-1'));
	ok('claiming leaves the device tag alone', claimed.every((r) => r.clientId === 'device-A'));
	ok('a claimed row is no longer claimable', claimableRows(claimed, me).length === 0);

	// The join key does not move. CLAUDE.md: overwriting a name a device already
	// had detaches it from every assignment addressed to the old spelling.
	ok('claiming never rewrites an existing scout name', claimed.every((r) => r.scoutName === 'Ning'));
	const blank = claimRow({ clientId: 'device-A', submittedBy: null, scoutName: '' }, 'p1', 'Haolun Ning');
	ok('a blank scout name is filled on claim', blank.scoutName === 'Haolun Ning');
	const noName = claimRow({ clientId: 'device-A', submittedBy: null }, 'p1', '');
	ok('with no name to give, the name stays empty', !noName.scoutName);
}

// ─── looksLikeTbaKey ────────────────────────────────────────────────────────
//
// events.code was always meant to BE the TBA key — 0019's table comment says so
// — but nothing in the UI said it, so codes got invented and the schedule fetch
// then needed a second, different string in a second box.
//
// Advisory, not a gate: an offseason scrimmage has no TBA entry and still has to
// be scoutable. The tests below pin both halves of that.
{
	ok('a plain TBA key is recognised', looksLikeTbaKey('2026nyny'));
	ok('a longer event code is fine', looksLikeTbaKey('2025onwat'));
	ok('uppercase is normalised first', looksLikeTbaKey('2024CASJ'));
	ok('surrounding space is trimmed first', looksLikeTbaKey('  2026nyny  '));

	// This project's own production event. Divisions and reruns carry a suffix.
	ok('a division suffix is allowed', looksLikeTbaKey('2026nyny-6'));

	ok('no year is not a TBA key', !looksLikeTbaKey('onto'));
	ok('a year alone is not a TBA key', !looksLikeTbaKey('2026'));
	ok('a three-digit year is not a TBA key', !looksLikeTbaKey('202nyny'));
	ok('the code part must start with a letter', !looksLikeTbaKey('20261234'));
	ok('an offseason name is not a TBA key', !looksLikeTbaKey('summer-scrimmage'));
	ok('empty is not a TBA key', !looksLikeTbaKey('') && !looksLikeTbaKey(null));
	ok('a non-string is not a TBA key', !looksLikeTbaKey(2026));

	// The whole string, not a substring. Found by mutation: removing the anchors
	// left every assertion above green, and "notes-2026nyny-backup" would have
	// been accepted as a TBA key and then failed the schedule fetch with a
	// message about the key rather than about the extra words around it.
	ok('a key buried in other text is not a match', !looksLikeTbaKey('notes-2026nyny-backup'));
	ok('trailing junk is not a match', !looksLikeTbaKey('2026nyny!'));
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
