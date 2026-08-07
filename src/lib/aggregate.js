// Pure helpers for slicing the entries collection in different ways.
// Used by the manager view to summarise and group records.

import { rowScout } from './scout-identity.js';
import { listEntries } from './db.js';
import { allMetricStats, hasAnyMetrics } from './metrics.js';

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

/** High-level counts plus a per-team breakdown. */
export async function summarize() {
	const entries = await listEntries();

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
