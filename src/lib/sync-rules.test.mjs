// Tests for the sync layer's data-losing decisions.
//   node src/lib/sync-rules.test.mjs
//
// These live in sync-rules.js rather than db.js or sync.svelte.js because
// those modules construct a Dexie instance and use runes, neither of which
// survives outside a browser. The rules that decide whether a row is
// overwritten are exactly the ones worth pinning down, so they were pulled
// somewhere they can be.

import {
	shouldApplyRemote,
	sameObservations,
	pushMode,
	entryWritePayloads,
	EDITABLE_FIELDS
} from './sync-rules.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

const localRow = (over = {}) => ({
	id: 1,
	remoteId: 'r1',
	pendingSync: false,
	matchNumber: 14,
	teamNumber: 1234,
	allianceColor: 'red',
	schemaVersion: 3,
	submittedBy: 'profile-a',
	observations: { autoPath: 'left', notes: 'fast' },
	...over
});

// ─── the guard that protects unsaved work ──────────────────────────────────
{
	const local = localRow({ pendingSync: true });
	ok(
		'a locally-edited row is never overwritten by a peer',
		shouldApplyRemote(local, { matchNumber: 99 }) === false,
		'the user can see their edit on screen; clobbering it looks like the app undid it'
	);
	ok(
		'once pushed, the same row does accept a peer edit',
		shouldApplyRemote(localRow({ pendingSync: false }), { matchNumber: 99 }) === true
	);
}

// ─── no-op updates ─────────────────────────────────────────────────────────
{
	const local = localRow();
	ok('identical values are not a change', shouldApplyRemote(local, { ...local }) === false);
	ok('an empty payload is not a change', shouldApplyRemote(local, {}) === false);
	ok(
		'undefined fields are ignored, not treated as a clear',
		shouldApplyRemote(local, { matchNumber: undefined, teamNumber: undefined }) === false
	);
	ok('a missing local row applies nothing', shouldApplyRemote(undefined, { matchNumber: 9 }) === false);
}

// ─── each editable field is actually watched ───────────────────────────────
{
	const local = localRow();
	const changes = {
		matchNumber: 15,
		teamNumber: 5678,
		allianceColor: 'blue',
		schemaVersion: 4,
		submittedBy: 'profile-b',
		observations: { autoPath: 'right', notes: 'fast' }
	};
	for (const k of EDITABLE_FIELDS) {
		ok(`a change to ${k} is detected`, shouldApplyRemote(local, { [k]: changes[k] }) === true);
	}
}

// ─── observations compared by content ──────────────────────────────────────
{
	ok('key order does not matter', sameObservations({ a: 1, b: 2 }, { b: 2, a: 1 }));
	ok('a changed value matters', !sameObservations({ a: 1 }, { a: 2 }));
	ok('an added key matters', !sameObservations({ a: 1 }, { a: 1, b: 2 }));
	ok('a removed key matters', !sameObservations({ a: 1, b: 2 }, { a: 1 }));
	ok('null and undefined are both empty', sameObservations(null, undefined));
	ok('empty equals empty', sameObservations({}, {}));

	// Postgres jsonb does not preserve key order, so a round trip through the
	// server reorders keys. Comparing with JSON.stringify would call every
	// pull a change and re-render the app forever.
	const local = localRow({ observations: { a: 'x', b: 'y' } });
	ok(
		'a reordered round trip is not a change',
		shouldApplyRemote(local, { observations: { b: 'y', a: 'x' } }) === false
	);

	// Counters arrive from jsonb as numbers and may be held locally as the
	// strings a form input produced. Same reading either way.
	ok('numeric and string forms of a value match', sameObservations({ n: 3 }, { n: '3' }));
	ok('blank and missing are both "not recorded"', sameObservations({ n: '' }, { n: null }));

	// The invariant the whole metrics engine rests on: blank means NOT
	// RECORDED, 0 means RECORDED AND IT WAS ZERO. If this comparison ever
	// treated them as equal, a pull could quietly rewrite a real zero as
	// blank — or the reverse — and every team average downstream would move
	// with nothing on screen looking wrong. See lib/metrics.js.
	ok('a recorded zero is not the same as blank', !sameObservations({ n: 0 }, { n: '' }));
	ok('a recorded zero is not the same as missing', !sameObservations({ n: 0 }, { n: null }));
	ok('"0" and 0 are the same reading', sameObservations({ n: '0' }, { n: 0 }));
}

// ─── push direction ────────────────────────────────────────────────────────
{
	ok('a never-synced row inserts', pushMode({ remoteId: null }) === 'insert');
	ok('a synced row updates', pushMode({ remoteId: 'r1' }) === 'update');
	ok('a missing row defaults to insert', pushMode(undefined) === 'insert');
}

// ─── immutable submitter attribution ──────────────────────────────────────
{
	const common = { id: 'remote-id', team_number: 254 };
	const payloads = entryWritePayloads(common, 'profile-a');
	ok('a new row carries the account performing its first sync',
		payloads.insert.submitted_by === 'profile-a');
	ok('an entry edit never rewrites submitted_by',
		!Object.hasOwn(payloads.update, 'submitted_by'));
	ok('payload construction does not mutate the common row',
		!Object.hasOwn(common, 'submitted_by'));
	ok('a legacy anonymous recording inserts an explicit null attribution',
		entryWritePayloads(common, undefined).insert.submitted_by === null);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
