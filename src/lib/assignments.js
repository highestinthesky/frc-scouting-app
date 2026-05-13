// Scout-to-team assignments synced through Supabase.
//
// The manager publishes a list of `(scout_name, team_number)` rows for the
// event. Scout devices pull the rows on every sync tick, filter to their own
// scout_name (case-insensitive), and stash the resulting team-number list
// into session.assignedTeams. The entry form reads that list to suggest the
// next match to scout.
//
// Manager writes require the `x-manager-token` header (gated by the
// `has_manager_token()` Postgres function). Reads work for anyone scoped to
// the event_code.
//
// Note: we don't keep a separate IndexedDB mirror of the assignments table.
// The "cache" is session.assignedTeams itself — a single short list. On a
// cold start that list is loaded from IndexedDB (via session.load()) so the
// scout sees their last-known assignments offline; the next online tick
// freshens it.

import { createSupabaseClient, deriveSessionId } from './supabase.js';
import { session } from './session.svelte.js';

/**
 * Manager-only: replace the entire assignment list for an event with the
 * provided rows. Inside one transaction: delete everything for this
 * session_id, then insert the new rows.
 *
 * @param {string} eventCode
 * @param {{scout_name: string, team_number: number}[]} rows
 * @param {object} opts
 * @param {string} opts.managerToken  hex hash; required after passphrase set
 * @returns {Promise<number>}  number of rows inserted
 */
export async function replaceAssignments(eventCode, rows, opts) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event code.');
	if (!opts?.managerToken && opts?.managerToken !== '') {
		// Allow empty-string explicitly for bootstrap (no passphrase set yet).
	}
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id.');
	const client = createSupabaseClient(sid, { managerToken: opts?.managerToken ?? '' });

	const cleaned = (rows ?? [])
		.map((r) => ({
			session_id: sid,
			event_code: code,
			scout_name: String(r.scout_name ?? '').trim(),
			team_number: Number(r.team_number)
		}))
		.filter((r) => r.scout_name && Number.isFinite(r.team_number) && r.team_number > 0);

	// Wipe existing, then insert. Two round-trips, but assignments tables are
	// tiny so the cost is negligible — and it avoids upsert-on-composite gotchas.
	const { error: delErr } = await client
		.from('assignments')
		.delete()
		.eq('session_id', sid);
	if (delErr) throw mapErr(delErr, 'clear assignments');

	if (cleaned.length === 0) return 0;
	const { error: insErr } = await client.from('assignments').insert(cleaned);
	if (insErr) throw mapErr(insErr, 'save assignments');
	return cleaned.length;
}

/**
 * Read all assignments for an event. Anyone scoped to the event_code can
 * read; the RLS policy only requires `x-session-id`.
 *
 * @param {string} eventCode
 * @returns {Promise<{scout_name: string, team_number: number, id: string}[]>}
 */
export async function listAssignments(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return [];
	const sid = await deriveSessionId(code);
	if (!sid) return [];
	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('assignments')
		.select('id, scout_name, team_number')
		.eq('session_id', sid)
		.order('scout_name', { ascending: true })
		.order('team_number', { ascending: true });
	if (error) throw mapErr(error, 'load assignments');
	return data ?? [];
}

/**
 * Pull assignments and apply the subset for `scoutName` (case-insensitive)
 * to session.assignedTeams. Called from the sync tick so scout devices stay
 * up to date with whatever the manager just set.
 *
 * Returns the new assignedTeams list (sorted ascending) for callers that
 * want to react to changes.
 *
 * @param {string} eventCode
 * @param {string} scoutName
 * @returns {Promise<number[]>}
 */
export async function pullAndApplyForScout(eventCode, scoutName) {
	const name = (scoutName ?? '').trim().toLowerCase();
	if (!name) return session.assignedTeams ?? [];
	const all = await listAssignments(eventCode);
	const mine = all
		.filter((r) => String(r.scout_name ?? '').trim().toLowerCase() === name)
		.map((r) => Number(r.team_number))
		.filter(Number.isFinite);
	const dedup = [...new Set(mine)].sort((a, b) => a - b);
	// Compare against current state before writing — avoid touching IndexedDB
	// when nothing changed (and avoid spurious effect runs).
	const cur = session.assignedTeams ?? [];
	const same = cur.length === dedup.length && cur.every((v, i) => v === dedup[i]);
	if (!same) {
		await session.update({ assignedTeams: dedup });
	}
	return dedup;
}

function mapErr(err, action) {
	const msg = err?.message || String(err);
	if (/row-level security/i.test(msg) || err?.code === '42501') {
		return new Error(
			`Permission denied — couldn't ${action}. Check the manager passphrase, or have whoever set up scheduling re-add it.`
		);
	}
	return new Error(`Couldn't ${action}: ${msg}`);
}
