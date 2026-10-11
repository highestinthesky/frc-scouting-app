import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import 'fake-indexeddb/auto';

globalThis.CustomEvent ??= class extends Event {
	constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
};
const rules = await import('./season-rules.js').catch((e) => {
	if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
	return {};
});
const local = await import('./db.js');
const { db } = local;
after(async () => { await db.delete(); });

test('only the active year contributes to a season collection', () => {
	assert.equal(typeof rules.seasonEntries, 'function', 'season scoping is missing');
	const rows = [{eventCode:'2025test'}, {eventCode:'2026test'}, {eventCode:'scrimmage'}];
	assert.deepEqual(rules.seasonEntries(rows, 2026), [rows[1]]);
	assert.deepEqual(rules.seasonEntries(rows, null), []);
});

test('unannounced or unavailable games stay closed', () => {
	assert.equal(typeof rules.seasonIsOpen, 'function', 'announcement gate is missing');
	assert.equal(rules.SEASON_WAITING_MESSAGE, 'Check back later after the season is announced.');
	assert.equal(rules.seasonIsOpen({active_year:2026,announced:false}, [2026]), false);
	assert.equal(rules.seasonIsOpen(null, [2026]), false);
	assert.equal(rules.seasonIsOpen({active_year:2027,announced:true}, [2026]), false);
	assert.equal(rules.seasonIsOpen({active_year:1999,announced:true}, [1999,2026]), false);
	assert.equal(rules.seasonIsOpen({active_year:2026,announced:true}, [2026]), true);
});

test('direct scouting and analysis links obey the same gate while setup remains available', () => {
	assert.equal(typeof rules.seasonRoute, 'function', 'route gate is missing');
	for (const route of ['/home/','/scouting/new/','/scouting/edit/','/practice/',
		'/studio/run/scouts/','/studio/review/','/studio/pick/compare/',
		'/studio/2025test/team/3419/','/studio/2026test/q1/','/insights/compare/']) {
		assert.equal(rules.seasonRoute(route, ''), true, route);
		assert.equal(rules.seasonRoute(`/scout${route}`, '/scout'), true, route);
	}
	for (const route of ['/','/register/','/settings/','/studio/accounts/',
		'/studio/plan/event/','/studio/plan/people/','/studio/schedule/']) {
		assert.equal(rules.seasonRoute(route, ''), false, route);
	}
});

test('a cleared or changed event drops stale event settings', async () => {
	const { resetForEventChange } = await import('./event-rules.js');
	assert.deepEqual(resetForEventChange('2025test', ''), {
		tbaEventKey:'',assignedTeams:[],overrides:[]
	});
});

test('a form can save only to the event, season and account it opened for', () => {
	assert.equal(typeof rules.recordingAllowed, 'function', 'form context guard is missing');
	const context = {eventCode:'2026test',year:2026,owner:'a'};
	const open = {active_year:2026,announced:true};
	assert.equal(rules.recordingAllowed(context,open,'2026test','a',[2026]),true);
	assert.equal(rules.recordingAllowed(context,open,'2026other','a',[2026]),false);
	assert.equal(rules.recordingAllowed(context,open,'2026test','b',[2026]),false);
	assert.equal(rules.recordingAllowed(context,{active_year:2027,announced:true},'2027test','a',[2026,2027]),false);
	assert.equal(rules.recordingAllowed(context,{...open,announced:false},'2026test','a',[2026]),false);
});

test('2025 cleanup removes queued entries and event caches without deleting other years or identity', async () => {
	assert.equal(typeof local.purgeSeasonData, 'function', 'scoped local cleanup is missing');
	await db.entries.clear();
	await db.settings.clear();
	await db.picklist.clear();
	await db.entries.bulkAdd([
		{eventCode:'2025test',teamNumber:3419,remoteId:null},
		{eventCode:'2026test',teamNumber:3419,remoteId:null}
	]);
	await db.picklist.bulkAdd([
		{key:'2025test:3419',eventCode:'2025test',teamNumber:3419},
		{key:'2026test:3419',eventCode:'2026test',teamNumber:3419}
	]);
	await db.settings.bulkPut([
		{key:'eventCode',value:'2025test'}, {key:'assignedTeams',value:[3419]},
		{key:'overrides',value:[{match_number:1}]}, {key:'tbaEventKey',value:'2025test'},
		{key:'tba-schedule:2025test',value:{matches:[1]}},
		{key:'statbotics:team_year:3419:2025',value:{epa:123}},
		{key:'statbotics:team_year:3419:2026',value:{epa:456}},
		{key:'picklist:weights:2025test',value:{autoScored:1}},
		{key:'picklist:migrated:2025test',value:true},
		{key:'tba-schedule:2026test',value:{matches:[2]}},
		{key:'draft:entry:2025test:owner',value:{drafts:{new:{values:{comments:'old'}}}}},
		{key:'draft:entry:2026test:owner',value:{drafts:{new:{values:{comments:'keep'}}}}},
		{key:'dismissedReminders:owner',value:{old:{e:'2025test'},keep:{e:'2026test'}}},
		{key:'scoutName',value:'Scout'}, {key:'tbaApiKey',value:'keep-this-key'}
	]);
	await local.purgeSeasonData(2025);
	assert.deepEqual((await db.entries.toArray()).map(e=>e.eventCode), ['2026test']);
	assert.deepEqual((await db.picklist.toArray()).map(e=>e.eventCode), ['2026test']);
	assert.equal(await local.getSetting('tba-schedule:2025test'), undefined);
	assert.equal(await local.getSetting('statbotics:team_year:3419:2025'), undefined);
	assert.deepEqual(await local.getSetting('statbotics:team_year:3419:2026'), {epa:456});
	assert.equal(await local.getSetting('draft:entry:2025test:owner'), undefined);
	assert.equal(await local.getSetting('picklist:weights:2025test'), undefined);
	assert.equal(await local.getSetting('picklist:migrated:2025test'), undefined);
	assert.deepEqual(await local.getSetting('dismissedReminders:owner'), {keep:{e:'2026test'}});
	assert.deepEqual(await local.getSetting('assignedTeams'), []);
	assert.equal(await local.getSetting('eventCode'), '');
	assert.equal(await local.getSetting('scoutName'), 'Scout');
	assert.equal(await local.getSetting('tbaApiKey'), 'keep-this-key');
	assert.ok(await local.getSetting('tba-schedule:2026test'));
	assert.ok(await local.getSetting('draft:entry:2026test:owner'));
	await local.purgeSeasonData(2025);
	assert.equal(await db.entries.count(), 1);
});

test('suggested paths and notes do not include another season', async () => {
	await db.entries.clear();
	await db.entries.bulkAdd([
		{eventCode:'2025test',teamNumber:3419,createdAt:'2025-03-01T00:00:00Z',observations:{autoScored:20,autoPathing:'Old path',strengths:'Old strength'}},
		{eventCode:'2026test',teamNumber:3419,createdAt:'2026-03-01T00:00:00Z',observations:{autoScored:2,autoPathing:'New path',strengths:'New strength'}}
	]);
	assert.deepEqual(await local.getDistinctObservationValuesForTeam('autoPathing',3419,{season:2026}),['New path']);
	assert.deepEqual(await local.getMostUsedObservationValuesForTeam('strengths',3419,6,{season:2026}),[{value:'New strength',count:1}]);
	assert.deepEqual(await local.getDistinctObservationValuesForTeam('autoPathing',3419,{eventCode:''}),[]);
});

test('a current event cannot keep or fetch a previous season TBA source', async () => {
	await local.setSetting('eventCode','2026test');
	await local.setSetting('tbaEventKey','2025nyny');
	await local.purgeSeasonData(2025);
	assert.equal(await local.getSetting('tbaEventKey'),'');
	const {fetchAndCacheSchedule,fetchAndCacheAlliances,getCachedSchedule} = await import('./tba.js');
	let fetches = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { fetches++;return new Response('[]'); };
	try {
		await assert.rejects(fetchAndCacheSchedule('2026test','test-key','2025nyny'), /same season/i);
		await assert.rejects(fetchAndCacheAlliances('2026test','test-key','2025nyny'), /same season/i);
		assert.equal(fetches,0);
		await local.setSetting('tba-schedule:2026test',{matches:[{event_key:'2025nyny'}]});
		assert.equal(await getCachedSchedule('2026test'),null);
	} finally {globalThis.fetch = originalFetch;}
});

test('a blank event cannot widen an analysis scope to all cached entries', async () => {
	const { summarize } = await import('./aggregate.js');
	const current = await summarize({eventCode:'2026test'});
	assert.equal(current.totalEntries,1);
	assert.equal(current.teams[0].metrics.autoScored.mean,2);
	const blank = await summarize({eventCode:'',season:2026});
	assert.equal(blank.totalEntries,0);
});

test('CSV contains only the selected current-season event', async () => {
	const { exportToCsv } = await import('./csv.js');
	let blob;
	URL.createObjectURL = value => { blob = value; return 'blob:test'; };
	URL.revokeObjectURL = () => {};
	globalThis.document = {createElement:()=>({click(){}}),body:{appendChild(){},removeChild(){}}};
	const exported = await exportToCsv({eventCode:'2026test'});
	assert.equal(exported.count,1);
	assert.equal((await blob.text()).includes('2025test'),false);
	assert.equal((await exportToCsv({eventCode:''})).count,0);
});
