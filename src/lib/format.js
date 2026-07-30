// Tiny formatting helpers shared by the schedule list, home-page banner, and
// "X minutes ago" freshness indicators. Pure functions, no dependencies.

/**
 * "in 8 min" / "5 min ago" / "now" / "2 h 12 min ago".
 * Accepts a Date, ISO string, or Unix-seconds number.
 *
 * @param {Date|string|number} when
 * @param {Date} [now]
 * @returns {string}
 */
export function relativeTime(when, now = new Date()) {
	const t = toDate(when);
	if (!t) return '';
	const diffMs = t.getTime() - now.getTime();
	const past = diffMs < 0;
	const absMin = Math.round(Math.abs(diffMs) / 60_000);
	if (absMin < 1) return 'now';
	if (absMin < 60) return past ? `${absMin} min ago` : `in ${absMin} min`;
	const h = Math.floor(absMin / 60);
	const m = absMin % 60;
	const pieces = m === 0 ? `${h} h` : `${h} h ${m} min`;
	return past ? `${pieces} ago` : `in ${pieces}`;
}

/**
 * "2:47 PM" — locale-aware time of day with no seconds.
 * @param {Date|string|number} when
 * @returns {string}
 */
export function timeOfDay(when) {
	const t = toDate(when);
	if (!t) return '';
	return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Combine relative + absolute. "Q15 · in 8 min (2:47 PM)" use case.
 * @param {Date|string|number} when
 */
export function timeWithRelative(when, now = new Date()) {
	const rel = relativeTime(when, now);
	const abs = timeOfDay(when);
	if (!rel) return abs;
	if (!abs) return rel;
	return `${rel} · ${abs}`;
}

function toDate(v) {
	if (v == null) return null;
	if (v instanceof Date) return v;
	if (typeof v === 'string') {
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	if (typeof v === 'number') {
		// TBA's predicted_time is Unix seconds, not milliseconds. Heuristic:
		// any number under 10^12 is seconds, else milliseconds.
		const ms = v < 1e12 ? v * 1000 : v;
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return null;
}

/**
 * Split a block of copy into paragraphs on blank lines, collapsing incidental
 * whitespace inside each one.
 *
 * Callers write these bodies as multi-line template literals, so the source
 * carries wraps and indentation that mean nothing to the reader. A single
 * newline is a wrap; a blank line is a real break.
 *
 * @param {string} [body]
 * @returns {string[]}
 */
export function splitParagraphs(body) {
	return String(body ?? '')
		.split(/\n{2,}/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}
