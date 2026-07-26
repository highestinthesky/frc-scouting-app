// Auto-assign: distribute every team at the event across the available scouts.
//
// Lives in its own module, with no Svelte or Supabase imports, so it can be
// unit-tested with plain node. `assignments.js` re-exports it.
//
// ─── why this is a graph-colouring problem ─────────────────────────────────
//
// A scout watches one robot per match. Six robots play. So if a scout owns two
// teams that meet in Q17, one of them goes unscouted — there is no way to be in
// two places at once.
//
// Build a graph where every team is a vertex and two teams share an edge if
// they ever play the same match. Assigning teams to scouts so that no scout
// holds two teams that meet is *exactly* graph colouring, with one colour per
// scout. That reframing matters, because it tells us two things the old greedy
// implementation had no way to know:
//
//   1. Every match is a 6-clique, so the graph's chromatic number is at least
//      six. With fewer than six scouts a conflict-free assignment does not
//      exist — no algorithm can find one, and the honest ceiling is
//      scouts/6 of all team-matches. The UI should say so rather than
//      implying a better run might fix it.
//
//   2. Above six scouts a good colouring usually exists, but plain greedy
//      most-constrained-first finds a poor one. DSATUR — pick the vertex with
//      the most distinctly-coloured neighbours next — is the standard
//      improvement and lifts real coverage roughly 8-10 points.
//
// Colouring alone still plateaus below full coverage, because a team's
// opponents change every match and one team-level decision has to serve all
// twelve of its matches. The fix is the second pass: once base assignments are
// set, walk the schedule and hand each leftover clash to a scout who is idle in
// that specific match, emitting an `assignment_overrides` row. That reaches
// full coverage on every event shape we simulated, and it needs no schema
// change — the overrides table already exists and already wins over the base
// assignment during resolution.

/** @param {object} m TBA match object */
function teamsIn(m) {
	const out = [];
	for (const arr of [m?.alliances?.red?.team_keys, m?.alliances?.blue?.team_keys]) {
		for (const k of arr ?? []) {
			const n = parseInt(String(k).replace(/^frc/, ''), 10);
			if (Number.isFinite(n)) out.push(n);
		}
	}
	return out;
}

/**
 * Distribute every team playing at the event across the given scouts.
 *
 * @param {object[]} qmList      qual matches (from qualMatches())
 * @param {string[]} scoutNames  non-empty scout names
 * @param {{generateOverrides?: boolean}} [opts]
 * @returns {{
 *   assignments: Map<string, number[]>,
 *   overrides: {match_number: number, scout_name: string, team_number: number}[],
 *   teamCount: number,
 *   scoutCount: number,
 *   baseClashes: number,
 *   coverage: {scouted: number, total: number, pct: number},
 *   ceiling: {pct: number, limited: boolean}
 * }}
 */
export function autoAssignTeams(qmList, scoutNames, opts = {}) {
	const generateOverrides = opts.generateOverrides !== false;
	const names = [
		...new Set((scoutNames ?? []).map((n) => String(n ?? '').trim()).filter(Boolean))
	];
	const empty = {
		assignments: new Map(),
		overrides: [],
		teamCount: 0,
		scoutCount: names.length,
		baseClashes: 0,
		coverage: { scouted: 0, total: 0, pct: 0 },
		ceiling: { pct: 0, limited: false }
	};
	if (names.length === 0 || !Array.isArray(qmList) || qmList.length === 0) return empty;

	// ── build the conflict graph ──────────────────────────────────────────
	/** team → Set<match_number> */
	const teamMatches = new Map();
	/** team → Set<team> it has ever shared a match with */
	const adj = new Map();
	for (const m of qmList) {
		const six = teamsIn(m);
		for (const t of six) {
			if (!teamMatches.has(t)) teamMatches.set(t, new Set());
			if (!adj.has(t)) adj.set(t, new Set());
			teamMatches.get(t).add(m.match_number);
		}
		for (const a of six) for (const b of six) if (a !== b) adj.get(a).add(b);
	}
	const teams = [...adj.keys()];

	// ── pass 1: DSATUR colouring, balanced ────────────────────────────────
	/** team → scout */
	const owner = new Map();
	const load = new Map(names.map((n) => [n, 0]));
	/** scout → Set<match_number> they already have a robot in */
	const busyIn = new Map(names.map((n) => [n, new Set()]));

	const clashCount = (scout, team) => {
		let c = 0;
		for (const mn of teamMatches.get(team)) if (busyIn.get(scout).has(mn)) c += 1;
		return c;
	};

	let baseClashes = 0;
	for (let step = 0; step < teams.length; step++) {
		// Highest saturation first (most distinct scouts already among its
		// opponents), breaking ties on degree, then team number so a given
		// schedule always produces the same assignment.
		let pickTeam = null;
		let bestSat = -1;
		let bestDeg = -1;
		for (const t of teams) {
			if (owner.has(t)) continue;
			const sat = new Set();
			for (const nb of adj.get(t)) if (owner.has(nb)) sat.add(owner.get(nb));
			const deg = adj.get(t).size;
			if (
				sat.size > bestSat ||
				(sat.size === bestSat && deg > bestDeg) ||
				(sat.size === bestSat && deg === bestDeg && (pickTeam === null || t < pickTeam))
			) {
				pickTeam = t;
				bestSat = sat.size;
				bestDeg = deg;
			}
		}

		// Lightest workload first, then fewest new clashes.
		//
		// Ordering these the other way round — clashes first — buys a few points
		// of base-only coverage but hands one scout six teams while another
		// carries three. Since the second pass takes coverage to the ceiling
		// either way, the clash saving is worth nothing and the imbalance is
		// worth avoiding: a scout with twice the teams is a real person having a
		// worse weekend. Load-first keeps every workload within one team of
		// every other.
		const ranked = [...names].sort(
			(a, b) =>
				load.get(a) - load.get(b) ||
				clashCount(a, pickTeam) - clashCount(b, pickTeam) ||
				a.localeCompare(b)
		);
		const scout = ranked[0];
		baseClashes += clashCount(scout, pickTeam);
		owner.set(pickTeam, scout);
		load.set(scout, load.get(scout) + 1);
		for (const mn of teamMatches.get(pickTeam)) busyIn.get(scout).add(mn);
	}

	// ── pass 2: per-match repair via overrides ────────────────────────────
	// Colouring is a compromise across all of a team's matches. This pass looks
	// at one match at a time, where the right answer is unambiguous: six robots,
	// hand each to a different person.
	const overrides = [];
	if (generateOverrides) {
		for (const m of qmList) {
			const six = teamsIn(m);
			/** scout → teams of theirs playing in THIS match */
			const mine = new Map();
			for (const t of six) {
				const s = owner.get(t);
				if (!s) continue;
				if (!mine.has(s)) mine.set(s, []);
				mine.get(s).push(t);
			}
			// Everyone with nothing to watch in this match is available.
			const idle = names.filter((n) => !mine.has(n));
			if (idle.length === 0) continue;
			// A scout keeps their lowest-numbered team and sheds the rest, so the
			// choice is stable rather than dependent on schedule ordering.
			const orphaned = [];
			for (const [, ts] of mine) {
				ts.sort((a, b) => a - b);
				for (const t of ts.slice(1)) orphaned.push(t);
			}
			for (const t of six) if (!owner.get(t)) orphaned.push(t);
			orphaned.sort((a, b) => a - b);
			for (const t of orphaned) {
				const s = idle.shift();
				if (!s) break;
				overrides.push({ match_number: m.match_number, scout_name: s, team_number: t });
			}
		}
	}

	const assignments = new Map(names.map((n) => [n, []]));
	for (const [t, s] of owner) assignments.get(s).push(t);
	for (const [, list] of assignments) list.sort((a, b) => a - b);

	const coverage = evaluateCoverage(qmList, assignments, overrides);
	const ceilingPct = (Math.min(names.length, 6) / 6) * 100;

	return {
		assignments,
		overrides,
		teamCount: teams.length,
		scoutCount: names.length,
		baseClashes,
		coverage,
		ceiling: { pct: ceilingPct, limited: names.length < 6 }
	};
}

/**
 * How many (match, team) cells does this plan actually get eyes on?
 *
 * The honest measure, and deliberately not the same as counting clashes: a
 * scout holding three teams in one match contributes one scouted cell, not
 * three. Overrides win over the base assignment, matching resolveTeamsForMatch.
 *
 * @param {object[]} qmList
 * @param {Map<string, number[]>} assignments
 * @param {{match_number: number, scout_name: string, team_number: number}[]} [overrides]
 * @returns {{scouted: number, total: number, pct: number}}
 */
export function evaluateCoverage(qmList, assignments, overrides = []) {
	const owner = new Map();
	for (const [scout, list] of assignments ?? []) for (const t of list) owner.set(t, scout);
	const byCell = new Map();
	for (const o of overrides ?? []) {
		byCell.set(`${o.match_number}:${o.team_number}`, o.scout_name);
	}
	let total = 0;
	let scouted = 0;
	for (const m of qmList ?? []) {
		const taken = new Set();
		for (const t of teamsIn(m)) {
			total += 1;
			const s = byCell.get(`${m.match_number}:${t}`) ?? owner.get(t);
			if (s && !taken.has(s)) {
				taken.add(s);
				scouted += 1;
			}
		}
	}
	return { scouted, total, pct: total === 0 ? 0 : (scouted / total) * 100 };
}
