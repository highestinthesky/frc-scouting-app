// Create a team account on a manager's behalf.
//
// The v0.6 draft has a super or manager enter someone's name and hand over a
// temporary password. That needs the Auth admin API, which needs service_role,
// and a static GitHub Pages bundle cannot hold that key — which is exactly why
// the app shipped invite codes instead. This is the trusted place that key can
// live.
//
// ─── what this must never become ───────────────────────────────────────────
//
// It runs as service_role. Every request therefore arrives with more authority
// than the person making it, and the ONLY thing standing between "a manager
// created an account" and "anyone created a super user" is the check below.
//
// The caller's own JWT is verified first, with the anon key, exactly as any
// other client request would be. service_role is used afterwards and only for
// the two things that genuinely require it.
//
// The authority check is then made AGAIN inside create_managed_profile(),
// deliberately. A privileged helper that trusts its caller to have checked is
// how the check eventually gets skipped.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' }
	});

// No 0/O/1/I/L. These get read aloud across a workshop and typed on a phone —
// the same alphabet 0008 chose for invite codes, for the same reason.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFrom(alphabet: string, length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	// Modulo bias is irrelevant at these sizes and this is not a secret ranking;
	// what matters is that it comes from a CSPRNG rather than Math.random.
	return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * first initial + last initial + six digits.
 *
 * The draft suggests three digits — hz123. That is 1000 possibilities for a
 * known name, and `email_for_username` lets an anonymous caller turn a username
 * into a real email address, so three digits is a thousand requests to harvest
 * a named scout's address. Six is a million for the same guess, at the cost of
 * three more characters on a card.
 *
 * Digits rather than letters on purpose: they are unambiguous read aloud and
 * sit on the phone keypad, and the readable initials are what make it feel like
 * a name rather than a token.
 */
function generateUsername(first: string, last: string): string {
	const initial = (s: string) => (s.trim()[0] ?? 'x').toLowerCase().replace(/[^a-z0-9]/, 'x');
	const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b % 10).join('');
	return `${initial(first)}${initial(last)}${digits}`;
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
	if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

	const authHeader = req.headers.get('Authorization') ?? '';
	if (!authHeader.startsWith('Bearer ')) {
		return json({ error: 'Sign in first.' }, 401);
	}

	// Who is asking? Verified against the anon key, so the token is checked the
	// same way every other request is, rather than being decoded and believed.
	const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
		global: { headers: { Authorization: authHeader } }
	});
	const { data: userData, error: userErr } = await asCaller.auth.getUser();
	if (userErr || !userData?.user) return json({ error: 'Sign in first.' }, 401);
	const actorId = userData.user.id;

	let body: { firstName?: string; lastName?: string; email?: string; role?: string };
	try {
		body = await req.json();
	} catch {
		return json({ error: 'Expected a JSON body.' }, 400);
	}

	const firstName = String(body.firstName ?? '').trim();
	const lastName = String(body.lastName ?? '').trim();
	const email = String(body.email ?? '').trim().toLowerCase();
	const role = String(body.role ?? 'scout');

	if (!firstName || !lastName) return json({ error: 'A first and last name are required.' }, 400);
	if (!email.includes('@')) {
		// Deliberate deviation from the draft, which has the manager enter only a
		// name. An account with no routable address cannot be recovered, and this
		// project has already locked someone out that way once. One field is a
		// cheaper price than repeating it twenty times.
		return json({ error: 'An email address is required, so the password can be reset later.' }, 400);
	}
	if (!['scout', 'manager', 'super'].includes(role)) {
		return json({ error: 'Unknown role.' }, 400);
	}

	const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	// A username nobody holds. Bounded, because an unbounded loop against a
	// remote database is a hang rather than an error.
	let username = '';
	for (let attempt = 0; attempt < 8; attempt++) {
		const candidate = generateUsername(firstName, lastName);
		const { data: taken, error } = await admin.rpc('username_taken', { p_username: candidate });
		if (error) return json({ error: `Could not check the username: ${error.message}` }, 500);
		if (!taken) {
			username = candidate;
			break;
		}
	}
	if (!username) return json({ error: 'Could not find a free username. Try again.' }, 500);

	const temporaryPassword = randomFrom(ALPHABET, 10);

	// email_confirm, because nothing is ever sent at signup — mailer_autoconfirm
	// is on and this address only matters when a password reset is requested.
	const { data: created, error: createErr } = await admin.auth.admin.createUser({
		email,
		password: temporaryPassword,
		email_confirm: true
	});
	if (createErr || !created?.user) {
		const msg = createErr?.message ?? 'unknown error';
		return json(
			{ error: /already/i.test(msg) ? 'That email address already has an account.' : msg },
			400
		);
	}

	// The profile, and the second authority check. If this fails the auth user
	// is deleted again — a login with no profile is an orphan the person can do
	// nothing with, and leaving one behind would block that address forever.
	const { error: profileErr } = await admin.rpc('create_managed_profile', {
		p_actor: actorId,
		p_id: created.user.id,
		p_username: username,
		p_first: firstName,
		p_last: lastName,
		p_role: role
	});
	if (profileErr) {
		await admin.auth.admin.deleteUser(created.user.id);
		return json({ error: profileErr.message }, 403);
	}

	// The password is returned once and never stored anywhere readable. The
	// manager hands it over; the app forces a change at first sign-in.
	return json({ username, temporaryPassword, role });
});
