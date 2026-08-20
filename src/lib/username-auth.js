export const CREDENTIAL_ERROR = 'That username and password do not match.';
export const RATE_LIMIT_ERROR = 'Too many sign-in attempts. Try again later.';
export const NETWORK_ERROR = 'Could not reach sign-in. Check your connection and try again.';

/**
 * Ask the private Edge Function to exchange username + password, then install
 * the returned session in the one Supabase client that owns browser auth state.
 *
 * The function intentionally returns no email or profile. A real session is the
 * proof that the password was correct; setSession validates and persists it using
 * the same storage path as an ordinary supabase-js password sign-in.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ok: true, data: unknown} | {ok: false, message: string}>}
 */
export async function establishUsernameSession(client, username, password) {
	let result;
	try {
		result = await client.functions.invoke('username-sign-in', {
			body: {
				username: String(username ?? '').trim().toLowerCase(),
				password
			}
		});
	} catch {
		return { ok: false, message: NETWORK_ERROR };
	}

	if (result.error) {
		const status = Number(result.error?.context?.status ?? 0);
		if (status === 429) return { ok: false, message: RATE_LIMIT_ERROR };
		if (status === 0 || status >= 500 || result.error?.name === 'FunctionsFetchError') {
			return { ok: false, message: NETWORK_ERROR };
		}
		return { ok: false, message: CREDENTIAL_ERROR };
	}

	const accessToken = result.data?.access_token;
	const refreshToken = result.data?.refresh_token;
	if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
		return { ok: false, message: NETWORK_ERROR };
	}

	const { data, error } = await client.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken
	});
	if (error || !data?.session) return { ok: false, message: NETWORK_ERROR };
	return { ok: true, data };
}
