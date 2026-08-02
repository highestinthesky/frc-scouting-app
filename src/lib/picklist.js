// Picklist ordering — pure functions, no I/O, no runes.
//
// The picklist is the one document in this app that several managers edit at
// the same time, in the twenty minutes that decide the team's season. So the
// question is not "how do we store a list", it is "what happens when two people
// change it at once".
//
// ─── Why rows, not a document ──────────────────────────────────────────────
//
// The obvious storage is one JSON blob per event: { primary: [...], avoid:
// [...] }. That is how the picklist works today in IndexedDB, and it is how
// `schedules` works in Postgres. It is also last-write-wins over the WHOLE
// list, which fails in a specific and quiet way:
//
//   09:00  A phone opens the picklist. It now holds the 9am list.
//   14:00  The strategy lead spends five hours ranking 40 teams on a laptop.
//   14:05  Someone taps a button on that phone. It writes ITS copy.
//          Five hours are gone, with no error and nothing to roll back to.
//
// One row per team removes the failure entirely: the stale phone holds stale
// rows and pushes only the row it touched. Two managers editing different teams
// never collide. It is also the shape `assignments` already uses.
//
// ─── Why fractional ranks ──────────────────────────────────────────────────
//
// With integer ranks, moving a team from 8th to 1st renumbers seven rows — and
// concurrently renumbering rows is exactly the collision we just designed out.
//
// A `rank` of type double, with a move written as the midpoint of its new
// neighbours, makes every reorder a ONE-ROW write:
//
//     [1000, 2000, 3000]      move the third to the front
//     [1000, 2000, 500]       one write. Sort by rank: 500, 1000, 2000.
//
// Position is derived from sort order, never stored. That is the whole trick,
// and it is why two managers can drag two different teams at the same time and
// both moves survive.
//
// The cost is precision: repeatedly halving the same gap exhausts a double
// after ~50 moves into one spot. `needsRebalance` detects it and `rebalance`
// renumbers to clean multiples of STEP. For a 60-team list over an afternoon
// this will almost certainly never fire — but "almost certainly never" is the
// kind of thing that fires during alliance selection.

/** Gap between adjacent ranks after a rebalance. Large enough that ~10 halvings
 *  fit between any two neighbours before precision becomes a question. */
export const STEP = 1024;

/** Below this gap, midpoints stop being meaningfully distinct. */
const MIN_GAP = 1e-6;

/**
 * Rank that places an item between two neighbours.
 *
 * Pass null for either side to mean "the end of the list": before(null, first)
 * is prepend, after(last, null) is append.
 *
 * @param {number|null} before rank of the item that should end up above
 * @param {number|null} after  rank of the item that should end up below
 * @returns {number}
 */
export function rankBetween(before, after) {
	const hasBefore = Number.isFinite(before);
	const hasAfter = Number.isFinite(after);

	if (!hasBefore && !hasAfter) return STEP;
	if (!hasBefore) return /** @type {number} */ (after) - STEP;
	if (!hasAfter) return /** @type {number} */ (before) + STEP;
	return (/** @type {number} */ (before) + /** @type {number} */ (after)) / 2;
}

/**
 * True when the gap between any two adjacent ranks has collapsed far enough
 * that the next midpoint would not be distinct.
 *
 * @param {Array<{rank: number}>} rows already sorted
 */
export function needsRebalance(rows) {
	for (let i = 1; i < rows.length; i += 1) {
		const gap = rows[i].rank - rows[i - 1].rank;
		if (!Number.isFinite(gap) || gap < MIN_GAP) return true;
	}
	// A non-finite rank anywhere means someone wrote garbage; renumber.
	return rows.some((r) => !Number.isFinite(r.rank));
}

/**
 * Renumber to clean multiples of STEP, preserving the current visual order.
 * Returns a NEW array; callers push every changed row.
 *
 * @param {Array<{rank: number}>} rows already sorted
 */
export function rebalance(rows) {
	return rows.map((r, i) => ({ ...r, rank: (i + 1) * STEP }));
}

/**
 * Sort rows into display order.
 *
 * Ties are possible — two managers can genuinely land on the same rank, since
 * neither saw the other's write. Breaking the tie on team number rather than
 * leaving it to the sort's stability matters: an unstable tiebreak means the
 * list silently reorders itself between renders, which reads as a bug and
 * destroys trust in the list at the worst moment.
 *
 * @template {{rank: number, teamNumber: number}} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function ordered(rows) {
	return [...rows].sort((a, b) => a.rank - b.rank || a.teamNumber - b.teamNumber);
}

/**
 * The rank that moves `teamNumber` to index `toIndex` of the current order.
 *
 * Returns null when the move is a no-op, so callers can skip the write.
 *
 * @param {Array<{rank: number, teamNumber: number}>} rows current order
 * @param {number} teamNumber
 * @param {number} toIndex destination index in the list WITHOUT the moved item
 * @returns {number|null}
 */
export function rankForMove(rows, teamNumber, toIndex) {
	const list = ordered(rows);
	const from = list.findIndex((r) => r.teamNumber === teamNumber);
	if (from === -1) return null;

	const without = list.filter((r) => r.teamNumber !== teamNumber);
	const clamped = Math.max(0, Math.min(toIndex, without.length));

	// Landing back where it started is not a write.
	if (clamped === from) return null;

	const before = clamped > 0 ? without[clamped - 1].rank : null;
	const after = clamped < without.length ? without[clamped].rank : null;
	return rankBetween(before, after);
}

/**
 * Merge a remote row set over local rows, per team, newest write wins.
 *
 * Resolution is per TEAM, which is the whole point of storing rows: a manager
 * who reorders team 254 cannot clobber a colleague's note on team 1678, no
 * matter how stale their device is.
 *
 * Ties on the timestamp go to remote. Clocks across a table full of phones are
 * not synchronised well enough for a tie to mean anything, and preferring the
 * server keeps every device converging on the same answer rather than each one
 * keeping its own.
 *
 * @template {{teamNumber: number, updatedAt: string}} T
 * @param {T[]} local
 * @param {T[]} remote
 * @returns {T[]}
 */
export function mergeRows(local, remote) {
	const byTeam = new Map(local.map((r) => [r.teamNumber, r]));
	for (const r of remote) {
		const mine = byTeam.get(r.teamNumber);
		if (!mine || String(r.updatedAt) >= String(mine.updatedAt)) byTeam.set(r.teamNumber, r);
	}
	return [...byTeam.values()];
}

/**
 * Rows a device still owes the server: anything edited locally since its last
 * successful push.
 *
 * @template {{updatedAt: string, pushedAt?: string|null}} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function pendingRows(rows) {
	return rows.filter((r) => !r.pushedAt || String(r.updatedAt) > String(r.pushedAt));
}

/**
 * Local rows that somebody else deleted, and that this device should therefore
 * drop too.
 *
 * A pull returns the whole list, so a row that is here and not there was
 * removed by another manager. Without this the deleting manager watches the
 * team disappear and everyone else keeps it — one list disagreeing with itself,
 * which is worse than either answer.
 *
 * Three rows are deliberately NOT deleted:
 *
 *   · Never pushed. The server has never seen it, so its absence says nothing.
 *     Deleting here would silently discard a team added while offline.
 *   · Already tombstoned. Nothing to do.
 *   · Edited since the last push. Delete-versus-edit has no correct answer, but
 *     discarding an edit somebody just made is the worse of the two: they
 *     watched it happen and have no reason to check. Edit wins; the next push
 *     puts the row back, and the other manager can remove it again on purpose.
 *
 * @template {{teamNumber: number, updatedAt: string, pushedAt?: string|null, deleted?: boolean}} T
 * @param {T[]} local
 * @param {Iterable<number>} remoteTeamNumbers
 * @returns {T[]} the subset to tombstone
 */
export function deletedElsewhere(local, remoteTeamNumbers) {
	const remote = new Set(remoteTeamNumbers);
	return local.filter(
		(r) =>
			!r.deleted &&
			Boolean(r.pushedAt) &&
			String(r.updatedAt) <= String(r.pushedAt) &&
			!remote.has(r.teamNumber)
	);
}
