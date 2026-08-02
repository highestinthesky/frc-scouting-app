// Alliance selection — reading TBA's alliances endpoint.
//
// During selection, eight captains take turns inviting teams. The question the
// picklist has to answer, live, is "who is still available" — and getting it
// wrong is expensive in both directions: calling out a team that was taken two
// picks ago wastes the team's turn, and skipping a team that is still free
// loses the best robot left on the board.
//
// TBA publishes the alliances as they are formed, so the answer is a fetch
// away. The shapes it returns are awkward enough to be worth normalising once,
// here, with tests — rather than three times across the UI.
//
// ─── What TBA actually returns ─────────────────────────────────────────────
//
//   [
//     { name: "Alliance 1",
//       picks:    ["frc254", "frc1678", "frc2056"],
//       declines: ["frc1234"] },
//     ...
//   ]
//
// Three things to know:
//
//   · `picks[0]` is the CAPTAIN, not a pick. Treating the array as a flat list
//     of "teams on this alliance" is right for availability and wrong for the
//     label, and the label is what tells a manager whether a team turned an
//     invitation down or accepted one.
//   · `declines` is a real answer, not an error case. Under FRC rules a team
//     that declines an invitation is out of selection entirely — it is not
//     available to a later alliance. Rendering a declined team as "available"
//     is the same mistake as rendering a picked one that way.
//   · The array grows during selection, and is often absent entirely before
//     it starts. `[]` and `null` both mean "selection has not happened yet".
//
// Team keys are "frcNNNN". Everything below deals in plain numbers, because
// every other module in this app does.

/** @typedef {'captain'|'pick1'|'pick2'|'backup'|'declined'} AllianceSlot */

/**
 * @typedef {object} AllianceStanding
 * @property {number} teamNumber
 * @property {number} alliance      1-based; 0 for a declining team, which
 *                                  belongs to no alliance
 * @property {AllianceSlot} slot
 */

/** "frc254" -> 254. Returns null for anything that isn't a team key. */
export function teamNumberFromKey(key) {
	const m = /^frc(\d+)$/i.exec(String(key ?? '').trim());
	return m ? Number(m[1]) : null;
}

const SLOTS = /** @type {AllianceSlot[]} */ (['captain', 'pick1', 'pick2', 'backup']);

/**
 * Flatten TBA's alliance array into one standing per team.
 *
 * Order is preserved so callers can render "Alliance 3 · 2nd pick" without
 * re-deriving it. A team appearing twice — which TBA has been known to emit
 * mid-selection while a backup is being processed — keeps its FIRST standing,
 * since that is the one that took it out of the pool.
 *
 * @param {any[]|null|undefined} raw the TBA `/event/{key}/alliances` payload
 * @returns {AllianceStanding[]}
 */
export function standings(raw) {
	if (!Array.isArray(raw)) return [];
	const seen = new Map();

	raw.forEach((alliance, i) => {
		const number = i + 1;

		for (const [j, key] of (alliance?.picks ?? []).entries()) {
			const teamNumber = teamNumberFromKey(key);
			if (teamNumber === null || seen.has(teamNumber)) continue;
			// Anything past the fourth slot is a second backup or a data
			// oddity; "backup" is still the honest label for it.
			seen.set(teamNumber, { teamNumber, alliance: number, slot: SLOTS[j] ?? 'backup' });
		}

		for (const key of alliance?.declines ?? []) {
			const teamNumber = teamNumberFromKey(key);
			if (teamNumber === null || seen.has(teamNumber)) continue;
			// A decline is not membership: the team is out of selection, but it
			// is not ON alliance N. Recording it as alliance 0 keeps "which
			// alliance is this team on" answerable and honest.
			seen.set(teamNumber, { teamNumber, alliance: 0, slot: 'declined' });
		}
	});

	return [...seen.values()];
}

/**
 * teamNumber -> standing, for O(1) lookup while rendering a list.
 * @param {any[]|null|undefined} raw
 * @returns {Map<number, AllianceStanding>}
 */
export function standingsByTeam(raw) {
	return new Map(standings(raw).map((s) => [s.teamNumber, s]));
}

/**
 * Whether alliance selection appears to be under way.
 *
 * TBA returns `null` before selection and a full array afterwards, but during
 * selection it returns partially-filled alliances — captains seated, picks
 * still arriving. Distinguishing "not started" from "in progress" decides
 * whether the picklist shows availability at all, and showing "everyone is
 * available" before selection begins is technically true and useless.
 *
 * @param {any[]|null|undefined} raw
 */
export function selectionStarted(raw) {
	return standings(raw).length > 0;
}

/**
 * Split a team list into what a manager needs on the board.
 *
 * `available` keeps the caller's order — the picklist is already ranked, and
 * re-sorting it by anything would throw away the only ordering that took work.
 *
 * @template {{teamNumber: number}} T
 * @param {T[]} teams
 * @param {Map<number, AllianceStanding>} byTeam
 * @returns {{available: T[], taken: Array<T & {standing: AllianceStanding}>}}
 */
export function partition(teams, byTeam) {
	const available = [];
	const taken = [];
	for (const t of teams) {
		const standing = byTeam.get(t.teamNumber);
		if (standing) taken.push({ ...t, standing });
		else available.push(t);
	}
	return { available, taken };
}

/**
 * The highest-ranked team still available — what a captain needs the instant
 * their turn arrives.
 *
 * @template {{teamNumber: number}} T
 * @param {T[]} rankedTeams in pick order
 * @param {Map<number, AllianceStanding>} byTeam
 * @returns {T|null}
 */
export function nextAvailable(rankedTeams, byTeam) {
	return rankedTeams.find((t) => !byTeam.has(t.teamNumber)) ?? null;
}

/**
 * Human label for a standing. Kept here rather than in the template so the
 * wording is testable and identical everywhere it appears.
 *
 * @param {AllianceStanding} s
 */
export function describe(s) {
	if (!s) return '';
	if (s.slot === 'declined') return 'declined';
	if (s.slot === 'captain') return `captain of ${s.alliance}`;
	if (s.slot === 'backup') return `backup on ${s.alliance}`;
	return `${s.slot === 'pick1' ? '1st' : '2nd'} pick, alliance ${s.alliance}`;
}
