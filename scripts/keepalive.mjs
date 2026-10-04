// Keeps the Supabase project from being paused for inactivity.
//
//   node scripts/keepalive.mjs
//
// Run on a schedule by .github/workflows/keepalive.yml. A free-tier project is
// paused after a week with no activity, and the offseason is exactly a week
// with no activity — nobody notices until the first scout of the next season
// opens the app and every sync fails.
//
// It makes one PostgREST request as anon. Since 0020 anon can reach nothing, so
// the answer a live database gives is `401` with Postgres's own `42501`
// (permission denied): the request was parsed, planned and refused BY POSTGRES,
// which is the round trip that counts. A `200` is accepted too, so a future
// grant does not turn this red. Anything else — a paused project, a gateway
// error, a network failure — exits non-zero, so a red run is the warning.
//
// It reads no secret. The URL and anon key are the public ones the bundle
// ships, read out of src/lib/supabase.js rather than copied, so there is one
// place they live. SUPABASE_URL / SUPABASE_ANON_KEY override them.

import { readFileSync } from 'node:fs';

const TABLE = 'events';

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

const endpoint = `${url}/rest/v1/${TABLE}?select=id&limit=1`;
let res;
try {
	res = await fetch(endpoint, {
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

const refusedByPostgres = (res.status === 401 || res.status === 403) && body?.code === '42501';
if (res.ok || refusedByPostgres) {
	console.log(`keepalive: ${url} answered ${res.status}${body?.code ? ` (${body.code})` : ''} — database is up`);
} else {
	console.error(`keepalive: ${url} answered ${res.status} — ${text.slice(0, 300)}`);
	process.exit(1);
}
