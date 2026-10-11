// Compile the real store; hold its IndexedDB read across a season closure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { compileModule } = require('svelte/compiler');
const source = readFileSync(new URL('./event-data.svelte.js', import.meta.url),'utf8')
	.replace(/^import .*;\n/gm,'');
const harness = `
import { buildEntryIndex, scheduleRollup } from ${JSON.stringify(new URL('./coverage.js',import.meta.url).href)};
import { editorRows } from ${JSON.stringify(new URL('./plan-state.js',import.meta.url).href)};
let entryRead = async () => [];
export const setEntryRead = (fn) => { entryRead = fn; };
const listEntries = () => entryRead();
const session = { tbaEventKey:'' }, auth = { signedIn:false };
const getCachedSchedule = async () => null, getPublishedTbaEventKey = async () => null;
const qualMatches = (m) => m;
const listAssignments = async () => [], listOverrides = async () => [];
const listReminders = async () => [], listMyEvents = async () => [], eventRoster = async () => [];
${source}`;
const code = compileModule(harness,{filename:'event-data-test.svelte.js',generate:'client'}).js.code
	.replaceAll("'svelte/internal/client'",JSON.stringify(import.meta.resolve('svelte/internal/client')));
const {eventData,setEntryRead} = await import('data:text/javascript,' + encodeURIComponent(code));
await eventData.load('2026test');
let release;
setEntryRead(() => new Promise(r => { release = r; }));
const oldRead = eventData.refreshEntries();
await eventData.load('2026test',{includeEntries:false});
release([{eventCode:'2026test',scoutName:'Scout',matchNumber:1,teamNumber:3419}]);
await oldRead;
assert.deepEqual(eventData.entries,[],'a read begun before closure must not restore activity');
let reads = 0;
setEntryRead(async () => {reads++;return [];});
await eventData.refreshEntries();
assert.equal(reads,0,'closed planning must not read entries');
console.log('2 event-data closure checks passed');
