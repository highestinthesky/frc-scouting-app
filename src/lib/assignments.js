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
	const [all, overrideRows] = await Promise.all([
		listAssignments(eventCode),
		listOverrides(eventCode)
	]);
	const mine = all
		.filter((r) => String(r.scout_name ?? '').trim().toLowerCase() === name)
		.map((r) => Number(r.team_number))
		.filter(Number.isFinite);
	const dedup = [...new Set(mine)].sort((a, b) => a - b);
	// Compare against current state before writing — avoid touching IndexedDB
	// when nothing changed (and avoid spurious effect runs).
	const cur = session.assignedTeams ?? [];
	const sameTeams = cur.length === dedup.length && cur.every((v, i) => v === dedup[i]);
	if (!sameTeams) await session.update({ assignedTeams: dedup });

	// Overrides: cache the whole list (managers want it all; scouts only
	// care about their own rows but the volume is tiny so we don't filter).
	const ov = overrideRows.map((r) => ({
		id: r.id,
		match_number: Number(r.match_number),
		scout_name: String(r.scout_name ?? ''),
		team_number: Number(r.team_number)
	}));
	const curOv = session.overrides ?? [];
	const sameOv =
		curOv.length === ov.length &&
		curOv.every(
			(v, i) =>
				v.match_number === ov[i].match_number &&
				v.scout_name === ov[i].scout_name &&
				v.team_number === ov[i].team_number
		);
	if (!sameOv) await session.update({ overrides: ov });

	return dedup;
}

// ─── per-match overrides ──────────────────────────────────────────────────
//
// An override row reads: "in match M, scout S watches team T (instead of
// whatever the base assignments table says)." Multiple rows per (M, S) are
// allowed so a scout can watch two teams in a single match. If any
// override row exists for (M, S), it REPLACES the base for that match.

/**
 * Read every override row for an event. Cheap (typically a handful of rows).
 *
 * @param {string} eventCode
 * @returns {Promise<{id, match_number, scout_name, team_number}[]>}
 */
export async function listOverrides(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return [];
	const sid = await deriveSessionId(code);
	if (!sid) return [];
	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('assignment_overrides')
		.select('id, match_number, scout_name, team_number')
		.eq('session_id', sid)
		.order('match_number', { ascending: true });
	if (error) throw mapErr(error, 'load overrides');
	return data ?? [];
}

/**
 * Manager-only: add a single override row.
 *
 * @param {string} eventCode
 * @param {{matchNumber: number, scoutName: string, teamNumber: number}} args
 * @param {string} managerToken
 */
export async function addOverride(eventCode, { matchNumber, scoutName, teamNumber }, managerToken) {
	const code = (eventCode ?? '').trim().toLowerCase();
	const sid = await deriveSessionId(code);
	if (!sid) throw new Error('Could not derive session id.');
	const client = createSupabaseClient(sid, { managerToken });
	const { error } = await client.from('assignment_overrides').insert({
		session_id: sid,
		event_code: code,
		match_number: Number(matchNumber),
		scout_name: String(scoutName ?? '').trim(),
		team_number: Number(teamNumber)
	});
	// Dedupe-index 23505: caller probably already has this override; safe to ignore.
	if (error && error.code !== '23505') throw mapErr(error, 'add override');
}

/**
 * Manager-only: delete an override row by id.
 *
 * @param {string} eventCode
 * @param {string} id
 * @param {string} managerToken
 */
export async function removeOverride(eventCode, id, managerToken) {
	const sid = await deriveSessionId(eventCode);
	if (!sid) throw new Error('Could not derive session id.');
	const client = createSupabaseClient(sid, { managerToken });
	const { error } = await client.from('assignment_overrides').delete().eq('id', id);
	if (error) throw mapErr(error, 'remove override');
}

/**
 * Pure resolution: for a single match, return the set of team numbers this
 * scout is responsible for. Overrides win; otherwise base ∩ teams-in-match.
 *
 * @param {object} match  TBA match object
 * @param {string} scoutName
 * @param {number[]} baseAssignments
 * @param {{match_number: number, scout_name: string, team_number: number}[]} overrides
 * @returns {number[]}
 */
export function resolveTeamsForMatch(match, scoutName, baseAssignments, overrides) {
	if (!match) return [];
	const name = (scoutName ?? '').trim().toLowerCase();
	const mn = match.match_number;
	const playing = teamsInMatchSet(match);
	const override = (overrides ?? [])
		.filter((o) => o.match_number === mn && String(o.scout_name).trim().toLowerCase() === name)
		.map((o) => Number(o.team_number))
		.filter((t) => Number.isFinite(t) && playing.has(t));
	if (override.length > 0) return [...new Set(override)].sort((a, b) => a - b);
	return (baseAssignments ?? [])
		.filter((t) => Number.isFinite(t) && playing.has(t))
		.sort((a, b) => a - b);
}

function teamsInMatchSet(match) {
	const out = new Set();
	for (const arr of [match?.alliances?.red?.team_keys, match?.alliances?.blue?.team_keys]) {
		for (const k of arr ?? []) {
			const n = parseInt(String(k).replace(/^frc/, ''), 10);
			if (Number.isFinite(n)) out.add(n);
		}
	}
	return out;
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
