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

import { scoutRef, rowScout } from './scout-identity.js';

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
 * @param {{
 *   generateOverrides?: boolean,
 *   current?: Map<string, number[]>|Record<string, number[]>
 * }} [opts]  `current` = the assignments already in place. Supplying it makes
 *            the run incremental: existing scouts keep their teams and only
 *            what must move, moves.
 * @returns {{
 *   assignments: Map<string, number[]>,
 *   overrides: {match_number: number, scout_name: string, team_number: number}[],
 *   teamCount: number,
 *   scoutCount: number,
 *   baseClashes: number,
 *   coverage: {scouted: number, total: number, pct: number},
 *   ceiling: {pct: number, limited: boolean},
 *   churn: {moved: number, kept: number, incremental: boolean}
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
		ceiling: { pct: 0, limited: false },
		churn: { moved: 0, kept: 0, incremental: false }
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

	// ── who holds what already ────────────────────────────────────────────
	//
	// Re-running auto-assign mid-event used to redistribute everything: one
	// scout goes home and all forty teams change hands, so every remaining
	// scout gets a new list between matches. That is worse than the gap it
	// closes. When the caller passes the current assignments, keep them and
	// move only what has to move.
	const held = new Map();
	if (opts.current) {
		const entries =
			opts.current instanceof Map ? [...opts.current] : Object.entries(opts.current ?? {});
		const playing = new Set(teams);
		for (const [rawName, list] of entries) {
			const scout = String(rawName ?? '').trim();
			// A scout who has left keeps nothing — their teams become orphans.
			if (!names.includes(scout)) continue;
			for (const t of list ?? []) {
				const team = Number(t);
				// A team that no longer plays here is not carried forward.
				if (playing.has(team) && !held.has(team)) held.set(team, scout);
			}
		}
	}
	const incremental = held.size > 0;

	// ── pass 1: assignment ────────────────────────────────────────────────
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
	const give = (team, scout) => {
		owner.set(team, scout);
		load.set(scout, load.get(scout) + 1);
		for (const mn of teamMatches.get(team)) busyIn.get(scout).add(mn);
	};

	// Seed from what is already in place, then shed only from scouts carrying
	// more than their share. Fair share is a ceiling, not a target: taking a
	// team off someone who is merely at the average would be churn for its own
	// sake.
	const cap = Math.ceil(teams.length / names.length);
	if (incremental) {
		const byScout = new Map(names.map((n) => [n, []]));
		for (const [team, scout] of held) byScout.get(scout).push(team);
		for (const [scout, list] of byScout) {
			// Keep the teams that clash least with each other, so shedding also
			// improves this scout's own coverage rather than picking at random.
			list.sort((a, b) => a - b);
			for (const team of list.slice(0, cap)) give(team, scout);
		}
	}

	const unplaced = teams.filter((t) => !owner.has(t));

	let baseClashes = 0;
	for (let step = 0; step < unplaced.length; step++) {
		// DSATUR: highest saturation first (most distinct scouts already among
		// its opponents), tie-broken on degree, then team number so a given
		// schedule always produces the same plan.
		let pickTeam = null;
		let bestSat = -1;
		let bestDeg = -1;
		for (const t of unplaced) {
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
		if (pickTeam === null) break;

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
		give(pickTeam, scout);
	}

	// ── balance pass ──────────────────────────────────────────────────────
	//
	// Shedding down to the ceiling is the minimum-churn move, but it can leave
	// a gap: nine scouts holding five teams each and a tenth who just arrived
	// holding three, because only three teams were over the ceiling to shed.
	// Closing that costs one transfer per step, which is cheap compared to
	// letting one person carry 40% less than everyone else all weekend.
	//
	// Moves the single team that clashes most with its current holder's
	// remaining set, so each transfer also improves that scout's own coverage
	// rather than picking arbitrarily.
	{
		const listFor = (scout) => teams.filter((t) => owner.get(t) === scout);
		// Bounded: every iteration strictly reduces the spread, and the loop
		// guard is belt and braces against a pathological input.
		for (let guard = 0; guard < teams.length; guard++) {
			const sorted = [...names].sort((a, b) => load.get(a) - load.get(b) || a.localeCompare(b));
			const lightest = sorted[0];
			const heaviest = sorted[sorted.length - 1];
			if (load.get(heaviest) - load.get(lightest) <= 1) break;

			const candidates = listFor(heaviest);
			if (candidates.length === 0) break;
			// Which of their teams costs them the most to keep?
			let move = candidates[0];
			let worst = -1;
			for (const t of candidates) {
				let overlap = 0;
				for (const other of candidates) {
					if (other === t) continue;
					for (const mn of teamMatches.get(t)) if (teamMatches.get(other).has(mn)) overlap += 1;
				}
				if (overlap > worst || (overlap === worst && t < move)) {
					worst = overlap;
					move = t;
				}
			}

			owner.delete(move);
			load.set(heaviest, load.get(heaviest) - 1);
			// busyIn is a union across the scout's teams, so it can't be undone
			// incrementally — rebuild this one scout's set from what they hold.
			const rebuilt = new Set();
			for (const t of listFor(heaviest)) for (const mn of teamMatches.get(t)) rebuilt.add(mn);
			busyIn.set(heaviest, rebuilt);

			give(move, lightest);
		}
	}

	// ── pass 2: per-match repair via overrides ────────────────────────────
	//
	// Colouring is a compromise across all of a team's matches. This pass looks
	// at one match at a time, where the right answer is unambiguous: six robots,
	// hand each to a different person.
	//
	// The subtlety that matters, and that a first version of this got wrong:
	// an override row does not add a team to a scout, it REPLACES that scout's
	// whole list for that match (see resolveMyTeams in tba.js). So handing a shed
	// team to an idle scout is only half the job — without a matching row
	// pinning the original scout to what they kept, they are still told to
	// watch both robots and the clash survives in exactly the place the fix
	// was supposed to remove it.
	//
	// So: compute the intended lineup for the match, then write rows for every
	// scout whose intended list differs from their base list.
	const overrides = [];
	if (generateOverrides) {
		for (const m of qmList) {
			const six = teamsIn(m);

			/** scout → their base teams playing in THIS match */
			const base = new Map();
			for (const t of six) {
				const s = owner.get(t);
				if (!s) continue;
				if (!base.has(s)) base.set(s, []);
				base.get(s).push(t);
			}
			for (const [, ts] of base) ts.sort((a, b) => a - b);

			/** scout → who they should actually watch here */
			const intended = new Map([...base].map(([s, ts]) => [s, [...ts]]));
			const idle = names.filter((n) => !base.has(n));

			// Teams nobody owns come first — an unwatched robot is worse than a
			// doubled-up one, since the doubled scout still records something.
			const orphans = six.filter((t) => !owner.get(t)).sort((a, b) => a - b);
			for (const [s, ts] of intended) {
				if (ts.length > 1) orphans.push(...ts.slice(1));
			}

			for (const t of orphans) {
				const taker = idle.shift();
				// Nobody free: the original scout keeps it and the clash is real.
				// Coverage check will show it, and it means "you need more people".
				if (!taker) continue;
				// Remove it from whoever held it, then give it to the free scout.
				for (const [s, ts] of intended) {
					const at = ts.indexOf(t);
					if (at !== -1) ts.splice(at, 1);
				}
				intended.set(taker, [t]);
			}

			// Write rows only where the plan differs from the base assignment.
			for (const [s, ts] of intended) {
				const was = base.get(s) ?? [];
				const same = was.length === ts.length && was.every((t, i) => t === ts[i]);
				if (same) continue;
				for (const t of ts) {
					overrides.push({ match_number: m.match_number, scout_name: s, team_number: t });
				}
			}
		}
	}

	const assignments = new Map(names.map((n) => [n, []]));
	for (const [t, s] of owner) assignments.get(s).push(t);
	for (const [, list] of assignments) list.sort((a, b) => a - b);

	const coverage = evaluateCoverage(qmList, assignments, overrides);
	const ceilingPct = (Math.min(names.length, 6) / 6) * 100;

	// How disruptive was this run? A manager re-running mid-event cares about
	// exactly one number: how many scouts are about to be handed a new list.
	let kept = 0;
	for (const [team, scout] of held) if (owner.get(team) === scout) kept += 1;

	return {
		assignments,
		overrides,
		teamCount: teams.length,
		scoutCount: names.length,
		baseClashes,
		coverage,
		ceiling: { pct: ceilingPct, limited: names.length < 6 },
		churn: { moved: teams.length - kept, kept, incremental }
	};
}

/**
 * How many robots does this plan actually get eyes on?
 *
 * Resolution here must mirror resolveMyTeams() in tba.js exactly, per
 * (match, scout):
 * if a scout has ANY override row for a match, those rows replace their base
 * list for that match; otherwise their base list applies. Resolving per
 * (match, team) instead — asking "who owns this robot" rather than "what is
 * this person watching" — reads plausibly and is wrong, because it can't see a
 * scout who has been left holding two teams. That mistake is what let a broken
 * repair pass report full coverage.
 *
 * A scout with two teams in one match covers one of them; the other is lost.
 *
 * @param {object[]} qmList
 * @param {Map<string, number[]>} assignments
 * @param {{match_number: number, scout_name: string, team_number: number}[]} [overrides]
 * @returns {{scouted: number, total: number, pct: number, conflicts: number}}
 */
export function evaluateCoverage(qmList, assignments, overrides = []) {
	/** scout → base teams */
	const baseOf = new Map();
	for (const [scout, list] of assignments ?? []) baseOf.set(scout, list ?? []);

	/** `match:scout` → Set<team> */
	const ovBy = new Map();
	for (const o of overrides ?? []) {
		const k = `${o.match_number}:${rowScout(o).key}`;
		if (!ovBy.has(k)) ovBy.set(k, new Set());
		ovBy.get(k).add(Number(o.team_number));
	}

	let total = 0;
	let scouted = 0;
	let conflicts = 0;
	for (const m of qmList ?? []) {
		const playing = new Set(teamsIn(m));
		total += playing.size;
		const watched = new Set();
		for (const [scout, base] of baseOf) {
			const ov = ovBy.get(`${m.match_number}:${scoutRef(scout).key}`);
			const effective =
				ov && ov.size > 0
					? [...ov].filter((t) => playing.has(t))
					: base.filter((t) => playing.has(t));
			if (effective.length === 0) continue;
			if (effective.length > 1) conflicts += 1;
			// One person, one robot: whichever they'd watch first.
			watched.add([...effective].sort((a, b) => a - b)[0]);
		}
		scouted += watched.size;
	}
	return { scouted, total, pct: total === 0 ? 0 : (scouted / total) * 100, conflicts };
}
