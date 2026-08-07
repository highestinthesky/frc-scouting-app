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
// session.svelte.js imports only db.js, so this direction is acyclic.
import { session } from './session.svelte.js';
import { scoutRef } from './scout-identity.js';

/**
 * Does the app REQUIRE an account yet?
 *
 * False while migration 0008 is additive: accounts exist and can be created
 * and tested, but nothing is locked and the event-code path still works.
 * Flipping this to true is the cutover, and it belongs with migration 0011,
 * which swaps every policy to `to authenticated`.
 *
 * Deliberately a constant rather than a probe. A client that guesses whether
 * auth is live gets it wrong exactly once — during a deploy — and locks
 * everyone out of an app they are standing in a gym trying to use.
 */
export const AUTH_ENFORCED = false;

/** RFC 2606 reserves .invalid as permanently unroutable. Nothing is ever sent. */
const AUTH_EMAIL_DOMAIN = 'scout.invalid';
const PROFILE_CACHE_KEY = 'frc-scout-last-profile';

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

/**
 * Read the current user's id from any Supabase auth response shape we use:
 * getSession() returns { session }, while sign-in/sign-up responses also expose
 * { user }. Keeping this pure makes the profile-query scope easy to test.
 *
 * @param {{user?: {id?: string}|null, session?: {user?: {id?: string}|null}|null}|null|undefined} data
 * @returns {string|null}
 */
export function authUserId(data) {
	return data?.user?.id ?? data?.session?.user?.id ?? null;
}

/**
 * Recover the immutable login username from the synthetic auth email. This is
 * used only for an unfinished signup: once signUp() succeeds, retrying invite
 * redemption must keep the same username or the displayed username would no
 * longer map to the email Supabase expects at the next login.
 *
 * @param {{user?: {email?: string}|null, session?: {user?: {email?: string}|null}|null}|null|undefined} data
 * @returns {string|null}
 */
export function authUsername(data) {
	const email = data?.user?.email ?? data?.session?.user?.email ?? '';
	const suffix = `@${AUTH_EMAIL_DOMAIN}`;
	return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length).toLowerCase() : null;
}

const state = $state({
	/** Has this device ever completed a sign-in? Drives route guarding. */
	signedIn: false,
	/** Auth identity retained even when invite redemption has not made a profile. */
	userId: /** @type {string|null} */ (null),
	authUsername: /** @type {string|null} */ (null),
	/** The profile row, or null while loading / if the account was revoked. */
	profile: /** @type {null | {id: string, username: string, first_name: string,
	 *  last_name: string, role: 'scout'|'manager'|'super'}} */ (null),
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
	get userId() { return state.userId; },
	get authUsername() { return state.authUsername; },
	get profile() { return state.profile; },
	get role() { return state.profile?.role ?? null; },
	get isManager() { return state.profile?.role === 'manager' || state.profile?.role === 'super'; },
	get isSuper() { return state.profile?.role === 'super'; },

	/**
	 * May this device write manager-scoped data — schedules, assignments,
	 * reminders, the picklist?
	 *
	 * Before the cutover the database gates on has_manager_token(), so the
	 * answer is "does this device hold the passphrase hash". Afterwards it gates
	 * on is_manager(), so the answer is the account's role. Both live here, in
	 * ONE place, because the two pages that ask this had already drifted apart:
	 * /scouting derived it from AUTH_ENFORCED while /insights/picklist read
	 * session.managerToken raw, so flipping the flag would have locked one and
	 * left the other offering buttons that silently fail.
	 *
	 * Callers must not re-derive this. `check_components.mjs` fails the build if
	 * they do.
	 */
	get canManage() {
		return AUTH_ENFORCED ? this.isManager : Boolean(session.managerToken);
	},

	/**
	 * The credential bag every manager-scoped write passes to
	 * createSupabaseClient().
	 *
	 * After the cutover this is empty: the passphrase header is meaningless
	 * because 0011 drops has_manager_token(), and authorisation rides the
	 * access token instead. Sending it anyway would cost nothing functionally
	 * and would leave a dead security mechanism looking live, which is how
	 * someone later mistakes it for protection.
	 */
	managerCredentials() {
		return AUTH_ENFORCED ? {} : { managerToken: session.managerToken };
	},
	get displayName() {
		const p = state.profile;
		return p ? `${p.first_name} ${p.last_name}`.trim() : '';
	},

	/**
	 * Who this device is, as something the planning tables can be joined on.
	 *
	 * Lives here for the same reason canManage does: it combines the account with
	 * the local session, and every call site that re-derived it would drift.
	 *
	 * The label is deliberately `session.scoutName` and NOT `displayName`. Until
	 * profile_id is what the joins actually use, the typed name is still the key,
	 * and a device that started announcing itself as "Haolun Ning" would stop
	 * matching every assignment, override and reminder addressed to "Ning". The
	 * account rides along as profileId, which is the half that is always right;
	 * the name is the half that still has to agree with what a manager typed.
	 *
	 * Display is a different question with a different answer — see displayName.
	 */
	get me() {
		return scoutRef(session.scoutName, state.profile?.id ?? null);
	},

	/**
	 * Called once from the layout. Restores any stored session and starts
	 * watching for changes.
	 */
	async init() {
		const client = getAuthClient();
		const { data } = await client.auth.getSession();
		state.signedIn = Boolean(data.session);
		rememberAuthIdentity(data);
		if (data.session) await loadProfile(authUserId(data));
		state.loading = false;

		client.auth.onAuthStateChange((event, session) => {
			// Deliberately NOT handling TOKEN_REFRESH_FAILED by signing out.
			// See rule 2 at the top of this file — that path is how a scout
			// loses unsaved work in a dead spot.
			if (event === 'SIGNED_IN') {
				state.signedIn = true;
				rememberAuthIdentity(session);
				loadProfile(authUserId(session));
			} else if (event === 'SIGNED_OUT') {
				clearCachedProfile();
				state.signedIn = false;
				state.userId = null;
				state.authUsername = null;
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
		const { data, error } = await getAuthClient().auth.signInWithPassword({
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
		rememberAuthIdentity(data);
		await loadProfile(authUserId(data));
		return { ok: true };
	},

	/**
	 * Create the account, then redeem the invite that authorises it. The auth
	 * user exists either way; without a redeemed invite it has no profile and
	 * therefore no access.
	 *
	 * @param {{code: string, username: string, password?: string,
	 *          firstName: string, lastName: string}} req
	 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
	 */
	async register(req) {
		const client = getAuthClient();
		const username = req.username.trim().toLowerCase();

		const problem = usernameProblem(username);
		if (problem) return { ok: false, message: problem };

		// A failed invite redemption leaves a valid, signed-in auth user but no
		// profile. Reuse that user on the next attempt instead of calling signUp
		// again (which can only report that the username already exists).
		const { data: sessionData } = await client.auth.getSession();
		let userId = authUserId(sessionData);
		const existingUsername = authUsername(sessionData);
		if (userId) {
			if (state.profile) {
				return { ok: false, message: 'This account is already set up.' };
			}
			if (existingUsername && existingUsername !== username) {
				return {
					ok: false,
					message: `This unfinished account belongs to ${existingUsername}. Use that username or sign out first.`
				};
			}
			state.signedIn = true;
			rememberAuthIdentity(sessionData);
		} else {
			if (!req.password || req.password.length < 8) {
				return { ok: false, message: 'Use a password with at least 8 characters.' };
			}
			const { data: signUpData, error: signUpError } = await client.auth.signUp({
				email: emailForUsername(username),
				password: req.password
			});
			if (signUpError) {
				if (/already/i.test(signUpError.message)) {
					return { ok: false, message: 'That username is taken. Pick another.' };
				}
				return { ok: false, message: signUpError.message };
			}
			userId = authUserId(signUpData);
			if (!userId) {
				return { ok: false, message: 'Account creation did not start a session. Try signing in.' };
			}
			state.signedIn = true;
			state.profile = null;
			state.orphaned = true;
			rememberAuthIdentity(signUpData);
		}

		const { error: redeemError } = await client.rpc('redeem_invite', {
			p_code: req.code,
			p_username: username,
			p_first: req.firstName,
			p_last: req.lastName
		});
		if (redeemError) {
			// 23505 is the unique index on lower(username) firing. It is a
			// normal outcome of two people picking the same name at the same
			// moment, not an error worth logging — the availability check in
			// the form has a race window and this is what actually holds.
			if (redeemError.code === '23505') {
				return existingUsername
					? {
							ok: false,
							message: 'That username was taken before setup finished. Sign out below and choose another.'
						}
					: { ok: false, message: 'That username was just taken. Pick another.' };
			}
			return { ok: false, message: redeemError.message };
		}

		await loadProfile(userId);
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

async function loadProfile(userId = null) {
	const client = getAuthClient();
	if (!userId) {
		// getSession() reads the persisted local session. Do not use getUser() here:
		// that validates over the network and would make profile reloads less
		// reliable in the exact offline conditions this app is designed for.
		const { data: sessionData, error: sessionError } = await client.auth.getSession();
		if (sessionError) return;
		userId = authUserId(sessionData);
	}
	if (!userId) return;

	// Profile reads need the network even when the persisted auth session does
	// not. Restore the last profile first so a cold offline PWA launch keeps its
	// identity and manager UI. This cache is presentation state only: every
	// server write is still authorised independently by Postgres RLS.
	const cached = readCachedProfile(userId);
	if (cached) {
		state.profile = cached;
		state.orphaned = false;
	}

	const { data, error } = await client
		.from('profiles')
		.select('id, username, first_name, last_name, role')
		.eq('id', userId)
		.maybeSingle();
	if (error) {
		// A read failure here is a network problem, not a revocation. Leave the
		// last-known profile in place rather than downgrading someone's role
		// because their phone lost signal.
		return;
	}
	state.profile = data ?? null;
	state.orphaned = state.signedIn && !data;
	if (data) cacheProfile(data);
	else clearCachedProfile();
}

function rememberAuthIdentity(data) {
	const nextUserId = authUserId(data);
	if (state.userId && nextUserId && state.userId !== nextUserId) {
		clearCachedProfile();
		state.profile = null;
		state.orphaned = false;
	}
	state.userId = nextUserId;
	state.authUsername = authUsername(data);
}

function readCachedProfile(userId) {
	if (typeof localStorage === 'undefined') return null;
	try {
		const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) ?? 'null');
		return cached?.id === userId ? cached : null;
	} catch (_error) {
		return null;
	}
}

function cacheProfile(profile) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
	} catch (_error) {
		// Storage may be unavailable in a private tab. The online profile still
		// works; only cold-start offline identity loses this convenience.
	}
}

function clearCachedProfile() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(PROFILE_CACHE_KEY);
	} catch (_error) {
		// Nothing else depends on the cache being writable.
	}
}
