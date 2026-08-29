// Pure helpers for slicing the entries collection in different ways.
// Used by the manager view to summarise and group records.

import { rowScout } from './scout-identity.js';
import { listEntries } from './db.js';
import { allMetricStats, hasAnyMetrics } from './metrics.js';
import { normalizeCode, sameSeason, seasonOf } from './event-rules.js';

/**
 * "Did the robot break down on this entry?"
 * Reads the new boolean `brokeDown` field; falls back to the legacy free-text
 * `failures` field so entries collected on the v1 schema still count correctly.
 */
function hadBreakdown(entry) {
	const obs = entry.observations;
	if (!obs) return false;
	if (typeof obs.brokeDown === 'boolean') return obs.brokeDown;
	return typeof obs.failures === 'string' && obs.failures.trim().length > 0;
}

// ─── scope, and why it had to become explicit ──────────────────────────────
//
// This function read listEntries() — EVERY entry from EVERY event this device
// has ever held — and grouped by team with no event filter at all. It counted
// `events` into a Set and then never partitioned by it, so a team's mean silently
// pooled two events, and a manager reading "4.2 average" in a gym had no way to
// know how much of it came from a different weekend.
//
// That is the blank-is-not-zero failure in a different costume: a number that
// looks like one thing and is another. Pooling is genuinely wanted — a team's
// season record is worth carrying between events — but it has to be ASKED for,
// and it has to be labelled when it arrives.
//
// So scope is a parameter now, and `summarize()` with no argument keeps its old
// meaning of "everything held locally" for the callers that legitimately want it.

/**
 * High-level counts plus a per-team breakdown.
 *
 * @param {{eventCode?: string|null, season?: number|null}} [opts]
 *   `eventCode` narrows to one event; `season` narrows to one year across
 *   events. Neither narrows to nothing — an unrecognised code yields an empty
 *   summary rather than the whole collection, because silently widening a
 *   filter that failed is how the pooling above went unnoticed.
 */
export async function summarize(opts = {}) {
	return summarizeEntries(scopeEntries(await listEntries(), opts));
}

/**
 * Narrow a list of entries to an event, a season, or neither.
 *
 * Pure and exported so the scoping rule is testable without a database — the
 * same reason event-rules.js and planning-rows.js exist.
 *
 * @param {any[]} entries
 * @param {{eventCode?: string|null, season?: number|null}} [opts]
 */
export function scopeEntries(entries, opts = {}) {
	const list = Array.isArray(entries) ? entries : [];
	const code = normalizeCode(opts?.eventCode);
	const season = opts?.season ?? null;
	if (!code && season === null) return list;
	return list.filter((e) => {
		if (code && normalizeCode(e?.eventCode) !== code) return false;
		if (season !== null && seasonOf(e?.eventCode) !== season) return false;
		return true;
	});
}

/**
 * The pure half: everything above computed from a list that is already scoped.
 *
 * @param {any[]} entries
 */
export function summarizeEntries(entries) {
	entries = Array.isArray(entries) ? entries : [];

	const events = new Set();
	const scouts = new Set();
	const matches = new Set();
	const byTeam = new Map();

	for (const e of entries) {
		events.add(e.eventCode);
		scouts.add(e.scoutName);
		matches.add(`${e.eventCode}/${e.matchNumber}`);
		if (!byTeam.has(e.teamNumber)) byTeam.set(e.teamNumber, []);
		byTeam.get(e.teamNumber).push(e);
	}

	const teams = [...byTeam.entries()]
		.map(([teamNumber, list]) => {
			const ordered = list
				.slice()
				.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
			const redCount = list.filter((e) => e.allianceColor === 'red').length;
			const blueCount = list.filter((e) => e.allianceColor === 'blue').length;
			const breakdownCount = list.filter(hadBreakdown).length;
			const defenseCount = list.filter((e) => Boolean(e.observations?.defense?.trim())).length;
			const commentCount = list.filter((e) => Boolean(e.observations?.comments?.trim())).length;
			const strengthCount = list.filter((e) => Boolean(e.observations?.strengths?.trim())).length;
			const rawStrengths = ordered
				.map((e) => e.observations?.strengths?.trim())
				.find(Boolean) ?? '';
			const strengthsPreview = rawStrengths.length > 80 ? rawStrengths.slice(0, 80) + '…' : rawStrengths;
			// Unique strengths: all distinct, non-empty strength values in order of
			// first appearance (most recent entry first), case-insensitive dedup.
			const uniqueStrengths = [];
			const _seenLower = new Set();
			for (const e of ordered) {
				const s = e.observations?.strengths?.trim();
				if (!s) continue;
				const lower = s.toLowerCase();
				if (!_seenLower.has(lower)) {
					_seenLower.add(lower);
					uniqueStrengths.push(s);
				}
			}
			const autoPathCounts = new Map();
			for (const entry of list) {
				const key = entry.observations?.autoPathing?.trim();
				if (!key) continue;
				autoPathCounts.set(key, (autoPathCounts.get(key) ?? 0) + 1);
			}
			const autoPaths = [...autoPathCounts.entries()]
				.map(([pathName, count]) => ({ pathName, count }))
				.sort((a, b) => b.count - a.count || a.pathName.localeCompare(b.pathName));
			const latestCreatedAt = ordered[0]?.createdAt ?? null;

			// Discrepancy detection: group this team's entries by (event, match,
			// alliance), and flag any group where two scouts disagree on whether
			// the robot broke down. Two scouts watching the same team from the
			// same alliance in the same match should agree on facts that visible.
			const matchGroups = new Map();
			for (const entry of list) {
				const key = `${entry.eventCode}/${entry.matchNumber}/${entry.allianceColor}`;
				if (!matchGroups.has(key)) matchGroups.set(key, []);
				matchGroups.get(key).push(entry);
			}
			const discrepancies = [];
			for (const [key, group] of matchGroups) {
				if (group.length < 2) continue;
				const breakdowns = new Set(group.map(hadBreakdown));
				if (breakdowns.size > 1) {
					discrepancies.push({
						key,
						matchNumber: group[0].matchNumber,
						eventCode: group[0].eventCode,
						allianceColor: group[0].allianceColor,
						field: 'brokeDown',
						entries: group
					});
				}
			}
			const metrics = allMetricStats(list);

			return {
				teamNumber,
				entryCount: list.length,
				metrics,
				hasMetrics: hasAnyMetrics(metrics),
				matchesCovered: new Set(list.map((e) => e.matchNumber)).size,
				scoutsCovered: new Set(list.map((e) => rowScout(e).key)).size,
				redCount,
				blueCount,
				breakdownCount,
				defenseCount,
				commentCount,
				strengthCount,
				autoPathEntryCount: autoPaths.reduce((sum, p) => sum + p.count, 0),
				autoPathCount: autoPaths.length,
				autoPaths,
				strengthsPreview,
				uniqueStrengths,
				latestCreatedAt,
				discrepancies,
				discrepancyCount: discrepancies.length,
				entries: ordered
			};
		})
		.sort((a, b) => a.teamNumber - b.teamNumber);

	return {
		totalEntries: entries.length,
		teamCount: teams.length,
		eventCount: events.size,
		scoutCount: scouts.size,
		matchCount: matches.size,
		lastCreatedAt:
			entries.length > 0
				? entries.reduce((latest, e) => {
						if (!latest) return e.createdAt;
						return new Date(e.createdAt) > new Date(latest) ? e.createdAt : latest;
					}, null)
				: null,
		events: [...events].sort(),
		scouts: [...scouts].sort(),
		teams
	};
}

// ─── one team, at this event and across the season ─────────────────────────
//
// The two questions a manager asks about a team are not the same question, and
// the app used to answer them with one number:
//
//   "what has 254 done HERE"      decides the next match and the picklist
//   "what has 254 done THIS YEAR" says whether what is happening here is normal
//
// Both are wanted. Pooling them into one mean answers neither, and it is what
// summarize() silently did. So they are computed separately and rendered
// side by side, each carrying its own n.
//
// Season never crosses a year — see seasonOf() in event-rules.js. An event whose
// code declares no season pools with nothing, so its `season` block is its
// `event` block and `byEvent` has one row. That is correct rather than a
// degenerate case: an undated event has no evidence it belongs with any other.

/**
 * One team's record, scoped two ways.
 *
 * @param {any[]} entries      every entry the device holds
 * @param {number} teamNumber
 * @param {string|null} eventCode  the event being viewed; null means season-only
 * @returns {{teamNumber: number, season: number|null, event: object|null,
 *            seasonWide: object|null, byEvent: Array<object>}}
 */
export function teamProfile(entries, teamNumber, eventCode) {
	const all = Array.isArray(entries) ? entries : [];
	const team = Number(teamNumber);
	const code = normalizeCode(eventCode);
	const mine = all.filter((e) => Number(e?.teamNumber) === team);

	const atEvent = code ? mine.filter((e) => normalizeCode(e?.eventCode) === code) : [];
	// sameSeason() decides pooling and it refuses two nulls, so that a device
	// holding `practice` and `scrimmage` does not merge them just because neither
	// declares a year. The event itself is unioned back in explicitly: an undated
	// event pools with nothing ELSE, but it plainly contains its own entries, and
	// without this line its season block came back null and the page had nothing
	// to render. Caught by a test rather than in a gym.
	const inSeason = code
		? mine.filter((e) => sameSeason(e?.eventCode, code) || normalizeCode(e?.eventCode) === code)
		: mine;

	const oneTeam = (list) => (list.length ? summarizeEntries(list).teams[0] ?? null : null);

	// Per-event breakdown, newest event last so it reads left to right as a
	// history. Ordering is by the event's own most recent entry rather than by
	// code, because codes do not sort chronologically within a season.
	const byCode = new Map();
	for (const e of inSeason) {
		const k = normalizeCode(e?.eventCode) ?? '';
		if (!byCode.has(k)) byCode.set(k, []);
		byCode.get(k).push(e);
	}
	const byEvent = [...byCode.entries()]
		.map(([ec, list]) => ({
			eventCode: ec,
			isCurrent: ec === code,
			entryCount: list.length,
			matchesCovered: new Set(list.map((e) => e.matchNumber)).size,
			metrics: allMetricStats(list),
			lastCreatedAt: list.reduce(
				(latest, e) =>
					!latest || String(e.createdAt) > String(latest) ? e.createdAt : latest,
				null
			)
		}))
		.sort((a, b) => String(a.lastCreatedAt ?? '').localeCompare(String(b.lastCreatedAt ?? '')));

	return {
		teamNumber: team,
		season: seasonOf(code),
		event: oneTeam(atEvent),
		seasonWide: oneTeam(inSeason),
		byEvent
	};
}

// ─── one match ─────────────────────────────────────────────────────────────
//
// Nothing in the app answered "what happened in match 12". Insights aggregates
// a team ACROSS matches and coverage says WHETHER a match was watched; neither
// shows the match.
//
// The teams come from the cached TBA schedule and the observations come from
// IndexedDB, and the two are joined here rather than in the page so that "this
// team was in the match and nobody recorded it" is a value the page renders
// instead of an absence it has to infer. That gap is the most useful thing on
// the page — it is the same reading coverage gives, at the resolution a manager
// can still do something about.

/**
 * One match: its teams by alliance, each with whatever was recorded for it.
 *
 * A team with no entries is present with an empty list, not missing. A recorded
 * team that the schedule does not place in this match is also kept, flagged
 * `unscheduled` — a scout who typed the wrong match number produced a real
 * observation that must not vanish because it disagrees with TBA.
 *
 * @param {any[]} entries
 * @param {string} eventCode
 * @param {number} matchNumber
 * @param {{red?: number[], blue?: number[]}} [lineup]  from the cached schedule
 */
export function matchReport(entries, eventCode, matchNumber, lineup = {}) {
	const code = normalizeCode(eventCode);
	const match = Number(matchNumber);
	const mine = (Array.isArray(entries) ? entries : []).filter(
		(e) => normalizeCode(e?.eventCode) === code && Number(e?.matchNumber) === match
	);

	const byTeam = new Map();
	for (const e of mine) {
		const t = Number(e.teamNumber);
		if (!Number.isFinite(t)) continue;
		if (!byTeam.has(t)) byTeam.set(t, []);
		byTeam.get(t).push(e);
	}

	const seat = (teamNumber, allianceColor, scheduled) => {
		const list = (byTeam.get(teamNumber) ?? []).sort((a, b) =>
			String(a.createdAt).localeCompare(String(b.createdAt))
		);
		byTeam.delete(teamNumber);
		return {
			teamNumber,
			allianceColor,
			scheduled,
			unscheduled: !scheduled,
			entries: list,
			entryCount: list.length,
			covered: list.length > 0,
			// Two scouts on one team in one match is the case the discrepancy
			// detection in summarizeEntries() exists for, so it is worth surfacing
			// here rather than only in aggregate.
			duplicated: list.length > 1,
			scouts: [...new Map(list.map((e) => [rowScout(e).key, rowScout(e)])).values()],
			metrics: list.length ? allMetricStats(list) : null
		};
	};

	const red = (lineup?.red ?? []).map((t) => seat(Number(t), 'red', true));
	const blue = (lineup?.blue ?? []).map((t) => seat(Number(t), 'blue', true));

	// Whatever is left was recorded against this match by a scout but is not in
	// the schedule for it. Kept, and flagged.
	const stray = [...byTeam.keys()].map((t) => {
		const colour = byTeam.get(t)?.[0]?.allianceColor ?? null;
		return seat(t, colour, false);
	});

	// teamsCovered counts SCHEDULED seats only, because it is rendered against
	// teamsScheduled as "3/6". Counting strays in the numerator read as three of
	// the six scheduled teams being watched when only two were — a coverage
	// number that overstates coverage is worse than none, since coverage is the
	// one figure a manager acts on mid-event. Caught by looking at the page.
	const scheduled = [...red, ...blue];
	return {
		eventCode: code,
		matchNumber: match,
		red,
		blue,
		stray,
		hasLineup: red.length > 0 || blue.length > 0,
		entryCount: mine.length,
		teamsCovered: scheduled.filter((s) => s.covered).length,
		teamsScheduled: scheduled.length,
		scouts: [...new Map(mine.map((e) => [rowScout(e).key, rowScout(e)])).values()]
	};
}
