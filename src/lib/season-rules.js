import { normalizeCode, seasonOf } from './event-rules.js';

export const DEFAULT_SEASON_SETTINGS = Object.freeze({ active_year: 2026, announced: false });
export const SEASON_CACHE_KEY = 'seasonSettings';
export const SEASON_WAITING_MESSAGE = 'Check back later after the season is announced.';

/** Invalid server/cache data must never open scouting. */
export function normalizeSeasonSettings(value) {
	return Number.isInteger(value?.active_year) && value.active_year >= 1992 &&
		value.active_year <= 9999 && typeof value.announced === 'boolean'
		? { active_year: value.active_year, announced: value.announced }
		: null;
}

export function seasonIsOpen(value, supportedYears) {
	const settings = normalizeSeasonSettings(value);
	return Boolean(settings?.announced && settings.active_year !== 1999 &&
		supportedYears?.includes(settings.active_year));
}

export function seasonEntries(entries, year) {
	if (!Number.isInteger(year)) return [];
	return (Array.isArray(entries) ? entries : []).filter((e) => seasonOf(e?.eventCode) === year);
}

export function eventInSeason(code, year) {
	return Number.isInteger(year) && seasonOf(code) === year;
}

export function recordingAllowed(context, value, eventCode, owner, supportedYears) {
	return seasonIsOpen(value, supportedYears) && context.year === value.active_year &&
		eventInSeason(context.eventCode, value.active_year) &&
		normalizeCode(context.eventCode) === normalizeCode(eventCode) && context.owner === owner;
}

/** Routes that mount scouting data or game controls. Preparation is exempt. */
export function seasonRoute(path, base = '') {
	let p = base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
	p = p.replace(/\/+$/, '') || '/';
	if (/^\/(home|scouting|practice|insights)(\/|$)/.test(p)) return true;
	if (!/^\/studio(\/|$)/.test(p)) return false;
	return !/^\/studio\/(plan|accounts|event|schedule)(\/|$)/.test(p);
}

/** Event encoded in a match/team deep link; null for the named manager routes. */
export function routeEvent(path, base = '') {
	const p = base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
	const match = /^\/studio\/([^/]+)\/(?:team\/|q\d+(?:\/|$))/.exec(p);
	return match ? normalizeCode(match[1]) : null;
}
