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
		.map(([teamNumber, list]) => ({
			teamNumber,
			entryCount: list.length,
			matchesCovered: new Set(list.map((e) => e.matchNumber)).size,
			scoutsCovered: new Set(list.map((e) => e.scoutName)).size,
			entries: list.sort((a, b) => a.matchNumber - b.matchNumber)
		}))
		.sort((a, b) => a.teamNumber - b.teamNumber);

	return {
		totalEntries: entries.length,
		teamCount: teams.length,
		eventCount: events.size,
		scoutCount: scouts.size,
		matchCount: matches.size,
		events: [...events].sort(),
		scouts: [...scouts].sort(),
		teams
	};
}
