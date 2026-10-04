// Keeps the Supabase project from being paused for inactivity.
//
//   node scripts/keepalive.mjs
//
// Run on a schedule by .github/workflows/keepalive.yml. A free-tier project is
// paused after a week with no activity, and the offseason is exactly a week
// with no activity — nobody notices until the first scout of the next season
// opens the app and every sync fails.
//
// It calls `public.keepalive()` (0027) as anon: a query that succeeds and reads
// nothing. A database that does not have the function yet answers PGRST202, and
// then the ping falls back to the pre-0027 probe — reading `events`, which anon
// cannot, and accepting Postgres's own 42501 as proof the database parsed and
// refused it. The fallback is what lets this script ship before the migration is
// on production, so the two halves cannot be pushed in the wrong order.
//
// Anything else — a paused project, a bad key, a gateway error, a network
// failure — exits non-zero, so a red run is the warning.
//
// It reads no secret. The URL and anon key are the public ones the bundle
// ships, read out of src/lib/supabase.js rather than copied, so there is one
// place they live. SUPABASE_URL / SUPABASE_ANON_KEY override them.

import { readFileSync } from 'node:fs';

function shippedConfig() {
	const src = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
	const url = src.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)?.[1];
	const key = src.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)?.[1];
	return { url, key };
}

const shipped = shippedConfig();
const url = process.env.SUPABASE_URL || shipped.url;
const key = process.env.SUPABASE_ANON_KEY || shipped.key;
if (!url || !key) {
	console.error('keepalive: could not find the Supabase URL and anon key in src/lib/supabase.js');
	process.exit(1);
}

async function get(path) {
	let res;
	try {
		res = await fetch(`${url}${path}`, {
			headers: { apikey: key, Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(30_000)
		});
	} catch (err) {
		console.error(`keepalive: ${url} unreachable — ${err.message}`);
		process.exit(1);
	}
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		// A paused project or a gateway error answers in HTML or plain text.
	}
	return { status: res.status, text, body };
}

function fail({ status, text }) {
	console.error(`keepalive: ${url} answered ${status} — ${text.slice(0, 300)}`);
	process.exit(1);
}

const rpc = await get('/rest/v1/rpc/keepalive');
if (rpc.status === 200 && rpc.body === true) {
	console.log(`keepalive: ${url} answered keepalive() — database is up`);
	process.exit(0);
}
if (rpc.body?.code !== 'PGRST202') fail(rpc);

const probe = await get('/rest/v1/events?select=id&limit=1');
const refusedByPostgres = (probe.status === 401 || probe.status === 403) && probe.body?.code === '42501';
if (probe.status === 200 || refusedByPostgres) {
	console.log(
		`keepalive: ${url} answered ${probe.status}${probe.body?.code ? ` (${probe.body.code})` : ''} — database is up (0027 not applied yet)`
	);
} else {
	fail(probe);
}
