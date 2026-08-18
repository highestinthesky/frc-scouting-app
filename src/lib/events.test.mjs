// Static regression tests for the event-id cache.
//   node src/lib/events.test.mjs
//
// Static, and deliberately so. The bug these cover was not in a function that
// could be called with arguments — it was in WHAT GETS STORED and WHO CLEARS IT,
// across two modules, and it only manifested against a live RLS-protected
// Postgres partway through boot. A unit test with a stubbed client would have
// had to reproduce the race to see it, and would have passed on the broken code
// for any ordering it happened to pick.
//
// What went wrong, so the assertions read as more than trivia:
//
//   `events` is behind RLS, so "no row" does not mean "no such event" — it means
//   "not visible to whoever is asking right now". At boot that is routinely
//   nobody: session.load(), auth.init(), syncInit() and reminders.init() race,
//   and sync resolves the event code before the session is necessarily ready.
//
//   That transient null was written into a Map that lives for the whole tab. So
//   it became permanent, and deleting an entry answered "Not connected to this
//   event, so it can only be removed from this device" — on an event the manager
//   was plainly a member of, until they reloaded.
//
//   forgetEvents() would have covered it, and its own comment said it was called
//   on sign-in and sign-out. It was not: nothing outside events.js called it, and
//   auth.svelte.js did not import the module at all.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.join(here, rel), 'utf8');

// Comments quote the broken forms on purpose. Strip them, or the documentation
// of a bug reads as the bug — which has caught a checker in this repo three
// times already.
const uncomment = (js) =>
	js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

const events = uncomment(src('events.js'));
const auth = uncomment(src('auth.svelte.js'));

// ─── the cache stores resolutions, never refusals ───────────────────────────

test('eventIdForCode caches an id only when it resolved one', () => {
	// The guard is the fix. Without it a null taken while signed out, or mid-boot,
	// is the answer for the rest of the tab.
	assert.match(
		events,
		/if\s*\(\s*id\s*\)\s*idByCode\.set\(/,
		'the cache write must be guarded on a truthy id'
	);
});

test('nothing writes a bare null into the cache', () => {
	const writes = [...events.matchAll(/idByCode\.set\(([^)]*)\)/g)].map((m) => m[1]);
	assert.ok(writes.length > 0, 'expected at least one cache write to inspect');
	for (const args of writes) {
		assert.ok(
			!/null/.test(args),
			`idByCode.set(${args}) writes a null — a refusal must not be remembered`
		);
	}
});

test('a lookup error still throws rather than being cached', () => {
	// The opposite failure: swallowing a network blip as "no such event" pins the
	// same wrong answer by a different route.
	assert.match(events, /if\s*\(error\)\s*throw/, 'a failed lookup must throw, not resolve to null');
});

// ─── and membership changes drop it ─────────────────────────────────────────

test('auth.svelte.js actually imports forgetEvents', () => {
	// It did not, for the whole life of the bug, while the function it needed
	// carried a comment claiming it was called from here.
	assert.match(auth, /import\s*\{[^}]*forgetEvents[^}]*\}\s*from\s*'\.\/events\.js'/);
});

test('signing IN drops the cache', () => {
	// The shared-laptop case, and the boot race: whatever was resolvable while
	// signed out is not what this account can see.
	const branch = /SIGNED_IN'\s*\)\s*\{([\s\S]*?)\}\s*else/.exec(auth)?.[1] ?? '';
	assert.match(branch, /forgetEvents\(\)/, 'SIGNED_IN must call forgetEvents()');
});

test('signing OUT drops the cache', () => {
	// Otherwise the next person to sign in on the same tab inherits the previous
	// account's event ids.
	const branch = /SIGNED_OUT'\s*\)\s*\{([\s\S]*?)\n\t*\}/.exec(auth)?.[1] ?? '';
	assert.match(branch, /forgetEvents\(\)/, 'SIGNED_OUT must call forgetEvents()');
});

// ─── the module boundary that makes this safe to import ─────────────────────

test('events.js does not import auth.svelte.js', () => {
	// auth.svelte.js now imports events.js. The reverse would be a cycle, and
	// this direction is the one that must not appear.
	assert.ok(
		!/from\s*'\.\/auth\.svelte\.js'/.test(events),
		'events.js importing auth.svelte.js would close an import cycle'
	);
});

test('db.js still does not import auth — recording never depends on it', () => {
	// The app's oldest invariant, and this change touched auth's import graph, so
	// it is worth re-asserting from here.
	const db = uncomment(src('db.js'));
	assert.ok(!/auth\.svelte\.js/.test(db), 'db.js must not import auth.svelte.js');
});

console.log(`${passed} passed`);
