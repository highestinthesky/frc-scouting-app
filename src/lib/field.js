// The field, as season data. 2026 — REBUILT.
//
// ADR-002 Decision 5: one field per season, checked in beside METRIC_FIELDS,
// with its own version. The January retune ritual gains a step — update the
// geometry, update the action set, update the legal region, bump
// SCHEMA_VERSION.
//
// ─── everything below is derived from FIRST's published dimensions ─────────
//
// Not traced from a field image, and that is the better outcome rather than a
// compromise: the picture and the collision test read the SAME numbers, so they
// cannot drift, which is the whole reason the ADR asked for regions "derived
// from it rather than maintained as a parallel list of rectangles". A trace
// would have put a bitmap on one side of that line and a hand-kept list on the
// other.
//
// Sources, so the next person can check rather than trust:
//   Field Dimension Drawings  https://www.firstinspires.org/resource-library/frc/playing-field
//   Game Manual, ARENA        https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf
//
// ─── what a placeholder got wrong, for the record ──────────────────────────
//
// The first version of this file was a schematic guess, and it was wrong in
// three ways that matter, all of which would have taught scouts a field that
// does not exist:
//
//   - It had ONE obstacle at field centre. There are TWO HUBs, one per alliance,
//     each 158.6in from ITS OWN alliance wall. Nothing is at the centre line.
//   - The HUB is a 47in square, not a circle.
//   - It would have been natural to add the BUMPs and TRENCHes as obstacles.
//     They are not. A robot drives OVER a BUMP and UNDER a TRENCH, so both are
//     landmarks and neither blocks a path.
//
// ─── the coordinate system, which is the part that must not change ────────
//
// Fractions of the FULL field. (0,0) is the red alliance wall's left corner as
// drawn; (1,1) is the far corner. x runs red wall → blue wall, y runs across.
//
// The drawn region is CUT to the auto-legal portion, and the coordinates are
// still relative to the full field anyway. Normalising to the cut instead would
// mean a season that cuts differently silently rescales every stored path, and
// red and blue would stop sharing a coordinate space. The cut is a property of
// the picture. It is not a property of the data.

/** Bump when the geometry moves. Dates the picture; stored on nothing. */
export const FIELD_VERSION = 4;

/** The season this geometry is. Retuned every January, like METRIC_FIELDS. */
export const FIELD_SEASON = 2026;

// ─── inches, exactly as published ──────────────────────────────────────────
//
// Kept in inches and converted once, at the bottom. Fractions are unreadable to
// anyone holding the drawings, and "0.2435" cannot be checked against a manual.

/** Carpet, alliance wall to alliance wall. 54 ft 3 in. */
export const FIELD_LENGTH_IN = 54 * 12 + 3;
/** Carpet, guardrail to guardrail. 26 ft 3 in. */
const FIELD_WIDTH_IN = 26 * 12 + 3;

/** NEUTRAL ZONE depth, between the two ROBOT STARTING LINES. */
const NEUTRAL_ZONE_IN = 283;

// ─── the alliance zone is DERIVED, and that is deliberate ──────────────────
//
// The manual states 158.6in twice — once as the ALLIANCE ZONE depth and once as
// the distance from an ALLIANCE WALL to that alliance's HUB centre. Its own
// numbers contradict it:
//
//     158.6 + 283 + 158.6 = 600.2,  and the field is 651
//
// Fifty-one inches unaccounted for. Deriving the depth instead makes the three
// zones tile the field exactly, and lands on 184.0in — which is where the HUB
// bands sit on the team's own field image, measured at about 0.282 of the field
// length. Two independent signals agree and the quoted figure is the outlier, so
// the quoted figure is the one not used.
//
// If 158.6 turns out to measure something real — a face rather than a centre,
// or a zone that excludes the BUMP band — this is the line to change, and
// nothing else moves with it.
const ALLIANCE_ZONE_IN = (FIELD_LENGTH_IN - NEUTRAL_ZONE_IN) / 2;

/** The HUB: a 47in square, centred on the starting line, one per alliance. */
const HUB_SIZE_IN = 47;
/** Its opening, which is what a top-down view of the field actually shows. */
const HUB_OPENING_IN = 41.7;

/** TOWER: in the ALLIANCE WALL between the driver stations. RUNGs at 27/45/63in. */
const TOWER_WIDTH_IN = 90;
const TOWER_DEPTH_IN = 12;

/** BUMP: driven OVER. 73in wide, 44.4in deep, 6.5in tall. Landmark, not wall. */
const BUMP_WIDTH_IN = 73;
const BUMP_DEPTH_IN = 44.4;

/** TRENCH: driven UNDER. Guardrail to BUMP, on both sides. 47in deep. */
const TRENCH_DEPTH_IN = 47;

/** DEPOT: 42in x 27in, along the alliance wall. */
const DEPOT_WIDTH_IN = 42;
const DEPOT_DEPTH_IN = 27;

// ─── the robot ─────────────────────────────────────────────────────────────
//
// FRAME PERIMETER at most 120in, STARTING CONFIGURATION at most 30in tall. A
// square robot at the limit is 30in a side. Bumpers add roughly 3.25in per side
// — a 3/4in backing, a pool noodle, and fabric — so the thing that actually
// occupies carpet is about 36.5in across.
//
// That is what everything here measures, because BUMPERS are what the rules
// measure: G303 places a robot by where its BUMPERS are, and a robot cannot
// drive its bumpers through a wall.
const FRAME_PERIMETER_IN = 120;
const BUMPER_THICKNESS_IN = 3.25;
/** A square robot at the perimeter limit, with bumpers. 36.5in. */
export const ROBOT_SIZE_IN = FRAME_PERIMETER_IN / 4 + 2 * BUMPER_THICKNESS_IN;
const HALF_ROBOT_IN = ROBOT_SIZE_IN / 2;

// ─── laterally ─────────────────────────────────────────────────────────────
//
// The HUB is centred across the width with a BUMP either side, and the TRENCHes
// run from each guardrail to the outer BUMP edge. That fills the width exactly,
// which is also the check that this reading of the manual is right:
//
//     47 (HUB) + 2 x 73 (BUMPs) + 2 x 62.35 (TRENCHes) = 317.7
//
// The manual gives the TRENCH as 65.65in wide against the 62.35 the layout
// leaves. A 3.3in difference is which face is being measured, so the derived
// number is used — a width that sums is worth more here than one that is quoted.

const MID_W = FIELD_WIDTH_IN / 2;
const HUB_HALF = HUB_SIZE_IN / 2;
const BUMP_OUTER = HUB_HALF + BUMP_WIDTH_IN;

// ─── fractions, derived ────────────────────────────────────────────────────

const fx = (inches) => inches / FIELD_LENGTH_IN;
const fy = (inches) => inches / FIELD_WIDTH_IN;

/** 651.2 / 317.7. */
export const FIELD_ASPECT = FIELD_LENGTH_IN / FIELD_WIDTH_IN;

export const HALF_ROBOT_X = fx(HALF_ROBOT_IN);
export const HALF_ROBOT_Y = fy(HALF_ROBOT_IN);

/**
 * The portion drawn during auto: all of it.
 *
 * ─── the plan was wrong about this, and the manual settles it ──────────────
 *
 * `docs/auto-scouting-plan.md` says "the field should be cut, as robots can only
 * enter neutral and alliance regions during auto", and this was built cut at the
 * opponent's ALLIANCE ZONE on that basis. **There is no such rule in 2026.** The
 * only thing AUTO restricts about driving is G403 — a ROBOT whose BUMPERS are
 * completely across the CENTER LINE may not CONTACT an opponent — which is a
 * restriction on contact, not on territory.
 *
 * A cut field is therefore not a convenience, it is a hole: a scout watching a
 * robot that crossed would have had nowhere on the picture to put it, and the
 * path would have flattened against the edge as though the robot had parked
 * there. Recording something false is worse than recording nothing, and this
 * would have done it silently.
 *
 * The cost is a longer, thinner picture — 2.05 rather than 1.55 — which is worse
 * on a laptop and BETTER on a phone stood on end, where the field's long axis
 * now matches the screen's almost exactly.
 */
export const DRAWN = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

/**
 * Where a robot cannot be.
 *
 * A recording aid, not a validation rule: it keeps a thumb from parking the
 * robot inside the HUB, which is a different thing from rejecting a scout's
 * input. Rectangles in full-field fractions, `x`/`y` being the centre.
 *
 * Both HUBs are here, and both are drawn whole. Each is centred on its own
 * alliance's starting line — which is also why a robot dragged to the middle of
 * a starting line has to slide sideways rather than off it; see clampToStart.
 */
const mirrorX = (o) => ({ ...o, x: 1 - o.x, label: `far ${o.label}` });

/** One alliance's structures, measured from ITS OWN wall. */
const nearSide = [
	{
		kind: 'rect',
		label: 'hub',
		x: fx(ALLIANCE_ZONE_IN),
		y: 0.5,
		w: fx(HUB_SIZE_IN),
		h: fy(HUB_SIZE_IN),
		// The opening is what a top-down view shows inside the square footprint.
		opening: fy(HUB_OPENING_IN)
	},
	{
		kind: 'rect',
		label: 'depot',
		x: fx(DEPOT_DEPTH_IN / 2),
		y: fy(MID_W),
		w: fx(DEPOT_DEPTH_IN),
		h: fy(DEPOT_WIDTH_IN)
	}
];

/**
 * Where a robot cannot be.
 *
 * A recording aid, not a validation rule: it keeps a thumb from parking the
 * robot inside the HUB, which is a different thing from rejecting a scout's
 * input. Rectangles in full-field fractions, `x`/`y` being the centre.
 *
 * Both ends, because the whole field is drawn — a robot that crossed the centre
 * line in auto is doing something legal and has to be recordable where it went.
 */
export const OBSTACLES = Object.freeze([...nearSide, ...nearSide.map(mirrorX)]);

/** One alliance's landmarks. Driven over, driven under, or painted on. */
const nearMarks = [
	{
		kind: 'rect',
		label: 'bump',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy(MID_W - HUB_HALF - BUMP_WIDTH_IN / 2),
		w: fx(BUMP_DEPTH_IN),
		h: fy(BUMP_WIDTH_IN)
	},
	{
		kind: 'rect',
		label: 'bump',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy(MID_W + HUB_HALF + BUMP_WIDTH_IN / 2),
		w: fx(BUMP_DEPTH_IN),
		h: fy(BUMP_WIDTH_IN)
	},
	{
		kind: 'rect',
		label: 'trench',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy((MID_W - BUMP_OUTER) / 2),
		w: fx(TRENCH_DEPTH_IN),
		h: fy(MID_W - BUMP_OUTER)
	},
	{
		kind: 'rect',
		label: 'trench',
		x: fx(ALLIANCE_ZONE_IN),
		y: 1 - fy((MID_W - BUMP_OUTER) / 2),
		w: fx(TRENCH_DEPTH_IN),
		h: fy(MID_W - BUMP_OUTER)
	},
	{
		kind: 'rect',
		label: 'tower',
		x: fx(TOWER_DEPTH_IN / 2),
		y: 0.5,
		w: fx(TOWER_DEPTH_IN),
		h: fy(TOWER_WIDTH_IN)
	},
	{ kind: 'line', label: 'starting line', x: fx(ALLIANCE_ZONE_IN) }
];

/**
 * Drawn for orientation, driven straight through.
 *
 * These are the difference between a grey box and a field a scout recognises,
 * and keeping them OUT of OBSTACLES is the point: a BUMP is driven over and a
 * TRENCH is driven under, so a robot's path crosses both and a collision test
 * that stopped it there would be fighting the scout.
 */
export const FEATURES = Object.freeze([
	...nearMarks,
	...nearMarks.map((m) => (m.kind === 'line' ? { ...m, x: 1 - m.x, label: 'far starting line' } : mirrorX(m))),
	// No FUEL staging area. It was read off the field image, it is not something a
	// robot's position is ever measured against, and a large soft rectangle across
	// the middle of the picture competes with the path being drawn over it.
	{ kind: 'line', label: 'centre line', x: 0.5 }
]);

/**
 * Which end of the field belongs to an alliance, as a drawn band.
 *
 * The team's field image tints the whole BUMP-HUB-BUMP column in the alliance's
 * colour, and it is the single thing that makes the picture readable at a
 * glance: it says which end is yours without a label. Returned as drawn bounds
 * so the renderer does not have to know the geometry.
 */
export const ALLIANCE_BANDS = Object.freeze([
	{ end: 'near', x: fx(ALLIANCE_ZONE_IN), w: fx(BUMP_DEPTH_IN) },
	{ end: 'far', x: 1 - fx(ALLIANCE_ZONE_IN), w: fx(BUMP_DEPTH_IN) }
]);

// ─── where a robot may start ───────────────────────────────────────────────
//
// A start is constrained to the ALLIANCE ZONE — the robot's own end of the
// field, from its alliance wall out to the ROBOT STARTING LINE — and not to the
// line itself.
//
// It was pinned to the line, on a reading of G303-D that treated "its BUMPERS
// overlap their ROBOT STARTING LINE" as the only legal placement. The team says
// otherwise: behind the hub is a real start, and they are the ones who watch
// these matches. The tighter reading made a position a scout had actually seen
// impossible to record.
//
// Which is the same argument this file already makes one paragraph down about
// point E, and it generalises: THIS IS A RECORDING AID, NOT A REFEREE. The
// constraint that earns its place is the one that rules out what could not have
// happened — a robot cannot be inside the HUB, and cannot have started at the
// far end of the field — not the one that enforces a rule the app has only
// inferred. Where the two disagree, the scout saw it and this file did not.
//
// The upper bound keeps half a robot past the line, so a robot straddling it is
// still expressible: that placement is legal and common, and clamping to the
// line exactly would have made it unreachable from the wrong side.
//
// Point E — "it's not contacting the BUMP" — is likewise NOT enforced. The
// lateral BUMP extents here are derived from a width that sums rather than
// measured off a drawing, and hard-blocking a placement on an inferred number
// would fight a scout who watched a robot start somewhere this file is wrong
// about. The BUMPs are drawn; a scout can see them.

/** Distance from the alliance wall to the ROBOT STARTING LINE, as a fraction. */
export const STARTING_LINE = fx(ALLIANCE_ZONE_IN);

/**
 * Constrain a starting position to where G303-D allows one.
 *
 * @param {{x:number,y:number}} pos
 * @param {string|null} allianceColor  which end this robot starts at
 */
export function clampToStart(pos, allianceColor) {
	const line = allianceColor === 'blue' ? 1 - STARTING_LINE : STARTING_LINE;

	// The alliance zone, plus the half robot that a start ON the line needs.
	const [xLo, xHi] =
		allianceColor === 'blue'
			? [line - HALF_ROBOT_X, DRAWN.x1 - HALF_ROBOT_X]
			: [DRAWN.x0 + HALF_ROBOT_X, line + HALF_ROBOT_X];
	const yLo = DRAWN.y0 + HALF_ROBOT_Y;
	const yHi = DRAWN.y1 - HALF_ROBOT_Y;
	const inZone = (p) => ({ x: clamp(p.x, xLo, xHi), y: clamp(p.y, yLo, yHi) });

	let out = inZone({ x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 });

	// Resolve inside the zone, never by leaving it.
	//
	// Handing the clamped position to clampToField() instead is what shipped: its
	// escape is bounded by the FIELD, so with the HUB centred on the starting
	// line it pushed 391 of 3721 placements clean out of the alliance zone — for
	// blue, up to 23.5in into the neutral zone in front of the hub.
	//
	// It is the same shape as the note in clampToField below, one turn along: a
	// resolution free to move on an axis another rule has already fixed will use
	// it. There the field boundary undid the obstacle escape; here the obstacle
	// escape undid the zone.
	for (const o of OBSTACLES) {
		if (o.kind !== 'rect') continue;
		const hw = o.w / 2 + HALF_ROBOT_X;
		const hh = o.h / 2 + HALF_ROBOT_Y;
		if (Math.abs(out.x - o.x) >= hw - 1e-9 || Math.abs(out.y - o.y) >= hh - 1e-9) continue;

		let best = null;
		for (const c of [
			{ x: o.x - hw, y: out.y },
			{ x: o.x + hw, y: out.y },
			{ x: out.x, y: o.y - hh },
			{ x: out.x, y: o.y + hh }
		]) {
			// Zone-clamped BEFORE it is judged, or a candidate that only escapes by
			// leaving the zone is chosen and then dragged back inside the obstacle.
			const p = inZone(c);
			if (Math.abs(p.x - o.x) < hw - 1e-9 && Math.abs(p.y - o.y) < hh - 1e-9) continue;
			const cost = Math.hypot(p.x - out.x, (p.y - out.y) / FIELD_ASPECT);
			if (!best || cost < best.cost) best = { p, cost };
		}
		// Every way out blocked means the geometry leaves no room here. Leaving the
		// position where the scout put it beats teleporting it somewhere arbitrary.
		if (best) out = best.p;
	}

	return out;
}

/**
 * Start bands, named from the perspective of a member of that alliance.
 *
 * The plan is explicit about both the perspective and the anchor: "behind the
 * hub for this season would be considered Middle". So Middle is the HUB's own
 * lateral footprint, widened by half a robot on each side — a robot overlapping
 * the hub's shadow is behind the hub. Left and Right are what remains, and they
 * land almost exactly on the BUMP/TRENCH boundaries, which is the same thing a
 * driver would say out loud.
 *
 * Derived rather than picked, so moving the HUB moves the bands with it.
 */
const MIDDLE_HALF = fy(HUB_HALF + HALF_ROBOT_IN);

export const START_BANDS = Object.freeze([
	{ label: 'Left', upTo: 0.5 - MIDDLE_HALF },
	{ label: 'Middle', upTo: 0.5 + MIDDLE_HALF },
	{ label: 'Right', upTo: 1 }
]);

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Which start band a position falls in, from that alliance's point of view.
 *
 * This is Decision 1 doing its job: storage is field-absolute, and the
 * alliance-relative answer is derived at display time by one subtraction. The
 * alternative — storing the label — freezes one season's vocabulary into every
 * old row and makes a renamed band a migration.
 *
 * @param {{x:number,y:number}|null} pos  full-field fractions
 * @param {string|null} allianceColor     'red' | 'blue'
 * @returns {string|null}
 */
export function startZone(pos, allianceColor) {
	if (!pos || !Number.isFinite(Number(pos.y))) return null;
	// Red stands at x = 0 looking toward +x; blue stands at the far end looking
	// back. What is on red's left is on blue's right.
	const t = allianceColor === 'blue' ? 1 - clamp(Number(pos.y), 0, 1) : clamp(Number(pos.y), 0, 1);
	for (const band of START_BANDS) if (t <= band.upTo) return band.label;
	return START_BANDS[START_BANDS.length - 1].label;
}

/**
 * Push a position out of anything it is inside, and inside the field.
 *
 * The plan: "Robots should not be able to clip into the walls or the center
 * hub." Applied to the robot's CENTRE with half a robot of margin, because that
 * is what the scout is dragging.
 *
 * @param {{x:number,y:number}} pos
 * @returns {{x:number,y:number}}
 */
export function clampToField(pos) {
	const inBounds = (p) => ({
		x: clamp(p.x, DRAWN.x0 + HALF_ROBOT_X, DRAWN.x1 - HALF_ROBOT_X),
		y: clamp(p.y, DRAWN.y0 + HALF_ROBOT_Y, DRAWN.y1 - HALF_ROBOT_Y)
	});

	/** Half-extents of the keep-out box: the obstacle, grown by half a robot. */
	const keepOut = (o) => ({ hw: o.w / 2 + HALF_ROBOT_X, hh: o.h / 2 + HALF_ROBOT_Y });
	const inside = (p, o) => {
		const { hw, hh } = keepOut(o);
		return Math.abs(p.x - o.x) < hw - 1e-9 && Math.abs(p.y - o.y) < hh - 1e-9;
	};

	let out = inBounds({ x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 });

	for (const o of OBSTACLES) {
		if (o.kind !== 'rect' || !inside(out, o)) continue;
		const { hw, hh } = keepOut(o);

		// Four ways out of a box; take the nearest that is still on the field.
		//
		// Resolving the obstacle and THEN clamping to the field is what the first
		// version did, and the wall pushed the robot straight back inside. Any
		// obstacle near a boundary reproduces it, and here two of the three are ON
		// one: the DEPOT is against the alliance wall and the far HUB straddles the
		// cut edge. So each candidate is bounds-clamped BEFORE it is judged.
		const candidates = [
			{ x: o.x - hw, y: out.y },
			{ x: o.x + hw, y: out.y },
			{ x: out.x, y: o.y - hh },
			{ x: out.x, y: o.y + hh }
		];

		let best = null;
		for (const c of candidates) {
			const p = inBounds(c);
			if (inside(p, o)) continue;
			// Measured in x-fraction units with y scaled in, so a diagonal cost is
			// not distorted by the field being twice as long as it is wide.
			const cost = Math.hypot(p.x - out.x, (p.y - out.y) / FIELD_ASPECT);
			if (!best || cost < best.cost) best = { p, cost };
		}
		// Every way out blocked means the geometry leaves no room for a robot
		// here. Leaving the position where the scout put it beats teleporting it
		// somewhere arbitrary — this is a recording aid, not a validation rule.
		if (best) out = best.p;
	}

	return out;
}

/**
 * Full-field fraction to a point inside the drawn box, and back.
 *
 * Two functions rather than one used twice, because getting the inverse subtly
 * wrong is how a robot ends up rendering a few pixels from where it was tapped
 * and nobody can say why.
 */
export function toDrawn(pos) {
	return {
		u: (clamp(Number(pos?.x) || 0, DRAWN.x0, DRAWN.x1) - DRAWN.x0) / (DRAWN.x1 - DRAWN.x0),
		v: (clamp(Number(pos?.y) || 0, DRAWN.y0, DRAWN.y1) - DRAWN.y0) / (DRAWN.y1 - DRAWN.y0)
	};
}

export function fromDrawn(u, v) {
	return {
		x: DRAWN.x0 + clamp(Number(u) || 0, 0, 1) * (DRAWN.x1 - DRAWN.x0),
		y: DRAWN.y0 + clamp(Number(v) || 0, 0, 1) * (DRAWN.y1 - DRAWN.y0)
	};
}

/** The drawn box's own aspect ratio, for sizing the SVG viewBox. */
export const DRAWN_ASPECT = ((DRAWN.x1 - DRAWN.x0) * FIELD_ASPECT) / (DRAWN.y1 - DRAWN.y0);

/**
 * Turn a recorded position end for end, about the centre of the FIELD.
 *
 * This is the display flip applied to the DATA, and it exists for one mistake:
 * a scout who read the picture as though their alliance were at the other end
 * records a whole track 180° from the truth. Every position is wrong, and
 * nothing about the result looks wrong — it is a plausible auto, at the wrong
 * end of the field.
 *
 * A rotation and not a mirror, for the same reason `toScreen` uses one: a
 * reflection would change handedness, so a robot that went to its left would
 * come back having gone to its right, and the correction would introduce a
 * second error while fixing the first.
 *
 * In FIELD coordinates, deliberately. `toScreen` works in the drawn box, and
 * the drawn box is the whole field today but has already been cut once. What is
 * being corrected here is where the robot was, not how it was drawn.
 *
 * @param {{x:number,y:number}} pos
 */
export function mirrorPosition(pos) {
	return {
		x: 1 - clamp(Number(pos?.x) || 0, 0, 1),
		y: 1 - clamp(Number(pos?.y) || 0, 0, 1)
	};
}

/**
 * Drawn-box coordinates to screen coordinates.
 *
 * Two independent transforms, both purely about how the picture is presented.
 * Neither touches a stored coordinate — Decision 1's field-absolute storage is
 * what makes both of them one line instead of a second saved format.
 *
 * ─── `flipped`: which end the alliance wall is at ───────────────────────────
 *
 * The plan asks for it: "whether the on-screen field has the alliance field to
 * the left or right, for their positioning."
 *
 * It is a ROTATION, not a mirror, and that distinction is the whole thing. The
 * first version mirrored v — the axis ACROSS the field — which swapped the Left
 * and Right bands and left the alliance wall exactly where it was: the wrong
 * axis, applied consistently, so everything agreed and none of it was what the
 * scout wanted. Mirroring u instead would move the wall and REVERSE the scout's
 * left and right, because a reflection changes handedness — worse, because the
 * labels would still look deliberate. Turning 180° moves the wall AND keeps
 * Left on the left, which is what physically happens when you walk to the other
 * end of the field.
 *
 * ─── `rotated`: the field's long axis runs down a portrait screen ──────────
 *
 * The field is half again as wide as it is tall, so on a phone held upright it
 * is width-bound and most of the screen is empty: full screen bought 2% and
 * left 607px of unused height. Turning the picture a quarter turn puts the long
 * axis down the long axis of the phone, which is the difference between a
 * 366px field and a 390x605 one — about seven times the area to aim a thumb at.
 *
 * Clockwise, so the alliance wall ends up at the TOP. A scout looking down at
 * their own end is the same view they have standing behind the driver station.
 *
 * ─── and it happens in DRAWN space, not field space ─────────────────────────
 *
 * The drawn region is cut at 0.756, so `x -> 1 - x` in field coordinates would
 * slide the visible window off to the far end and show the opponent's half. All
 * of this is about the centre of the PICTURE.
 *
 * @param {number} u  0..1 across the drawn box
 * @param {number} v  0..1 down the drawn box
 * @param {{flipped?: boolean, rotated?: boolean}} [view]
 * @returns {{u: number, v: number}} 0..1 across and down the SCREEN box
 */
export function toScreen(u, v, view = {}) {
	const a = view.flipped ? 1 - u : u;
	const b = view.flipped ? 1 - v : v;
	return view.rotated ? { u: 1 - b, v: a } : { u: a, v: b };
}

/**
 * Screen coordinates back to the drawn box.
 *
 * Written as its own function rather than reusing toScreen, because it is only
 * self-inverse when `rotated` is false — a quarter turn is not. Assuming
 * otherwise puts the robot a quarter of the field from the thumb, in the one
 * mode that exists to make the thumb more accurate.
 *
 * @param {number} su
 * @param {number} sv
 * @param {{flipped?: boolean, rotated?: boolean}} [view]
 */
export function fromScreen(su, sv, view = {}) {
	const a = view.rotated ? sv : su;
	const b = view.rotated ? 1 - su : sv;
	return view.flipped ? { u: 1 - a, v: 1 - b } : { u: a, v: b };
}
