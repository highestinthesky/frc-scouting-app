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
			event_id: ctx.sessionId,
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
			event_id: ctx.sessionId,
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

/**
 * Overrides that can never reach anybody.
 *
 * An override says "for match 40, this scout watches THIS team instead of their
 * usual list". It is keyed by `scout_name`, because that is still what the
 * planning joins use — so it survives the scout it was written for. Nine such
 * rows were found on production carrying names from an earlier season's test:
 * Brian, Charlie, Haolun, Jayden, Josh, Maddie, Michelle, Miles, Sunny. None
 * matched an account, none matched a current assignment.
 *
 * They are not a coverage bug. `evaluateCoverage()` iterates the scouts who have
 * ASSIGNMENTS and looks their overrides up by key, so a row for somebody with no
 * assignment is never consulted and never inflates the number. Checked, because
 * the opposite was the obvious assumption.
 *
 * They are a **dormancy** bug, which is worse for being quiet. The key is a
 * lowercased name. The moment a real scout called Josh is added to this event,
 * a year-old row starts overriding their real assignment for whichever matches
 * it names, and nothing anywhere says why. That is the same class as the
 * reactivation risk `scout-identity.js` exists to manage, one table over.
 *
 * Reported rather than deleted. Settings shows an identity mismatch and offers
 * to fix it instead of fixing it silently, and this follows that: a manager's
 * data is not tidied out from under them.
 *
 * @param {{scout_name?: string, profile_id?: string|null, match_number?: number, team_number?: number}[]} overrides
 * @param {{scout_name?: string, profile_id?: string|null}[]} assignments  the CURRENT assignment rows
 * @param {any[]} [roster]  profiles, so an account-holder with no assignment still counts as real
 * @returns {{scout: string, count: number}[]}  orphan names, most rows first
 */
export function orphanedOverrides(overrides, assignments, roster) {
	const live = new Set();
	for (const a of assignments ?? []) {
		const k = scoutRef(a?.scout_name).key;
		if (k) live.add(k);
	}
	// An account holder counts as reachable even with no assignment yet: a
	// manager may write a per-match override before assigning anyone a base list.
	for (const p of roster ?? []) {
		const full = `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();
		for (const candidate of [p?.username, full]) {
			const k = scoutRef(candidate).key;
			if (k) live.add(k);
		}
	}

	const counts = new Map();
	for (const o of overrides ?? []) {
		// A row carrying a real account id is reachable whatever its name says.
		if (o?.profile_id) continue;
		const ref = scoutRef(o?.scout_name);
		if (!ref.key || live.has(ref.key)) continue;
		const seen = counts.get(ref.key);
		if (seen) seen.count += 1;
		else counts.set(ref.key, { scout: ref.label || ref.key, count: 1 });
	}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.scout.localeCompare(b.scout));
}
