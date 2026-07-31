// Accounts, roles and the session.
//
// Implements docs/adr-001-auth.md. Three rules govern everything here, and
// they exist because the alternative is a scout locked out of the app mid-match:
//
//   1. Recording NEVER depends on auth. db.js does not import this module.
//      A scout with an expired token, a revoked account or no radio at all
//      still writes to IndexedDB. Only sync waits.
//   2. A failed token refresh NEVER signs anyone out. Access tokens last about
//      an hour and refresh in the background; a scout in a dead corner when
//      that fires must not be bounced to a login screen holding unsaved work.
//      We keep the local session, mark sync stale, and retry.
//   3. Route guarding asks "has this device ever signed in", not "is this
//      token valid right now". Validity is the sync layer's problem.
//
// ─── why the email is derived ───────────────────────────────────────────────
//
// Supabase password auth needs an email; scouts have usernames. Rather than
// look one up — which needs an anon-readable table and leaks the roster — the
// address is computed from the username. No round trip, nothing to leak.
//
// The consequence, accepted knowingly: usernames are immutable. Changing one
// means changing the auth email, which is an admin operation, not a settings
// field.

import { getAuthClient } from './supabase.js';

/**
 * Does the app REQUIRE an account yet?
 *
 * False while migration 0008 is additive: accounts exist and can be created
 * and tested, but nothing is locked and the event-code path still works.
 * Flipping this to true is the cutover, and it belongs with migration 0009,
 * which swaps every policy to `to authenticated`.
 *
 * Deliberately a constant rather than a probe. A client that guesses whether
 * auth is live gets it wrong exactly once — during a deploy — and locks
 * everyone out of an app they are standing in a gym trying to use.
 */
export const AUTH_ENFORCED = false;

/** RFC 2606 reserves .invalid as permanently unroutable. Nothing is ever sent. */
const AUTH_EMAIL_DOMAIN = 'scout.invalid';

/** @param {string} username */
export const emailForUsername = (username) =>
	`${String(username ?? '').trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

/** Same shape the database CHECK enforces, so the form can say so first. */
export const USERNAME_RE = /^[a-z0-9._-]{3,24}$/;

/**
 * @param {string} username
 * @returns {string|null} a problem to show the user, or null if it's fine
 */
export function usernameProblem(username) {
	const u = String(username ?? '').trim().toLowerCase();
	if (u.length < 3) return 'At least 3 characters.';
	if (u.length > 24) return 'At most 24 characters.';
	if (!USERNAME_RE.test(u)) return 'Letters, numbers, dot, dash and underscore only.';
	return null;
}

const state = $state({
	/** Has this device ever completed a sign-in? Drives route guarding. */
	signedIn: false,
	/** The profile row, or null while loading / if the account was revoked. */
	profile: /** @type {null | {id: string, username: string, first_name: string,
	 *  last_name: string, role: 'scout'|'manager'|'super', recovery_email: string|null}} */ (null),
	/** True until the first session check finishes — pages should wait. */
	loading: true,
	/**
	 * The account exists in auth but has no profile row. Either the invite was
	 * never redeemed, or a manager revoked access. Either way: signed in,
	 * nothing to see.
	 */
	orphaned: false
});

export const auth = {
	get signedIn() { return state.signedIn; },
	get loading() { return state.loading; },
	get orphaned() { return state.orphaned; },
	get profile() { return state.profile; },
	get role() { return state.profile?.role ?? null; },
	get isManager() { return state.profile?.role === 'manager' || state.profile?.role === 'super'; },
	get isSuper() { return state.profile?.role === 'super'; },
	get displayName() {
		const p = state.profile;
		return p ? `${p.first_name} ${p.last_name}`.trim() : '';
	},

	/**
	 * Called once from the layout. Restores any stored session and starts
	 * watching for changes.
	 */
	async init() {
		const client = getAuthClient();
		const { data } = await client.auth.getSession();
		state.signedIn = Boolean(data.session);
		if (data.session) await loadProfile();
		state.loading = false;

		client.auth.onAuthStateChange((event) => {
			// Deliberately NOT handling TOKEN_REFRESH_FAILED by signing out.
			// See rule 2 at the top of this file — that path is how a scout
			// loses unsaved work in a dead spot.
			if (event === 'SIGNED_IN') {
				state.signedIn = true;
				loadProfile();
			} else if (event === 'SIGNED_OUT') {
				state.signedIn = false;
				state.profile = null;
				state.orphaned = false;
			}
		});
	},

	/**
	 * @param {string} username
	 * @param {string} password
	 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
	 */
	async signIn(username, password) {
		const { error } = await getAuthClient().auth.signInWithPassword({
			email: emailForUsername(username),
			password
		});
		if (error) {
			// Supabase says "Invalid login credentials" for both a wrong
			// password and an unknown user, which is the right thing to show —
			// distinguishing them tells an attacker which usernames exist.
			return { ok: false, message: 'That username and password do not match.' };
		}
		state.signedIn = true;
		await loadProfile();
		return { ok: true };
	},

	/**
	 * Create the account, then redeem the invite that authorises it. The auth
	 * user exists either way; without a redeemed invite it has no profile and
	 * therefore no access.
	 *
	 * @param {{code: string, username: string, password: string,
	 *          firstName: string, lastName: string, recoveryEmail?: string}} req
	 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
	 */
	async register(req) {
		const client = getAuthClient();
		const username = req.username.trim().toLowerCase();

		const problem = usernameProblem(username);
		if (problem) return { ok: false, message: problem };

		const { error: signUpError } = await client.auth.signUp({
			email: emailForUsername(username),
			password: req.password
		});
		if (signUpError) {
			if (/already/i.test(signUpError.message)) {
				return { ok: false, message: 'That username is taken. Pick another.' };
			}
			return { ok: false, message: signUpError.message };
		}

		const { error: redeemError } = await client.rpc('redeem_invite', {
			p_code: req.code,
			p_username: username,
			p_first: req.firstName,
			p_last: req.lastName,
			p_recovery_email: req.recoveryEmail ?? null
		});
		if (redeemError) {
			// 23505 is the unique index on lower(username) firing. It is a
			// normal outcome of two people picking the same name at the same
			// moment, not an error worth logging — the availability check in
			// the form has a race window and this is what actually holds.
			if (redeemError.code === '23505') {
				return { ok: false, message: 'That username was just taken. Pick another.' };
			}
			return { ok: false, message: redeemError.message };
		}

		state.signedIn = true;
		await loadProfile();
		return { ok: true };
	},

	async signOut() {
		await getAuthClient().auth.signOut();
	},

	/** Refresh the profile after a role change or an edit. */
	reload: loadProfile,

	// ─── manager surface ────────────────────────────────────────────────────

	/** @param {'scout'|'manager'|'super'} role */
	async createInvite(role = 'scout') {
		const { data, error } = await getAuthClient().rpc('create_invite', { p_role: role });
		if (error) throw new Error(error.message);
		return /** @type {string} */ (data);
	},

	async listInvites() {
		const { data, error } = await getAuthClient()
			.from('invites')
			.select('code, role, created_at, expires_at, redeemed_at, redeemed_by')
			.order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data ?? [];
	},

	async revokeInvite(code) {
		const { error } = await getAuthClient().from('invites').delete().eq('code', code);
		if (error) throw new Error(error.message);
	},

	async listProfiles() {
		const { data, error } = await getAuthClient()
			.from('profiles')
			.select('id, username, first_name, last_name, role, created_at')
			.order('last_name', { ascending: true });
		if (error) throw new Error(error.message);
		return data ?? [];
	},

	/** @param {string} id @param {'scout'|'manager'|'super'} role */
	async setRole(id, role) {
		const { error } = await getAuthClient().from('profiles').update({ role }).eq('id', id);
		if (error) throw new Error(error.message);
	},

	/**
	 * Revoke someone's access. Deletes the profile, not the auth user —
	 * every policy keys off the profile, so the orphaned login can sign in and
	 * see nothing. Deleting the auth user would need the service_role key,
	 * which cannot exist in a static bundle.
	 */
	async revokeAccess(id) {
		const { error } = await getAuthClient().from('profiles').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}
};

async function loadProfile() {
	const { data, error } = await getAuthClient()
		.from('profiles')
		.select('id, username, first_name, last_name, role, recovery_email')
		.maybeSingle();
	if (error) {
		// A read failure here is a network problem, not a revocation. Leave the
		// last-known profile in place rather than downgrading someone's role
		// because their phone lost signal.
		return;
	}
	state.profile = data ?? null;
	state.orphaned = state.signedIn && !data;
}
