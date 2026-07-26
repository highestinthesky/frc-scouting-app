// Per-metric statistics for a set of entries.
//
// One engine, so /manager, the team page, compare and the picklist all report
// the same number for the same team. Everything here is pure — pass in entries,
// get back stats.
//
// The central rule: a missing reading is not a zero. An entry recorded before
// counters existed, or one where the scout didn't watch that particular thing,
// contributes nothing to the sample rather than dragging the mean down. Only
// values that are actually present count toward `n`.

import { METRIC_FIELDS, METRIC_KEYS } from './form-config.js';

/** Below this many readings, treat a metric as directional rather than factual. */
export const MIN_CONFIDENT_SAMPLE = 3;

/**
 * Pull a metric value off an entry, or null if it wasn't recorded.
 * Rejects '', null, undefined and NaN — but keeps 0, which is a real reading.
 *
 * @param {object} entry
 * @param {string} key
 * @returns {number|null}
 */
export function readMetric(entry, key) {
	const raw = entry?.observations?.[key];
	if (raw === '' || raw === null || raw === undefined) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function median(sorted) {
	if (sorted.length === 0) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Population standard deviation. Used as a consistency signal: a team that
 * scores 5,5,5 is a safer alliance partner than one that scores 0,0,15 for the
 * same mean.
 */
function stdDev(values, mean) {
	if (values.length < 2) return null;
	const variance =
		values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/**
 * Trend: mean of the newer half minus mean of the older half. Positive means
 * improving. Null below four readings, where the split is meaningless.
 *
 * @param {number[]} chronological  oldest first
 */
function trend(chronological) {
	if (chronological.length < 4) return null;
	const split = Math.floor(chronological.length / 2);
	const older = chronological.slice(0, split);
	const newer = chronological.slice(split);
	const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
	return avg(newer) - avg(older);
}

/**
 * Stats for one metric across one team's entries.
 *
 * @param {object[]} entries  any order; sorted internally by createdAt
 * @param {string} key
 * @returns {{key: string, label: string, higherIsBetter: boolean, n: number,
 *            mean: number|null, median: number|null, max: number|null,
 *            min: number|null, stdDev: number|null, trend: number|null,
 *            confident: boolean, values: number[]}}
 */
export function metricStats(entries, key) {
	const field = METRIC_FIELDS.find((f) => f.key === key);
	const chronological = [...(entries ?? [])]
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
		.map((e) => readMetric(e, key))
		.filter((v) => v !== null);

	const n = chronological.length;
	if (n === 0) {
		return {
			key,
			label: field?.label ?? key,
			higherIsBetter: field?.higherIsBetter !== false,
			n: 0,
			mean: null,
			median: null,
			max: null,
			min: null,
			stdDev: null,
			trend: null,
			confident: false,
			values: []
		};
	}

	const mean = chronological.reduce((s, v) => s + v, 0) / n;
	const sorted = [...chronological].sort((a, b) => a - b);

	return {
		key,
		label: field?.label ?? key,
		higherIsBetter: field?.higherIsBetter !== false,
		n,
		mean,
		median: median(sorted),
		max: sorted[sorted.length - 1],
		min: sorted[0],
		stdDev: stdDev(chronological, mean),
		trend: trend(chronological),
		confident: n >= MIN_CONFIDENT_SAMPLE,
		values: chronological
	};
}

/**
 * Every metric for one team, keyed by metric key.
 *
 * @param {object[]} entries
 * @returns {Record<string, ReturnType<typeof metricStats>>}
 */
export function allMetricStats(entries) {
	const out = {};
	for (const key of METRIC_KEYS) out[key] = metricStats(entries, key);
	return out;
}

/**
 * Does this team have any numeric data at all? Lets surfaces fall back to the
 * qualitative view instead of rendering a grid of dashes.
 */
export function hasAnyMetrics(stats) {
	return METRIC_KEYS.some((k) => (stats?.[k]?.n ?? 0) > 0);
}

/**
 * Normalize each team's mean to 0–1 across the supplied field, then combine
 * with the caller's weights into a single score.
 *
 * Scaling is relative to the teams being compared, not to any absolute ceiling,
 * because what counts as a good number changes with every game. Metrics flagged
 * `higherIsBetter: false` are inverted so a low value scores high.
 *
 * Teams below MIN_CONFIDENT_SAMPLE on a metric still score, but `confidence`
 * comes back low so the UI can mark the number as provisional rather than
 * silently ranking a team on one lucky match.
 *
 * @param {{teamNumber: number, metrics: Record<string, object>}[]} teams
 * @param {Record<string, number>} weights  metric key → weight (0 skips it)
 * @returns {{teamNumber: number, score: number, confidence: number,
 *            contributions: Record<string, number>}[]}  sorted best first
 */
export function scoreTeams(teams, weights) {
	const active = METRIC_KEYS.filter((k) => (weights?.[k] ?? 0) !== 0);
	if (active.length === 0 || !teams?.length) {
		return (teams ?? []).map((t) => ({
			teamNumber: t.teamNumber,
			score: 0,
			confidence: 0,
			contributions: {}
		}));
	}

	// Range per metric across the teams in play.
	const ranges = {};
	for (const key of active) {
		const means = teams
			.map((t) => t.metrics?.[key]?.mean)
			.filter((v) => v !== null && v !== undefined);
		ranges[key] = means.length
			? { min: Math.min(...means), max: Math.max(...means) }
			: null;
	}

	const totalWeight = active.reduce((s, k) => s + Math.abs(weights[k]), 0);

	const scored = teams.map((t) => {
		const contributions = {};
		let score = 0;
		let sampled = 0;

		for (const key of active) {
			const stat = t.metrics?.[key];
			const range = ranges[key];
			if (!stat || stat.mean === null || !range) continue;

			// Every team identical on this metric — no signal, contribute nothing.
			const spread = range.max - range.min;
			let norm = spread === 0 ? 0.5 : (stat.mean - range.min) / spread;
			if (stat.higherIsBetter === false) norm = 1 - norm;

			const contribution = norm * weights[key];
			contributions[key] = contribution;
			score += contribution;
			if (stat.confident) sampled += 1;
		}

		return {
			teamNumber: t.teamNumber,
			score: totalWeight === 0 ? 0 : score / totalWeight,
			confidence: active.length === 0 ? 0 : sampled / active.length,
			contributions
		};
	});

	return scored.sort((a, b) => b.score - a.score || a.teamNumber - b.teamNumber);
}

/** Round for display without dragging in a formatting library. */
export function fmt(value, places = 1) {
	if (value === null || value === undefined || !Number.isFinite(value)) return '–';
	return Number.isInteger(value) ? String(value) : value.toFixed(places);
}
