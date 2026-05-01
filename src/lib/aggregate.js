// Pure helpers for slicing the entries collection in different ways.
// Used by the manager view to summarise and group records.

import { listEntries } from './db.js';

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
			const failureCount = list.filter((e) => Boolean(e.observations?.failures?.trim())).length;
			const defenseCount = list.filter((e) => Boolean(e.observations?.defense?.trim())).length;
			const strengthsPreview = ordered
				.map((e) => e.observations?.strengths?.trim())
				.find(Boolean) ?? '';
			const latestCreatedAt = ordered[0]?.createdAt ?? null;
			return {
				teamNumber,
				entryCount: list.length,
				matchesCovered: new Set(list.map((e) => e.matchNumber)).size,
				scoutsCovered: new Set(list.map((e) => e.scoutName)).size,
				redCount,
				blueCount,
				failureCount,
				defenseCount,
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
