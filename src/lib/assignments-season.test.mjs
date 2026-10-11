// Hold real assignment pull responses while the device switches season/account.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('./assignments.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'')
	.replace("'./auto-assign.js'",JSON.stringify(new URL('./auto-assign.js',import.meta.url).href));
const harness = `
import {rowScout,sameScout} from ${JSON.stringify(new URL('./scout-identity.js',import.meta.url).href)};
const assignmentRows = () => [], overrideRows = () => [];
export const session = {eventCode:'2026test',assignedTeams:[],overrides:[],async update(p){Object.assign(this,p);}};
export const auth = {userId:'account-a'};
export const held = [];
const eventIdForCode = async () => 'event-id';
const createSupabaseClient = () => ({from(table){
 const q={select(){return q;},eq(){return q;},order(){return q;},
 then(resolve){held.push({table,resolve});}};return q;
}});
${source}`;
const {session,auth,held,pullAndApplyForScout}=await import('data:text/javascript,'+encodeURIComponent(harness));
for (const change of ['season','account']) {
	session.eventCode='2026test';session.assignedTeams=[];session.overrides=[];auth.userId='account-a';
	const pulling=pullAndApplyForScout('2026test',{profileId:'account-a',key:'scout',label:'Scout'});
	await new Promise(r=>setTimeout(r,0));
	if(change==='season')session.eventCode='';else auth.userId='account-b';
	for(const {table,resolve} of held.splice(0)) resolve({data:[{id:'old',scout_name:'Scout',profile_id:'account-a',team_number:3419,match_number:1}],error:null});
	await pulling;
	assert.deepEqual(session.assignedTeams,[],`${change} change must not restore old assignments`);
	assert.deepEqual(session.overrides,[],`${change} change must not restore old overrides`);
}
console.log('4 assignment season/account checks passed');
