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
// nothing. Anything else — a paused project, a bad key, a gateway error, a
// network failure, the function missing — exits non-zero, so a red run is the
// warning.
//
// There used to be a fallback: on PGRST202 (no such function) it read `events`
// and took Postgres's 42501 refusal as proof of life, so the script could ship
// before 0027 reached production. 0027 has been on production since
// 2026-10-04, and from then on a missing keepalive() means something removed
// it. Falling back would report that as a healthy run.
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
} else {
	fail(rpc);
}
