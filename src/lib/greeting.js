// The one warm line in the app.
//
// Three fixed time bands read as a machine by the second morning of a two-day
// event, so the pool varies. Two constraints shape how:
//
//   1. **It must not move while someone is reading it.** Home re-derives `now`
//      every 60 seconds to keep "in 8 min" honest, which re-runs every $derived
//      on the page. A greeting picked at random — or seeded on the clock — would
//      reshuffle itself under the reader once a minute. So the seed is the
//      calendar day and the person, never the time of day within it.
//
//   2. **It must not be a joke.** This is read eleven times a day by someone
//      standing in a loud gym with a phone. "Rise and shine" is funny once.
//      Warm and plain survives a weekend; clever does not.
//
// The band still moves the greeting at noon and at six, because being told
// "good morning" at night is worse than any amount of repetition.

/** Greetings that make sense at any hour. */
const ANY_TIME = ['Hello', 'Hi there', 'Howdy', 'Good to see you', 'Welcome back', 'Hey'];

/**
 * Which third of the day it is.
 * @param {Date} date
 * @returns {'morning'|'afternoon'|'evening'}
 */
export function bandFor(date) {
	const h = date.getHours();
	if (h < 12) return 'morning';
	if (h < 18) return 'afternoon';
	return 'evening';
}

/**
 * FNV-1a. Small, dependency-free, and — the only property that matters here —
 * stable across reloads and devices, so the same person sees the same greeting
 * all day rather than a new one each time the page remounts.
 *
 * @param {string} str
 * @returns {number} a non-negative 32-bit integer
 */
function hash(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * A greeting for this person, on this day, in this part of the day.
 *
 * Stable for as long as all three hold. Deterministic, so it is testable and so
 * two devices belonging to one scout agree.
 *
 * @param {Date} [date]
 * @param {string} [name]  the person's display name, only ever used as seed salt
 * @returns {string}
 */
export function greetingFor(date = new Date(), name = '') {
	const band = bandFor(date);
	// `Good <band>` earns a place in the pool rather than being the whole answer:
	// it is the most natural of them, so it should come up more often than any
	// single alternative, and appearing once per pool is how that happens.
	const pool = [...ANY_TIME, `Good ${band}`];
	const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
	return pool[hash(`${day}|${band}|${String(name).trim().toLowerCase()}`) % pool.length];
}
