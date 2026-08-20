// Accounts, roles and the session.
//
// Implements docs/adr-001-auth.md. Three rules govern everything here, and
// they exist because the alternative is a scout locked out of the app mid-match:
//
//   1. Recording NEVER depends on auth. db.js does not import this module.
//      A scout with an expired token, a revoked account or no radio at all
//      still writes to IndexedDB. Only sync waits.
//   2. A failed token refresh NEVER signs anyone out. A scout in a dead corner
//      when that fires must not be bounced to a login screen holding unsaved
//      work. We keep the local session, mark sync stale, and retry. Tokens last
//      four days, so a refresh during an event is unlikely rather than hourly.
//   3. Route guarding asks "has this device ever signed in", not "is this
//      token valid right now". Validity is the sync layer's problem.
//
// ─── why the email is looked up ─────────────────────────────────────────────
//
// Supabase password auth needs an email; scouts have usernames. The address
// used to be COMPUTED — `username@scout.invalid` — so nothing had to be looked
// up and nothing could leak. It also meant password recovery was impossible,
// because .invalid is permanently unroutable and Supabase sends recovery to
// auth.users.email. The first person to forget a password had no way back.
//
// Addresses are real now. signIn() sends the username and password to the
// pre-auth username-sign-in Edge Function, which resolves the address privately
// and returns a session only after the password is proven. The browser never
// receives an address merely for knowing a username.
//
// Usernames remain immutable. That was a consequence of the derivation and is
// now a deliberate choice: the username is the join key people are told, and
// changing it silently detaches an account from everything addressed to it.

import { getAuthClient } from './supabase.js';
import { establishUsernameSession } from './username-auth.js';
import { forgetEvents } from './events.js';
// session.svelte.js imports only db.js, so this direction is acyclic.
import { session } from './session.svelte.js';
// Same direction: db.js never imports this module, which is the invariant that
// keeps recording working without auth. auth calls db; db never calls auth.
import { claimEntriesForAccount } from './db.js';
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
export const AUTH_ENFORCED = true;

const PROFILE_CACHE_KEY = 'frc-scout-last-profile';

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
 * The signed-in account's email address, from any Supabase auth response shape.
 *
 * Replaces authUsername(), which recovered the username by stripping
 * `@scout.invalid` off the address. There is nothing to strip now — the address
 * is real and unrelated to the username — so an unfinished signup is identified
 * by the address the person typed rather than by a name encoded in it.
 *
 * That also removes a constraint rather than replacing it. Retrying a failed
 * invite redemption used to REQUIRE the same username, because the username was
 * the address; now any username will do, because the account is already bound
 * to its own email.
 *
 * @param {{user?: {email?: string}|null, session?: {user?: {email?: string}|null}|null}|null|undefined} data
 * @returns {string|null}
 */
export function authEmail(data) {
	return data?.user?.email ?? data?.session?.user?.email ?? null;
}

const state = $state({
	/** Has this device ever completed a sign-in? Drives route guarding. */
	signedIn: false,
	/** Auth identity retained even when invite redemption has not made a profile. */
	userId: /** @type {string|null} */ (null),
	authEmail: /** @type {string|null} */ (null),
	/** The profile row, or null while loading / if the account was revoked. */
	profile: /** @type {null | {id: string, username: string, first_name: string,
	 *  last_name: string, role: 'scout'|'manager'|'super',
	 *  must_change_password?: boolean}} */ (null),
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
	get authEmail() { return state.authEmail; },
	get profile() { return state.profile; },
	get role() { return state.profile?.role ?? null; },
	get isManager() { return state.profile?.role === 'manager' || state.profile?.role === 'super'; },
	get isSuper() { return state.profile?.role === 'super'; },

	/**
	 * May this device write manager-scoped data — schedules, assignments,
	 * reminders, the picklist?
	 *
	 * The account's role, and nothing else. Before the cutover this asked "does
	 * this device hold the passphrase hash", because production gated on
	 * has_manager_token(); 0019's manages_event() replaced that with membership
	 * plus role, and 0020 dropped the function.
	 *
	 * It still lives here, in ONE place, for the reason it always did: the two
	 * pages that ask had already drifted apart once, /scouting deriving it from
	 * the cutover flag while /insights/picklist read the stored passphrase hash
	 * directly. That is why check_components.mjs fails the build if a caller
	 * re-derives it.
	 */
	get canManage() {
		return this.isManager;
	},

	/**
	 * Should this device SHOW the manager surfaces at all?
	 *
	 * Now the same question as canManage, which it was always going to become.
	 *
	 * The two differed only because the passphrase entry form lived INSIDE the
	 * surface it unlocked, so gating the surface on already holding the
	 * passphrase sealed the only door to it. There is no door any more: the role
	 * arrives with the session, and a scout who should be a manager is promoted
	 * by a super rather than by typing a shared secret.
	 */
	get showsManagerTools() {
		return this.isManager;
	},

	/**
	 * The word the app bar shows for this device. Lives here for the same reason
	 * canManage does — computing it in the layout meant the shell deciding what
	 * "manager" means, which is exactly the drift check_components.mjs forbids.
	 */
	get roleLabel() {
		return this.showsManagerTools ? (state.profile?.role ?? 'manager') : 'scout';
	},

	/**
	 * Kept as an empty bag rather than deleted, so the 20-odd call sites that
	 * spread it into createSupabaseClient() do not all have to change in the same
	 * commit as the policy cutover. It returns nothing and sends nothing;
	 * authorisation rides the access token.
	 *
	 * Sending a passphrase header now would be worse than useless — 0020 drops
	 * has_manager_token(), so it would be a dead mechanism that still looks live,
	 * which is how someone later mistakes it for protection.
	 */
	managerCredentials() {
		return {};
	},
	/**
	 * Is this device still on a password somebody handed over?
	 *
	 * A password two people know is not a password. The layout gates the whole
	 * app on this until it is replaced — the same shape as the orphaned gate,
	 * because both mean "signed in, but not yet usable".
	 */
	get mustChangePassword() {
		return state.profile?.must_change_password === true;
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
			// Both transitions drop the event-id cache: which events are visible is
			// decided by membership, and membership just changed. Signing in also
			// clears whatever was resolved while signed OUT, which under RLS is
			// nothing — see eventIdForCode().
			if (event === 'SIGNED_IN') {
				forgetEvents();
				state.signedIn = true;
				rememberAuthIdentity(session);
				loadProfile(authUserId(session));
			} else if (event === 'SIGNED_OUT') {
				forgetEvents();
				clearCachedProfile();
				state.signedIn = false;
				state.userId = null;
				state.authEmail = null;
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
		const result = await establishUsernameSession(getAuthClient(), username, password);
		if (!result.ok) return result;
		const data = result.data;
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
	 * @param {{code: string, username: string, email?: string, password?: string,
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
		// again (which can only report that the address is already registered).
		const { data: sessionData } = await client.auth.getSession();
		let userId = authUserId(sessionData);
		if (userId) {
			if (state.profile) {
				return { ok: false, message: 'This account is already set up.' };
			}
			// No username check on resume any more. It used to be required —
			// the username WAS the address, so changing it would have pointed the
			// profile at an account nobody could reach. The address is real and
			// already fixed to this auth user, so any username still works.
			state.signedIn = true;
			rememberAuthIdentity(sessionData);
		} else {
			const email = String(req.email ?? '').trim().toLowerCase();
			if (!email || !email.includes('@')) {
				return { ok: false, message: 'Enter the email address you want password resets sent to.' };
			}
			if (!req.password || req.password.length < 8) {
				return { ok: false, message: 'Use a password with at least 8 characters.' };
			}
			const { data: signUpData, error: signUpError } = await client.auth.signUp({
				email,
				password: req.password
			});
			if (signUpError) {
				if (/already/i.test(signUpError.message)) {
					return { ok: false, message: 'That email address already has an account. Sign in instead.' };
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
			p_last: req.lastName,
			// The fifth parameter has existed since 0008 and was never passed.
			// auth.users.email is what recovery actually uses; this is the copy a
			// manager can read on the Accounts page to spot a typo before it
			// matters.
			p_recovery_email: String(req.email ?? '').trim().toLowerCase() || null
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

		await loadProfile(userId);
		return { ok: true };
	},

	async signOut() {
		await getAuthClient().auth.signOut();
	},

	/** Refresh the profile after a role change or an edit. */
	reload: loadProfile,

	// ─── manager surface ────────────────────────────────────────────────────

	/**
	 * Mint an invite for a NAMED person.
	 *
	 * The name is required, and that is the point of 0023. It used to be typed by
	 * whoever redeemed the code, so the manager assigned "Haolun Ning" a team and
	 * the scout registered as "haolun" — nothing to compare against, nothing
	 * rejected, and an assignment addressed to a person who did not exist. Asked
	 * once, by the person who is also typing the assignments, it cannot disagree
	 * with itself.
	 *
	 * @param {{role?: 'scout'|'manager'|'super', firstName: string, lastName: string}} req
	 */
	async createInvite(req) {
		const first = String(req?.firstName ?? '').trim();
		const last = String(req?.lastName ?? '').trim();
		if (!first || !last) {
			throw new Error('Enter the person’s first and last name — the invite carries it.');
		}
		const { data, error } = await getAuthClient().rpc('create_invite', {
			p_role: req.role ?? 'scout',
			p_first: first,
			p_last: last
		});
		if (error) throw new Error(error.message);
		return /** @type {string} */ (data);
	},

	/**
	 * Mint one invite per person, in one pass.
	 *
	 * Sequential rather than parallel on purpose. create_invite retries on code
	 * collision by re-reading `invites`, and twenty concurrent calls make that
	 * retry loop race itself for no gain — twenty round trips still finish inside
	 * a second, and a manager pasting a roster is not waiting on latency.
	 *
	 * One failure does not abandon the rest: a roster of twenty with one bad row
	 * should produce nineteen codes and one complaint, because the alternative is
	 * the manager doing all twenty by hand.
	 *
	 * @param {Array<{firstName: string, lastName: string}>} people
	 * @param {'scout'|'manager'|'super'} [role]
	 * @returns {Promise<{minted: Array<{firstName: string, lastName: string, code: string}>,
	 *                    failed: Array<{firstName: string, lastName: string, why: string}>}>}
	 */
	async createInviteBatch(people, role = 'scout') {
		const minted = [];
		const failed = [];
		for (const person of people ?? []) {
			try {
				const code = await this.createInvite({ ...person, role });
				minted.push({ ...person, code });
			} catch (e) {
				failed.push({ ...person, why: e?.message ?? String(e) });
			}
		}
		return { minted, failed };
	},

	async listInvites() {
		const { data, error } = await getAuthClient()
			.from('invites')
			.select('code, role, first_name, last_name, created_at, expires_at, redeemed_at, redeemed_by')
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
			.select('id, username, first_name, last_name, role, created_at, must_change_password')
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
	 * Create an account for someone else. Managers make scouts; supers make
	 * anyone.
	 *
	 * Goes through the create-account Edge Function, because creating an
	 * auth.users row needs service_role and a static bundle cannot hold that
	 * key. The function verifies the caller's own token and re-checks the role
	 * in the database, so nothing here is trusted — this is a request, not an
	 * instruction.
	 *
	 * Returns the generated username and the temporary password ONCE. Neither is
	 * stored anywhere readable afterwards; if the manager loses it before handing
	 * it over, the account has to be deleted and remade.
	 *
	 * @param {{firstName: string, lastName: string, email: string,
	 *          role?: 'scout'|'manager'|'super'}} req
	 * @returns {Promise<{username: string, temporaryPassword: string, role: string}>}
	 */
	async createAccount(req) {
		const { data, error } = await getAuthClient().functions.invoke('create-account', {
			body: {
				firstName: req.firstName,
				lastName: req.lastName,
				email: req.email,
				role: req.role ?? 'scout'
			}
		});
		// functions.invoke reports a non-2xx as an error whose body holds the
		// reason. Surfacing "Edge Function returned a non-2xx status code" instead
		// of "Only a super user can create a manager" would make every refusal
		// look like an outage.
		if (error) {
			let detail = error.message;
			try {
				const body = await error.context?.json?.();
				if (body?.error) detail = body.error;
			} catch {
				// Keep the transport error; the response had no JSON body to read.
			}
			throw new Error(detail);
		}
		if (data?.error) throw new Error(data.error);
		return data;
	},

	/**
	 * Replace a temporary password with one only this person knows, and clear
	 * the flag that forces it.
	 *
	 * Order matters. The password changes first: if the update to `profiles`
	 * failed after clearing the flag, the person would be let into the app still
	 * holding a password their manager knows.
	 *
	 * @param {string} password
	 */
	async setOwnPassword(password) {
		const client = getAuthClient();
		const { error } = await client.auth.updateUser({ password });
		if (error) throw new Error(error.message);
		if (state.profile?.id) {
			const { error: flagErr } = await client
				.from('profiles')
				.update({ must_change_password: false })
				.eq('id', state.profile.id);
			if (flagErr) throw new Error(flagErr.message);
			state.profile = { ...state.profile, must_change_password: false };
		}
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
		.select('id, username, first_name, last_name, role, must_change_password')
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
	if (data) {
		await adoptScoutName(data);
		await claimRecordedEntries(data);
	}
}

/**
 * Attach this account to the entries this device recorded signed out.
 *
 * Here rather than only in signIn() because this is the one place a profile
 * becomes known, and it runs on session restore too. A scout who recorded
 * offline, closed the app and reopened it should not have to sign out and back
 * in for their work to become theirs.
 *
 * Safe to run every time by construction: claimableRows() takes only this
 * device's own unattributed rows, so a second run finds nothing.
 *
 * Failure is swallowed deliberately. Claiming is a repair, not a precondition —
 * a scout whose IndexedDB is momentarily locked should still be signed in, and
 * the next profile load tries again.
 *
 * @param {{id: string, first_name?: string, last_name?: string, username?: string}} profile
 */
async function claimRecordedEntries(profile) {
	try {
		const name =
			`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.username || '';
		await claimEntriesForAccount(profile.id, name);
	} catch (_error) {
		// Intentionally quiet. See above.
	}
}

/**
 * Fill the local scout name from the account, but only if it is empty.
 *
 * Signing in used to leave you typing your own name into Settings anyway, on
 * every device, with nothing checking that you spelled it the way the manager
 * did. The account already knows it.
 *
 * Only when EMPTY, and that restriction is load-bearing. `scout_name` is still
 * the join key for assignments, per-match overrides and targeted reminders, so
 * overwriting a name a device already had would silently detach it from
 * everything addressed to the old spelling. A blank one is joined to nothing,
 * which makes it free to fill.
 *
 * "First Last" rather than the username because that is what a manager types
 * into the assignment editor, and because resolveScout() matches on exactly
 * that form — so the name this writes is one the roster can resolve back to
 * this same account.
 */
async function adoptScoutName(profile) {
	if (session.scoutName?.trim()) return;
	const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.username;
	if (name) await session.update({ scoutName: name });
}

function rememberAuthIdentity(data) {
	const nextUserId = authUserId(data);
	if (state.userId && nextUserId && state.userId !== nextUserId) {
		clearCachedProfile();
		state.profile = null;
		state.orphaned = false;
	}
	state.userId = nextUserId;
	state.authEmail = authEmail(data);
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
