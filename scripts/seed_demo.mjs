// Put enough in the local stack to actually look at the app.
//
//   supabase start && node scripts/seed_demo.mjs
//
// ─── why this exists ───────────────────────────────────────────────────────
//
// `supabase db reset` wipes auth.users along with everything else, so after
// every migration change the app has no account to sign in as, no event to
// record against, and nothing to render. Without this you are looking at empty
// states and cannot tell a working page from a broken one.
//
// It was rebuilt ad hoc four times in one session before someone noticed it
// should be a file.
//
// Safe by construction: it talks to the URL `supabase status` reports, which is
// always the local stack. It cannot reach production.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import pg from 'pg';

const stack = (() => {
	try {
		return JSON.parse(execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		return null;
	}
})();

if (!stack?.DB_URL) {
	console.error('No local stack. Run `supabase start` first.');
	process.exit(1);
}

const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
	auth: { persistSession: false }
});
const db = new pg.Client({ connectionString: stack.DB_URL });
await db.connect();

/** Create an auth user + profile, or reuse one that survived. */
async function person(email, username, first, last, role) {
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password: 'demo-password',
		email_confirm: true
	});
	let id = data?.user?.id;
	if (error) {
		if (!/already/i.test(error.message)) throw error;
		const { data: list } = await admin.auth.admin.listUsers();
		id = list.users.find((u) => u.email === email)?.id;
	}
	await db.query(
		`insert into public.profiles (id, username, first_name, last_name, role)
		 values ($1, $2, $3, $4, $5::app_role) on conflict (id) do nothing`,
		[id, username, first, last, role]
	);
	return id;
}

const boss = await person('boss@demo.invalid', 'boss', 'Casey', 'Boss', 'manager');
const ada = await person('ada@demo.invalid', 'ada', 'Ada', 'Lovelace', 'scout');
const rey = await person('rey@demo.invalid', 'rey', 'Rey', 'Ortiz', 'scout');

const { rows } = await db.query(
	`insert into public.events (code, name, created_by)
	 values ('2026onsum', 'Ontario Summer Showdown', $1)
	 on conflict do nothing returning id`,
	[boss]
);
const eventId =
	rows[0]?.id ??
	(await db.query(`select id from public.events where code = '2026onsum'`)).rows[0].id;

for (const p of [boss, ada, rey]) {
	await db.query(
		`insert into public.event_scouts (event_id, profile_id) values ($1, $2)
		 on conflict do nothing`,
		[eventId, p]
	);
}

// One of each reminder kind, because they render through completely different
// paths: a match number makes it a popup, its absence makes it a fly-by.
await db.query(
	`insert into public.reminders (event_id, event_code, message, author, expires_at)
	 values ($1, '2026onsum', 'Pit scouting sheets are on the cart.', 'Casey Boss',
	         now() + interval '2 hours')`,
	[eventId]
);
await db.query(
	`insert into public.reminders (event_id, event_code, message, author, match_number, expires_at)
	 values ($1, '2026onsum', 'You have team 3419 coming up.', 'Casey Boss', 12,
	         now() + interval '2 hours')`,
	[eventId]
);

await db.end();

console.log(`Seeded into ${stack.API_URL}

  manager   boss@demo.invalid   / demo-password
  scout     ada@demo.invalid    / demo-password
  scout     rey@demo.invalid    / demo-password

  event     2026onsum  "Ontario Summer Showdown"  (all three are members)
  reminders one fly-by, one popup

Point the dev server at this stack before opening it — see CLAUDE.md,
"Working locally". Signing in through the UI needs a password, so drive it from
the console instead:

  const m = await import('/src/lib/supabase.js');
  await m.getAuthClient().auth.signInWithPassword(
    { email: 'boss@demo.invalid', password: 'demo-password' });
`);
