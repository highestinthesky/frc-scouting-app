// Turning a pasted roster into a list of people.
//
// Pure, no imports — same shape as scout-identity.js and event-rules.js, and for
// the same reason: this is a rule, and the input is other people's spreadsheets.
// A team keeps its roster in a Google Sheet, a Discord message or a printout,
// and whatever comes out of those is what a manager pastes at 8am on the morning
// of an event.
//
// ─── the failure this exists to prevent ────────────────────────────────────
//
// Every account is created one at a time today: type a name, mint a code, read
// it out, repeat. At 20+ scouts that is twenty round trips through one person,
// and the failure mode is not a bug, it is a queue at the manager's table while
// matches are starting.
//
// ─── why it never rejects the whole paste ──────────────────────────────────
//
// One unparseable line must cost one invite, not twenty. A roster that fails
// whole is a roster the manager retypes by hand, which is the thing being
// removed. So this always returns whatever it understood, plus a list of what it
// did not, each naming its line number and quoting the text.

/**
 * @typedef {{firstName: string, lastName: string}} RosterPerson
 * @typedef {{line: number, text: string, why: string}} RosterProblem
 */

/**
 * Parse pasted text into people.
 *
 * Accepts the shapes a spreadsheet actually produces: "First Last",
 * "Last, First", and tab-separated columns, with CRLF, blank lines and the
 * stray trailing comma a CSV column leaves behind.
 *
 * @param {unknown} text
 * @returns {{people: RosterPerson[], problems: RosterProblem[]}}
 */
export function parseRoster(text) {
	/** @type {RosterPerson[]} */
	const people = [];
	/** @type {RosterProblem[]} */
	const problems = [];
	if (typeof text !== 'string') return { people, problems };

	const seen = new Set();

	text.split(/\r?\n/).forEach((raw, i) => {
		const line = i + 1;
		// A trailing comma is a CSV column boundary, not part of anyone's name.
		const cleaned = raw.trim().replace(/[,;]+$/, '').trim();
		if (!cleaned) return;

		let first = '';
		let last = '';

		if (cleaned.includes(',')) {
			// "Last, First" — what a sorted spreadsheet column looks like.
			const [surname, given] = cleaned.split(',', 2).map((p) => p.trim());
			first = given ?? '';
			last = surname ?? '';
		} else {
			// Tabs before spaces: a two-column paste is unambiguous, where a space
			// could be a middle name.
			const parts = cleaned.includes('\t')
				? cleaned.split('\t').map((p) => p.trim()).filter(Boolean)
				: cleaned.split(/\s+/);
			first = parts[0] ?? '';
			// Everything after the first token is the surname. Splitting on the LAST
			// space instead files "Ada Byron Lovelace" under "Ada Byron", and a
			// scout whose name the app gets wrong stops trusting the rest of it.
			last = parts.slice(1).join(' ');
		}

		if (!first || !last) {
			problems.push({
				line,
				text: cleaned,
				why: 'Needs both a first and last name — the invite carries it.'
			});
			return;
		}

		// A repeated line is a copy-paste artefact, not two people. Two invites for
		// one scout means one is wasted and both look valid when read out.
		const key = `${first} ${last}`.toLowerCase();
		if (seen.has(key)) {
			problems.push({ line, text: cleaned, why: 'Already on this list — skipped.' });
			return;
		}
		seen.add(key);
		people.push({ firstName: first, lastName: last });
	});

	return { people, problems };
}

/**
 * One person as a single displayable name.
 *
 * @param {RosterPerson} p
 * @returns {string}
 */
export function formatRosterName(p) {
	return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
}
