// Public ratings, as a second opinion — never as a dependency.
//
// Statbotics publishes EPA (Expected Points Added) for every team, free, with no
// API key. That matters for what this file is FOR: rebuilding EPA would be
// reproducing a public dataset slightly worse, and a team's own scouts have no
// advantage there. The advantage is in the disagreement — a team EPA rates
// highly that your scouts keep marking as broken down, or the reverse, is a pick
// won or lost.
//
// ─── it can be absent, and that is designed for, not handled ─────────────────
//
// While this was being written, every /v3/ data endpoint returned HTTP 500 while
// the API root returned 200. Not a hypothetical: the service was simply down for
// the afternoon. So nothing here may become load-bearing. The picklist, the
// insights table and every ranking must work identically when this returns
// nothing, and say which numbers they are showing.
//
// ─── no API key ──────────────────────────────────────────────────────────────
//
// Confirmed from the service's own OpenAPI document, which declares
// `securitySchemes: NONE`. TBA still needs a key and still keeps the per-manager
// one in session.tbaApiKey; nothing about this file changes that.

import { getSetting, setSetting } from './db.js';

const BASE = 'https://api.statbotics.io/v3';

/** How long a cached rating stays fresh. EPA moves per match, not per second. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Pull a number out of a Statbotics team-year object.
 *
 * ─── THIS MAPPING IS UNVERIFIED ──────────────────────────────────────────────
 *
 * The API was returning 500 on every data endpoint when this was written, its
 * OpenAPI document types the response as a bare `object` with
 * `additionalProperties: true`, and the docs page is a JS shell that names no
 * fields. So the shape could not be observed, and guessing one field name would
 * have produced a reader that silently finds nothing.
 *
 * Instead: try the plausible paths, in order, and REPORT WHICH ONE MATCHED. A
 * caller that gets `{value, path}` knows the mapping works and which key it is
 * using; a caller that gets a `sawKeys` list back knows the response arrived and
 * this function could not read it, which is a completely different problem from
 * the network being down and must not look the same.
 *
 * When the API is reachable again this becomes a thirty-second check: call it,
 * look at `path`, and delete the candidates that were wrong.
 *
 * @param {unknown} obj
 * @returns {{value: number, path: string}|{value: null, sawKeys: string[]}}
 */
export function readEpa(obj) {
	if (!obj || typeof obj !== 'object') return { value: null, sawKeys: [] };

	const CANDIDATES = [
		'epa.total_points.mean',
		'epa.breakdown.total_points',
		'epa.total_points',
		'epa.norm',
		'epa.unitless',
		'norm_epa',
		'epa_end',
		'epa'
	];

	for (const path of CANDIDATES) {
		let cur = /** @type {any} */ (obj);
		for (const part of path.split('.')) {
			if (cur === null || cur === undefined || typeof cur !== 'object') {
				cur = undefined;
				break;
			}
			cur = cur[part];
		}
		if (typeof cur === 'number' && Number.isFinite(cur)) return { value: cur, path };
	}

	return { value: null, sawKeys: Object.keys(/** @type {object} */ (obj)) };
}

/**
 * Fetch one team's rating for a season, cached.
 *
 * Never throws and never rejects. Every failure is a value, because every caller
 * is a surface that has to keep working without this.
 *
 * @param {number} team
 * @param {number} year
 * @param {{fetchImpl?: typeof fetch, now?: number, force?: boolean}} [opts]
 * @returns {Promise<{ok: true, epa: number|null, path?: string, sawKeys?: string[], cachedAt: string, fromCache: boolean}
 *                 | {ok: false, reason: 'offline'|'http'|'parse', detail: string}>}
 */
export async function fetchTeamRating(team, year, opts = {}) {
	const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
	const key = `statbotics:team_year:${team}:${year}`;
	const now = opts.now ?? Date.now();

	if (!opts.force) {
		const cached = await getSetting(key);
		if (cached && now - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS) {
			return { ok: true, epa: cached.epa, path: cached.path, cachedAt: cached.cachedAt, fromCache: true };
		}
	}

	if (!doFetch) return { ok: false, reason: 'offline', detail: 'No fetch available.' };

	let res;
	try {
		res = await doFetch(`${BASE}/team_year/${team}/${year}`, {
			headers: { accept: 'application/json' }
		});
	} catch (e) {
		// No network, DNS, CORS — all the same answer to a manager: not now.
		return { ok: false, reason: 'offline', detail: e?.message ?? String(e) };
	}

	if (!res.ok) {
		return { ok: false, reason: 'http', detail: `Statbotics returned ${res.status}.` };
	}

	let body;
	try {
		body = await res.json();
	} catch (e) {
		return { ok: false, reason: 'parse', detail: e?.message ?? String(e) };
	}

	const read = readEpa(body);
	const cachedAt = new Date(now).toISOString();
	// Cached even when the value is null: a response that arrived and could not be
	// read is a fact worth remembering for six hours rather than re-fetching on
	// every render.
	await setSetting(key, { epa: read.value, path: read.path ?? null, cachedAt });
	return {
		ok: true,
		epa: read.value,
		path: read.path,
		sawKeys: read.sawKeys,
		cachedAt,
		fromCache: false
	};
}

/**
 * Rank a list by a value, highest first, with ties sharing a rank.
 *
 * Ties share because a picklist built on an arbitrary tiebreak invents a
 * distinction the data does not contain, and someone will then defend it.
 *
 * @param {{key: string|number, value: number|null}[]} rows
 * @returns {Map<string|number, number>}  key -> rank (1-based); absent when value is null
 */
export function rankBy(rows) {
	const scored = (rows ?? []).filter((r) => typeof r.value === 'number' && Number.isFinite(r.value));
	scored.sort((a, b) => Number(b.value) - Number(a.value));
	const out = new Map();
	let rank = 0;
	let seen = 0;
	let last = null;
	for (const r of scored) {
		seen += 1;
		if (last === null || r.value !== last) {
			rank = seen;
			last = /** @type {number} */ (r.value);
		}
		out.set(r.key, rank);
	}
	return out;
}

/**
 * Where do our scouts and the public rating disagree?
 *
 * Compares two RANKINGS rather than two values, because EPA is in points and a
 * scouted mean is in whatever a scout counted. The numbers are not comparable;
 * the orderings are.
 *
 * A team missing from either side is absent from the result, not zero. That is
 * the blank-vs-zero rule again: no rating is not a bad rating, and a team your
 * scouts have not covered has not been judged.
 *
 * @param {{team: number|string, ours: number|null, theirs: number|null}[]} rows
 * @returns {{team: number|string, ourRank: number, theirRank: number, gap: number, direction: 'we-rate-higher'|'they-rate-higher'|'agree'}[]}
 */
export function disagreements(rows) {
	const ours = rankBy((rows ?? []).map((r) => ({ key: r.team, value: r.ours })));
	const theirs = rankBy((rows ?? []).map((r) => ({ key: r.team, value: r.theirs })));

	const out = [];
	for (const r of rows ?? []) {
		const a = ours.get(r.team);
		const b = theirs.get(r.team);
		if (a === undefined || b === undefined) continue;
		const gap = b - a; // positive: we rank it better (lower number) than they do
		out.push({
			team: r.team,
			ourRank: a,
			theirRank: b,
			gap: Math.abs(gap),
			direction: gap === 0 ? 'agree' : gap > 0 ? 'we-rate-higher' : 'they-rate-higher'
		});
	}
	// Biggest disagreement first — that is the whole point of the list.
	out.sort((x, y) => y.gap - x.gap);
	return out;
}
