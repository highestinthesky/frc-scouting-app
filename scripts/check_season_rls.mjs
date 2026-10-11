// Real Postgres checks. All DDL, fixtures and mutations are rolled back.
// npm run test:season-rls -- --migration supabase/migrations/0032_season_management.sql
// Set SUPABASE_DB_URL, or explicitly pass --connection-file for a private URI file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const migrationPath = process.argv.includes('--migration') ? option('--migration')
	: new URL('../supabase/migrations/0032_season_management.sql',import.meta.url);
const migrationSql = readFileSync(migrationPath,'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const announcementPath = process.argv.includes('--announcement-migration') ? option('--announcement-migration')
	: new URL('../supabase/migrations/0033_developer_season_announcements.sql',import.meta.url);
const announcementSql = readFileSync(announcementPath,'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
let uri = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (process.argv.includes('--connection-file')) {
	const contents = readFileSync(option('--connection-file'), 'utf8');
	uri = [...contents.matchAll(/postgresql:\/\/[^\s`]+/g)].map((m) => m[0])
		.find((u) => u.includes('.pooler.supabase.com:5432'));
	assert.ok(uri, 'No session pooler URI found in the specified private file.');
}
const db = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 8000,
	...(uri.includes('supabase.com') ? {ssl:{rejectUnauthorized:false}} : {}) });
const sql = async (text, params = []) => (await db.query(text, params)).rows;
let checks = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); checks++; }
async function as(user, query, params = []) {
	await sql('SAVEPOINT actor');
	try {
		await sql(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`);
		await sql("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub:user?.id,role:user?'authenticated':'anon'})]);
		return await sql(query, params);
	} finally { await sql('ROLLBACK TO SAVEPOINT actor'); await sql('RELEASE SAVEPOINT actor'); }
}
async function denied(user, query, params = []) {
	await assert.rejects(as(user, query, params), (e) => e.code === '42501'); checks++;
}
async function makeUser(role) {
	const id = randomUUID(), username = `season-${id.slice(0,8)}`;
	await sql('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,`${username}@scout.invalid`]);
	await sql('INSERT INTO public.profiles(id,username,first_name,last_name,role) VALUES($1,$2,\'Season\',\'Check\',$3)',[id,username,role]);
	return {id};
}
async function event(year) {
	const id = randomUUID(), code = `${year}check-${id.slice(0,8)}`;
	await sql('INSERT INTO public.events(id,code,name) VALUES($1,$2,\'Season check\')',[id,code]);
	return {id,code};
}
const insert = `INSERT INTO public.entries(event_id,event_code,match_number,team_number,alliance_color,scout_name,observations,schema_version,created_at)
 VALUES($1,$2,1,3419,'red','Season check','{}',1,now()) RETURNING id`;
// Match 1 already has a persisted fixture by the time release checks run.
const releaseInsert = `INSERT INTO public.entries(event_id,event_code,match_number,team_number,alliance_color,scout_name,observations,schema_version,created_at)
 VALUES($1,$2,2,3419,'red','Season check','{}',1,now()) RETURNING id`;

await db.connect();
try {
	await sql('BEGIN');
	await sql("SET LOCAL lock_timeout = '3s'");
	await sql("SET LOCAL statement_timeout = '15s'");
	const beforeColumns = await sql("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='entries' ORDER BY ordinal_position");
	const old = await event(2025), current = await event(2026), other = await event(2027);
	const scout = await makeUser('scout'), manager = await makeUser('manager'), superUser = await makeUser('super');
	await sql('INSERT INTO public.event_scouts(event_id,profile_id) VALUES($1,$2),($1,$3),($4,$2)',[current.id,scout.id,manager.id,other.id]);
	await sql('INSERT INTO public.entry_drafts(profile_id,event_id,slot,payload,saved_at) VALUES($1,$2,\'new\',\'{}\',1)',[scout.id,old.id]);
	await sql('INSERT INTO public.picklist(event_id,event_code,team_number,rank) VALUES($1,$2,3419,1)',[old.id,old.code]);
	await sql(migrationSql);
	equal((await sql('SELECT active_year,announced FROM public.season_settings WHERE id=true'))[0],{active_year:2026,announced:false});
	equal(await sql('SELECT id FROM public.events WHERE id=$1',[old.id]),[]);
	equal(await sql('SELECT event_id FROM public.entry_drafts WHERE event_id=$1',[old.id]),[]);
	equal(await sql('SELECT event_id FROM public.picklist WHERE event_id=$1',[old.id]),[]);
	equal((await sql('SELECT count(*)::int AS n FROM public.events WHERE id=ANY($1)',[[current.id,other.id]]))[0].n,2);
	equal(await sql("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='entries' ORDER BY ordinal_position"),beforeColumns);
	await denied(null,'SELECT * FROM public.season_settings');
	for (const user of [scout,manager]) {
		equal((await as(user,'SELECT active_year FROM public.season_settings'))[0].active_year,2026);
		equal(await as(user,'UPDATE public.season_settings SET announced=true WHERE id=true RETURNING active_year'),[]);
	}
	await denied(scout,insert,[current.id,current.code]);
	await denied(superUser,'INSERT INTO public.season_settings(id,active_year,announced) VALUES(true,2026,true)');
	await denied(superUser,'DELETE FROM public.season_settings');
	// as() rolls changes back so both permission and persisted trigger behaviour
	// are exercised in one request via RETURNING.
	equal((await as(superUser,'UPDATE public.season_settings SET active_year=2027,announced=true WHERE id=true RETURNING active_year,announced'))[0],{active_year:2027,announced:false});
	equal((await as(superUser,'UPDATE public.season_settings SET announced=true WHERE id=true RETURNING announced'))[0].announced,true);
	await sql('UPDATE public.season_settings SET announced=true WHERE id=true');
	equal((await as(scout,insert,[current.id,current.code])).length,1);
	await denied(scout,insert,[other.id,other.code]);
	await sql('UPDATE public.season_settings SET active_year=2027 WHERE id=true');
	await sql('UPDATE public.season_settings SET announced=true WHERE id=true');
	await denied(scout,insert,[current.id,current.code]);
	equal((await as(scout,insert,[other.id,other.code])).length,1);
	await sql('UPDATE public.season_settings SET active_year=2026 WHERE id=true');
	await sql('UPDATE public.season_settings SET announced=true WHERE id=true');
	const [{id:entryId}] = await sql(insert,[current.id,current.code]);
	await sql('UPDATE public.entries SET submitted_by=$1 WHERE id=$2',[scout.id,entryId]);
	equal((await as(scout,'UPDATE public.entries SET observations=\'{"autoScored":2}\' WHERE id=$1 RETURNING id',[entryId])).length,1);
	await sql('UPDATE public.season_settings SET announced=false WHERE id=true');
	await denied(scout,'UPDATE public.entries SET observations=\'{"autoScored":3}\' WHERE id=$1',[entryId]);
	await denied(manager,'SELECT public.correct_entry_track($1,\'{"v":2}\')',[entryId]);
	await denied(manager,'SELECT public.withdraw_entry($1,false)',[entryId]);
	await denied(manager,'SELECT public.withdraw_entry($1,true)',[entryId]);
	await denied(manager,"SELECT public.create_event('2025stale-check','Old event')");
	equal((await as(manager,"SELECT public.create_event($1,'Current event') AS id",[`2026new-${randomUUID().slice(0,8)}`])).length,1);
	{
		// Idempotency must preserve a super's later choice.
		await sql('UPDATE public.season_settings SET active_year=2027 WHERE id=true');
		await sql(migrationSql);
		equal((await sql('SELECT active_year,announced FROM public.season_settings'))[0],{active_year:2027,announced:false});
	}
	// Announcement status is a developer release decision. The application can
	// select a season, but no account (including a super) can override its status.
	await sql(announcementSql);
	equal((await sql('UPDATE public.season_settings SET active_year=2026 WHERE id=true RETURNING active_year,announced'))[0],
		{active_year:2026,announced:true});
	for (const user of [scout,manager,superUser]) {
		await denied(user,'UPDATE public.season_settings SET announced=false WHERE id=true');
		await denied(user,'UPDATE public.season_settings SET announced=true WHERE id=true');
	}
	for (const user of [scout,manager]) {
		equal(await as(user,'UPDATE public.season_settings SET active_year=2027 WHERE id=true RETURNING active_year'),[]);
	}
	equal((await as(superUser,'UPDATE public.season_settings SET active_year=2027 WHERE id=true RETURNING active_year,announced'))[0],
		{active_year:2027,announced:false});
	equal((await as(superUser,'UPDATE public.season_settings SET active_year=2026 WHERE id=true RETURNING active_year,announced'))[0],
		{active_year:2026,announced:true});
	equal((await as(superUser,'UPDATE public.season_settings SET active_year=2030 WHERE id=true RETURNING announced'))[0].announced,false);
	equal((await as(scout,releaseInsert,[current.id,current.code])).length,1);
	await sql('UPDATE public.season_settings SET active_year=2027 WHERE id=true');
	await denied(scout,releaseInsert,[other.id,other.code]);
	await sql('UPDATE public.season_settings SET active_year=2026 WHERE id=true');
	equal((await as(scout,releaseInsert,[current.id,current.code])).length,1);
	// A future developer release stays announced across subsequent selections.
	await sql(`CREATE OR REPLACE FUNCTION public.season_is_announced(p_year integer) RETURNS boolean
	 LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT coalesce(p_year IN (2026,2027),false); $$`);
	await sql('UPDATE public.season_settings SET active_year=2027 WHERE id=true');
	equal((await sql('SELECT announced FROM public.season_settings WHERE id=true'))[0].announced,true);
	equal((await as(scout,releaseInsert,[other.id,other.code])).length,1);
	await sql('UPDATE public.season_settings SET active_year=2026 WHERE id=true');
	await sql('UPDATE public.season_settings SET active_year=2027 WHERE id=true');
	equal((await sql('SELECT announced FROM public.season_settings WHERE id=true'))[0].announced,true);
	await sql(announcementSql);
	equal((await sql('SELECT active_year,announced FROM public.season_settings WHERE id=true'))[0],{active_year:2027,announced:false});
	console.log(`${checks} season database checks passed; transaction rolled back.`);
} finally { await db.query('ROLLBACK'); await db.end(); }
