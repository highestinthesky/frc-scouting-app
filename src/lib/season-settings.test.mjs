import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { register, createRequire } from 'node:module';
import 'fake-indexeddb/auto';
const require = createRequire(import.meta.url);
register('data:text/javascript,' + encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
let compiler;
export function initialize(data) { compiler = data.compiler; }
export async function load(url, ctx, next) {
 if (url.endsWith('.svelte.js')) {
  const mod = await import(compiler);
  const compileModule = mod.compileModule ?? mod.default.compileModule;
  return {format:'module', source:compileModule(readFileSync(fileURLToPath(url),'utf8'),
   {filename:url,generate:'client'}).js.code, shortCircuit:true};
 }
 return next(url,ctx);
}`), {data:{compiler:new URL('file://' + require.resolve('svelte/compiler')).href}});
globalThis.CustomEvent ??= class extends Event {
	constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
};
const { db, setSetting, getSetting } = await import('./db.js');
let reply = { active_year:2026, announced:false };
let fail = false;
let held = null;
let patches = [];
globalThis.fetch = async (url, options = {}) => {
	assert.ok(String(url).includes('/rest/v1/season_settings'), 'unexpected server request');
	if (held) { const h = held; held = null; return await h; }
	if (fail) return new Response(JSON.stringify({message:'Unavailable'}), {status:503});
	if (options.method === 'PATCH') {
		const patch = JSON.parse(options.body);
		patches.push(patch);
		if (Object.hasOwn(patch, 'announced')) {
			return new Response(JSON.stringify({message:'Announcement status is developer-controlled'}), {status:403});
		}
		reply = {...patch, announced:patch.active_year === 2026};
	}
	return new Response(JSON.stringify(reply), {status:200,headers:{'Content-Type':'application/json'}});
};
const module = await import('./season-settings.svelte.js').catch((e) => {
	if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
	return {};
});
const store = module.seasonSettings;
after(async () => { store?.stop(); await db.delete(); });
const exists = () => assert.ok(store, 'shared season store is missing');

test('an uncached device stays closed when the server cannot answer', async () => {
	exists(); fail = true;
	await store.start('account-a');
	assert.equal(store.open, false);
	assert.equal(store.value.active_year, 2026);
	assert.ok(store.error);
	store.stop();
});

test('offline startup retains the last successful setting', async () => {
	exists();
	await setSetting('seasonSettings',{active_year:2026,announced:true});
	fail = true;
	await store.start('account-a');
	assert.equal(store.open, true);
	assert.equal(store.value.active_year, 2026);
	store.stop();
});

test('choosing a past season restores its developer-controlled announcement', async () => {
	exists(); fail = false; reply = {active_year:2026,announced:true};
	await store.start('account-a');
	assert.equal(store.open, true);
	await store.update(2027);
	assert.equal(store.open, false);
	assert.deepEqual(await getSetting('seasonSettings'), {active_year:2027,announced:false});
	await store.update(2026);
	assert.equal(store.open, true);
	assert.deepEqual(await getSetting('seasonSettings'), {active_year:2026,announced:true});
	store.stop();
});

test('season selection cannot send an announcement override to the server', async () => {
	exists(); fail = false; reply = {active_year:2026,announced:true}; patches = [];
	await store.start('account-a');
	await store.update(2027, true);
	assert.deepEqual(patches, [{active_year:2027}]);
	assert.equal(store.value.announced, false);
	await store.update(2026, false);
	assert.deepEqual(patches.at(-1), {active_year:2026});
	assert.equal(store.open, true);
	store.stop();
});

test('invalid season choices never reach the server', async () => {
	exists(); fail = false; patches = [];
	await store.start('account-a');
	for (const year of [1999, 1991, 10000, 2026.5, 'invalid']) {
		await assert.rejects(store.update(year), /valid season/i);
	}
	assert.deepEqual(patches, []);
	store.stop();
});

test('a response from an old account cannot undo the new account setting', async () => {
	exists(); fail = false;
	let release;
	held = new Promise(r => release = r);
	const old = store.start('account-a');
	await new Promise(r => setTimeout(r,20));
	reply = {active_year:2027,announced:false};
	await store.start('account-b');
	release(new Response(JSON.stringify({active_year:2026,announced:true}),
		{status:200,headers:{'Content-Type':'application/json'}}));
	await old;
	assert.deepEqual(store.value, {active_year:2027,announced:false});
	assert.equal(store.open, false);
	store.stop();
});
