// Pure helpers for slicing the entries collection in different ways.
// Used by the manager view to summarise and group records.

import { listEntries } from './db.js';

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
			return {
				teamNumber,
				entryCount: list.length,
				matchesCovered: new Set(list.map((e) => e.matchNumber)).size,
				scoutsCovered: new Set(list.map((e) => e.scoutName)).size,
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
				latestCreatedAt,
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
