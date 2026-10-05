// State that follows an account: which copy wins when a device and the server
// disagree.
//   node src/lib/account-state-rules.test.mjs

import {
	pickDraft,
	stillMatters,
	dismissalsToPush,
	mergeDismissals,
	dismissedFor
} from './account-state-rules.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};

// ─── drafts ────────────────────────────────────────────────────────────────
{
	const v = (n) => ({ notes: n });
	ok('nothing anywhere opens a blank form', pickDraft(null, null) === null);
	ok('this device alone opens its own draft', pickDraft({ values: v('a'), savedAt: 10 }, null)?.from === 'local');
	ok('another device alone — the form follows the account',
		pickDraft(null, { values: v('b'), savedAt: 10 })?.values.notes === 'b');
	ok('the newer copy wins: continued on the other device',
		pickDraft({ values: v('a'), savedAt: 10 }, { values: v('b'), savedAt: 20 })?.from === 'remote');
	ok('the newer copy wins: continued here',
		pickDraft({ values: v('a'), savedAt: 30 }, { values: v('b'), savedAt: 20 })?.from === 'local');

	// The draft became an entry here; its delete never reached the server.
	ok('a saved entry\'s tombstone beats the stale server copy',
		pickDraft({ cleared: true, savedAt: 30 }, { values: v('old'), savedAt: 20 }) === null);
	ok('but not a draft typed on another device after it',
		pickDraft({ cleared: true, savedAt: 30 }, { values: v('new'), savedAt: 40 })?.values.notes === 'new');
	ok('a tombstone alone opens nothing', pickDraft({ cleared: true, savedAt: 30 }, null) === null);
	ok('a server copy with no values is ignored', pickDraft(null, { values: null, savedAt: 40 }) === null);
}

// ─── dismissals ────────────────────────────────────────────────────────────
{
	const now = Date.parse('2026-10-05T12:00:00Z');
	const later = '2026-10-05T13:00:00Z';
	const earlier = '2026-10-05T11:00:00Z';

	ok('a dismissal with no expiry still matters', stillMatters(null, now));
	ok('an expired one does not', !stillMatters(earlier, now));

	const local = {
		'auto:q1:254': { e: 'ev1', x: later },
		'm-1': { e: 'ev1', x: later },
		'm-old': { e: 'ev1', x: earlier },
		'm-other': { e: 'ev2', x: later }
	};
	const push = dismissalsToPush(local, { 'm-1': later }, 'ev1', now);
	ok('only this event\'s unsent, unexpired dismissals are pushed',
		push.length === 1 && push[0].key === 'auto:q1:254', JSON.stringify(push));

	const merged = mergeDismissals(local, { 'm-2': later, 'm-gone': earlier }, 'ev1', now);
	ok('a dismissal made on another device arrives', merged['m-2']?.e === 'ev1');
	ok('an expired one does not', !('m-gone' in merged) && !('m-old' in merged));
	ok('a merge never undoes a local dismissal the server lacks', 'auto:q1:254' in merged);
	ok('another event\'s dismissals are kept', 'm-other' in merged);

	const hidden = dismissedFor(merged, 'ev1', now);
	ok('hidden: this event\'s dismissals', hidden.has('m-2') && hidden.has('auto:q1:254'));
	ok('not another event\'s', !hidden.has('m-other'));
	ok('an event-less dismissal is honoured everywhere', dismissedFor({ k: { x: later } }, 'ev9', now).has('k'));
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
