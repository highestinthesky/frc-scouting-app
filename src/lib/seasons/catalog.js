import { seasonFor, SEASON_YEARS } from './index.js';
import { seasonOf } from '../event-rules.js';

// A season can be named before its scouting rules are ready. Keep those names
// separate from the game registry so choosing BIOCORE cannot open a REBUILT form.
const names = new Map(SEASON_YEARS.filter((year) => year !== 1999)
	.map((year) => [year, seasonFor(year).name]));
names.set(2027, 'BIOCORE');

/** Name first, with the year retained to identify the season unambiguously. */
export function seasonLabel(year) {
	const value = Number(year);
	if (!Number.isInteger(value) || value < 1992) return 'Unknown season';
	const name = names.get(value);
	return name ? `${name} · ${value}` : `Season ${value}`;
}

/** The season belongs to the event code, even when another season is active. */
export function eventSeasonLabel(code) {
	return seasonLabel(seasonOf(code));
}

/** Preserve an unknown saved setting without offering it as a new choice. */
export function seasonOptions(activeYear) {
	const options = [...names.keys()].sort((a, b) => a - b)
		.map((year) => ({ value: year, label: seasonLabel(year) }));
	const year = Number(activeYear);
	if (Number.isInteger(year) && year >= 1992 && !names.has(year)) {
		options.push({ value: year, label: seasonLabel(year), disabled: true });
	}
	return options;
}
