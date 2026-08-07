// The wire shapes a manager's planning writes take.
//
// Extracted from assignments.js and reminders.js for the same reason
// sync-rules.js was extracted from sync.svelte.js: those modules construct a
// Supabase client and import session.svelte.js, which uses runes, so neither
// survives outside a browser and neither can be tested with plain node. The
// decisions worth pinning down are in here, where they can be.
//
// The decision worth pinning down: every planning row carries BOTH identity
// columns. `scout_name` because it is still what the joins actually use, and
// `profile_id` because migration 0011 cannot become safe until those columns
// are populated by something other than one backfill's guesswork.

import { scoutRef, resolveScout, identityFields } from './scout-identity.js';

/**
 * A typed name plus whatever account the roster says it belongs to.
 *
 * Best-effort by design. With no roster — offline, or nobody signed in — the
 * row still carries the name and a null account, which is exactly what a
 * pre-accounts device produces today. Resolution improves the data when it can
 * and never stands between a manager and saving an assignment ten minutes
 * before quals.
 *
 * @param {unknown} name
 * @param {any[]} [roster]
 */
export function refFor(name, roster) {
	return scoutRef(name, resolveScout(name, roster));
}

/**
 * Rows for `assignments`: one scout watching one team, for the whole event.
 *
 * @param {{scout_name: string, team_number: number}[]} rows
 * @param {{sessionId: string, eventCode: string, roster?: any[]}} ctx
 */
export function assignmentRows(rows, ctx) {
	return (rows ?? [])
		.map((r) => ({
			session_id: ctx.sessionId,
			event_code: ctx.eventCode,
			...identityFields(refFor(r.scout_name, ctx.roster)),
			team_number: Number(r.team_number)
		}))
		.filter((r) => r.scout_name && Number.isFinite(r.team_number) && r.team_number > 0);
}

/**
 * Rows for `assignment_overrides`: one scout watching one team, in one match.
 *
 * @param {{match_number: number, scout_name: string, team_number: number}[]} rows
 * @param {{sessionId: string, eventCode: string, roster?: any[]}} ctx
 */
export function overrideRows(rows, ctx) {
	return (rows ?? [])
		.map((r) => ({
			session_id: ctx.sessionId,
			event_code: ctx.eventCode,
			match_number: Number(r.match_number),
			...identityFields(refFor(r.scout_name, ctx.roster)),
			team_number: Number(r.team_number)
		}))
		.filter(
			(r) =>
				r.scout_name &&
				Number.isFinite(r.match_number) &&
				Number.isFinite(r.team_number) &&
				r.team_number > 0
		);
}

/**
 * Who a reminder is aimed at.
 *
 * A reminder with no scout is a BROADCAST and must stay null in both identity
 * columns. identityFields() yields '' for an unnamed ref, and an empty string
 * is not null — it would quietly turn "everyone" into "the scout called
 * nothing", and the banner would show for no one.
 *
 * @param {unknown} scoutName
 * @param {any[]} [roster]
 */
export function reminderTarget(scoutName, roster) {
	const typed = String(scoutName ?? '').trim();
	if (!typed) return { scout_name: null, profile_id: null };
	return identityFields(refFor(typed, roster));
}
