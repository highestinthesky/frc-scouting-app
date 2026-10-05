// The sync layer itself, against an in-memory PostgREST.
//   node src/lib/sync.test.mjs
//
// sync-rules.test.mjs proves the rules. This runs the real sync.svelte.js —
// compiled with Svelte's compiler, on fake-indexeddb, with fetch answered by
// the small server below — because the bugs it pins were in how the rules are
// wired together: when a watermark is recorded, what a delete waits for, what
// survives a relaunch. Each scenario failed on the code before its fix.
//
// Swapped for stubs: auth (signed in as u1), session, reminders, the schedule
// and assignment pulls. Time is ours: performance.now() is a variable, and the
// 3-second poll timer never fires, so flush() is the only thing that ticks.

import { register, createRequire } from 'node:module';

const require = createRequire(import.meta.url);
await import('fake-indexeddb/auto');

const STUBS = {
	'auth.svelte.js': "export const auth = { signedIn: true, userId: 'u1', profile: { id: 'u1' }, me: { key: 'ning' } };",
	'session.svelte.js': "export const session = { scoutName: '', eventCode: '2026test' };",
	'reminders.svelte.js': 'export const reminders = { pull: async () => {}, refreshSchedule: async () => {} };',
	'tba.js': 'export async function pullScheduleIfStale() { return false; }',
	'assignments.js': 'export async function pullAndApplyForScout() { return []; }'
};
const HOOKS = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
let lib, stubs, compileModule;
export function initialize(data) {
	lib = data.lib;
	stubs = data.stubs;
	compileModule = data.compileModule;
}
export async function resolve(spec, ctx, next) {
	const base = spec.split('/').pop();
	if (spec.startsWith('./') && stubs[base] && ctx.parentURL?.startsWith(lib)) {
		return { url: 'data:text/javascript,' + encodeURIComponent(stubs[base]), shortCircuit: true };
	}
	return next(spec, ctx);
}
export async function load(url, ctx, next) {
	const file = url.split('?')[0];
	if (file.startsWith(lib) && file.endsWith('.svelte.js')) {
		const mod = await import(compileModule);
		const compile = mod.compileModule ?? mod.default.compileModule;
		const src = readFileSync(fileURLToPath(file), 'utf8');
		return { format: 'module', source: compile(src, { filename: file, generate: 'client' }).js.code, shortCircuit: true };
	}
	return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(HOOKS), {
	data: {
		lib: new URL('./', import.meta.url).href,
		stubs: STUBS,
		compileModule: new URL('file://' + require.resolve('svelte/compiler')).href
	}
});

// ── environment ──
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
let fakeNow = 1_000_000;
performance.now = () => fakeNow;
const realSetTimeout = globalThis.setTimeout;
// The 8-second waits (flush's, exclusive's) shrink when a scenario says so.
let shortWaits = false;
globalThis.setTimeout = (fn, ms, ...a) =>
	ms === 3000 ? 0 : realSetTimeout(fn, shortWaits && ms === 8000 ? 50 : ms, ...a);
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

// ── server ──
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const rows = [];
let serverMicros = Date.parse('2026-10-05T12:00:00Z') * 1000;
// updated_at, as the trigger writes it: microseconds, `+00:00`. Twenty seconds
// apart, so the 30-second overlap holds the newest one or two rows, not all.
const stamp = () => {
	serverMicros += 20_000_000 + Math.floor(Math.random() * 999);
	const ms = Math.floor(serverMicros / 1000), us = String(serverMicros % 1000).padStart(3, '0');
	return new Date(ms).toISOString().replace('Z', '').replace(/(\.\d{3})$/, `$1${us}`) + '+00:00';
};
const micros = (s) => {
	const m = /\.(\d+)/.exec(s);
	const frac = m ? (m[1] + '000000').slice(0, 6) : '000000';
	return Math.floor(Date.parse(s) / 1000) * 1_000_000 + Number(frac);
};
let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
const log = { pulls: [], rpc: [], inserts: 0 };
let insertGate = null; // a promise the next insert waits on
let pullGate = null; // and the next pull
let insertLoseResponse = false;
let rpcRole = 'scout';

function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function filterRows(params) {
	let out = rows.slice();
	for (const [k, v] of params) {
		if (['select', 'order', 'limit', 'or'].includes(k)) continue;
		const [op, ...rest] = v.split('.');
		const val = rest.join('.');
		out = out.filter((r) => {
			const x = r[k];
			if (k === 'updated_at' || k === 'created_at') {
				const a = micros(x), b = micros(val);
				return op === 'eq' ? a === b : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : true;
			}
			return op === 'eq' ? String(x) === val : true;
		});
	}
	const or = params.get('or');
	if (or) {
		const m = /updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."([^"]+)",id\.gt\.([^)]+)\)/.exec(or);
		const t = micros(m[1]), id = m[3];
		out = out.filter((r) => micros(r.updated_at) > t || (micros(r.updated_at) === t && r.id > id));
	}
	out.sort((a, b) => micros(a.updated_at) - micros(b.updated_at) || (a.id < b.id ? -1 : 1));
	const limit = Number(params.get('limit') ?? 1e9);
	return out.slice(0, limit);
}
globalThis.fetch = async (input, init = {}) => {
	const url = new URL(String(input));
	const method = (init.method ?? 'GET').toUpperCase();
	const headers = new Headers(init.headers);
	const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
	const path = url.pathname.replace('/rest/v1/', '');
	const p = url.searchParams;
	if (path === 'events') return json(single ? { id: EVENT_ID } : [{ id: EVENT_ID }]);
	if (path === 'rpc/withdraw_entry') {
		const { p_id } = JSON.parse(init.body);
		log.rpc.push(p_id);
		if (rpcRole !== 'manager') return json({ code: '42501', message: 'permission denied' }, 403);
		const r = rows.find((x) => x.id === p_id);
		if (r) { r.deleted_at = stamp(); r.updated_at = stamp(); }
		return json(null);
	}
	if (path === 'entries' && method === 'POST') {
		const body = JSON.parse(init.body);
		if (insertGate) { const g = insertGate; insertGate = null; await g; }
		const dup = rows.find((r) => r.event_id === body.event_id && r.match_number === body.match_number &&
			r.team_number === body.team_number && r.scout_name === body.scout_name && micros(r.created_at) === micros(body.created_at));
		if (dup) return json({ code: '23505', message: 'duplicate' }, 409);
		const row = { ...body, id: uuid(), updated_at: stamp(), deleted_at: null };
		rows.push(row); log.inserts++;
		if (insertLoseResponse) { insertLoseResponse = false; throw new TypeError('network connection lost'); }
		return json(single ? row : [row], 201);
	}
	if (path === 'entries' && method === 'GET') {
		if (pullGate && !p.has('created_at')) {
			const g = pullGate;
			pullGate = null;
			await g;
		}
		const out = filterRows(p);
		if (!p.has('created_at')) log.pulls.push({ q: url.search, n: out.length });
		if (single) return out.length ? json(out[0]) : json({ code: 'PGRST116', message: '0 rows' }, 406);
		return json(out);
	}
	if (path === 'entries' && method === 'PATCH') {
		const id = p.get('id').slice(3);
		const r = rows.find((x) => x.id === id);
		if (!r) return json([]);
		Object.assign(r, JSON.parse(init.body), { updated_at: stamp() });
		return json([r]);
	}
	throw new Error(`unmocked ${method} ${url}`);
};
const serverInsert = (over = {}) => {
	const row = { id: uuid(), event_id: EVENT_ID, event_code: '2026test', match_number: rows.length + 1, team_number: 3419,
		alliance_color: 'red', scout_name: 'peer', observations: { n: rows.length }, schema_version: 4, client_id: 'peer',
		created_at: new Date().toISOString(), submitted_by: 'p2', updated_at: stamp(), deleted_at: null, ...over };
	rows.push(row); return row;
};

// ── run ──
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
	}
};
const lastPull = () => log.pulls.at(-1);
const libUrl = (f, v = '') => new URL(`./${f}${v}`, import.meta.url).href;
const db = await import(libUrl('db.js'));
let sync = await import(libUrl('sync.svelte.js', '?launch=1'));
await sync.init();

// A. The overlap settles.
for (let i = 0; i < 3; i++) serverInsert();
await sync.setEventCode('2026test');
await sync.flush();
ok('first launch backfills everything', lastPull().n === 3 && !/updated_at=g/.test(lastPull().q), JSON.stringify(lastPull()));
fakeNow += 3000; await sync.flush();
ok('a young watermark re-reads the overlap', lastPull().n >= 1 && lastPull().n < 3, `n=${lastPull().n}`);
fakeNow += 31_000; await sync.flush();
fakeNow += 3000; await sync.flush();
ok('once settled, an idle tick downloads nothing', lastPull().n === 0 && /updated_at=gt\./.test(lastPull().q), JSON.stringify(lastPull()));
fakeNow += 3000; await sync.flush();
ok('and stays at nothing', lastPull().n === 0);
serverInsert();
fakeNow += 3000; await sync.flush();
ok('a new row still arrives', lastPull().n === 1);
ok('and is on the device', (await db.listEntries()).length === 4);
fakeNow += 3000; await sync.flush();
ok('then the overlap opens again for a window', lastPull().n >= 1 && /updated_at=gte\./.test(lastPull().q), JSON.stringify(lastPull()));

// B. A relaunch resumes from where the last one got to.
{
	sync.stop();
	sync = await import(libUrl('sync.svelte.js', '?launch=2'));
	await sync.init();
	await sync.setEventCode('2026test');
	await sync.flush();
	ok('a relaunch does not re-download the event', /updated_at=gte\./.test(lastPull().q) && lastPull().n < 4, JSON.stringify(lastPull()));
	serverInsert({ updated_at: undefined });
	rows.at(-1).updated_at = stamp();
	fakeNow += 3000; await sync.flush();
	ok('and still gets what is new', (await db.listEntries()).length === 5);
}

// C. Clear entries downloads it all again, now and after a relaunch.
{
	await sync.clearLocalEntries();
	ok('cleared', (await db.listEntries()).length === 0);
	sync.resync();
	await sync.flush();
	ok('every row comes back', (await db.listEntries()).length === rows.filter((r) => !r.deleted_at).length);
	sync.stop();
	sync = await import(libUrl('sync.svelte.js', '?launch=3'));
	await sync.init(); await sync.setEventCode('2026test'); await sync.flush();
	ok('and a relaunch after the clear resumes rather than missing them', (await db.listEntries()).length === rows.length);
}

// D. Deleting an entry while its upload is on the wire, as a scout.
{
	const id = await db.addEntry({ eventCode: '2026test', matchNumber: 90, teamNumber: 254, allianceColor: 'blue', scoutName: 'ning', observations: {} });
	const asRendered = await db.getEntry(id); // the page's copy: no remoteId
	let release; insertGate = new Promise((r) => (release = r));
	fakeNow += 3000;
	const ticking = sync.flush();
	await new Promise((r) => realSetTimeout(r, 20)); // the insert is now waiting on the server
	const deleting = sync.withdrawEntry(asRendered);
	await new Promise((r) => realSetTimeout(r, 20));
	release();
	const res = await deleting; await ticking;
	ok('the delete is refused rather than half-done, and says why', res.ok === false && /finished uploading/.test(res.message), JSON.stringify(res));
	const local = await db.getEntry(id);
	ok('the entry is still on this device', Boolean(local?.remoteId));
	fakeNow += 3000; await sync.flush();
	const onServer = rows.filter((r) => r.match_number === 90 && !r.deleted_at).length;
	const here = (await db.listEntries()).filter((e) => e.matchNumber === 90).length;
	ok('device and server agree', onServer === 1 && here === 1, `server ${onServer}, device ${here}`);
}

// E. Deleting after an insert whose answer was lost, as a manager.
{
	rpcRole = 'manager';
	const id = await db.addEntry({ eventCode: '2026test', matchNumber: 91, teamNumber: 1678, allianceColor: 'red', scoutName: 'ning', observations: {} });
	insertLoseResponse = true;
	fakeNow += 3000; await sync.flush();
	const asRendered = await db.getEntry(id);
	ok('precondition: the server has it, the device thinks not', !asRendered.remoteId && rows.some((r) => r.match_number === 91));
	const res = await sync.withdrawEntry(asRendered);
	ok('the delete succeeds', res.ok === true, JSON.stringify(res));
	ok('it went to the server', rows.find((r) => r.match_number === 91)?.deleted_at != null);
	fakeNow += 3000; await sync.flush();
	fakeNow += 3000; await sync.flush();
	ok('and it does not come back', !(await db.listEntries()).some((e) => e.matchNumber === 91));
}

// F. An upload that hangs past the wait. The delete says so instead of
// deleting under it — and so does a retry, after the first wait has given up.
{
	rpcRole = 'scout';
	shortWaits = true;
	const id = await db.addEntry({ eventCode: '2026test', matchNumber: 92, teamNumber: 971, allianceColor: 'blue', scoutName: 'ning', observations: {} });
	const asRendered = await db.getEntry(id);
	let release;
	insertGate = new Promise((r) => (release = r));
	fakeNow += 3000;
	await sync.flush(); // gives up after the short wait; the tick stays on the wire
	const first = await sync.withdrawEntry(asRendered);
	ok('a delete behind a hung upload says so', first.ok === false && /uploading right now/.test(first.message), JSON.stringify(first));
	await sleep(20);
	const second = await sync.withdrawEntry(asRendered);
	ok('a retry still waits rather than deleting under it',
		second.ok === false && /uploading right now/.test(second.message), JSON.stringify(second));
	ok('the entry is still here', Boolean(await db.getEntry(id)));
	shortWaits = false;
	release();
	for (let i = 0; i < 100 && !(await db.getEntry(id))?.remoteId; i++) await sleep(10);
	const third = await sync.withdrawEntry(asRendered);
	ok('once it lands, the delete sees that it did', third.ok === false && /finished uploading/.test(third.message), JSON.stringify(third));
}

// G. "Sync now" pressed while a pull is on the wire. The pull it interrupts
// must not record its position over the reset, or the backfill never happens.
{
	fakeNow += 3000;
	await sync.flush();
	// Rows this device is missing — the reason anyone presses Sync now.
	const old = (await db.listEntries()).filter((e) => e.remoteId).slice(-3);
	for (const e of old) await db.deleteEntry(e.id);
	let release;
	pullGate = new Promise((r) => (release = r));
	fakeNow += 3000;
	const ticking = sync.flush();
	await sleep(20);
	sync.resync();
	release();
	await ticking;
	fakeNow += 3000;
	await sync.flush();
	const here = new Set((await db.listEntries()).map((e) => e.remoteId));
	ok('Sync now mid-pull still backfills', old.every((e) => here.has(e.remoteId)),
		`${old.filter((e) => here.has(e.remoteId)).length} of ${old.length} back`);
}

console.log(fail === 0 ? `sync: ${pass} passed` : `sync: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
