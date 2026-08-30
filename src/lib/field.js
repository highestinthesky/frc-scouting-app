// The field, as season data.
//
// ADR-002 Decision 5: one field per season, checked in beside METRIC_FIELDS,
// with its own version. The January retune ritual gains a step — update the
// geometry, update the action set, update the legal region, bump
// SCHEMA_VERSION.
//
// ─── this geometry is a PLACEHOLDER and is meant to be replaced ────────────
//
// It is a schematic of the 2026 field drawn from measurements, not a traced
// game manual. It is correct in the things the recorder depends on — the aspect
// ratio, an auto-legal region that is a sub-rectangle of the full field, a
// central obstacle, and three start bands — and it is a guess about where the
// lines actually are. Replacing it is editing the numbers below.
//
// ─── why the drawing is derived from data rather than a checked-in SVG ─────
//
// The ADR asks for an SVG so the regions can be derived from it "rather than
// maintained as a parallel list of rectangles that drifts". That is the right
// instinct pointed one level down: what must not drift is the geometry, and the
// way to guarantee that is for the picture and the collision test to read the
// SAME numbers. When a traced field image arrives it replaces `render()` and
// keeps `LEGAL`/`OBSTACLES`, which is the half the recorder actually uses.
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

/** Bump when the geometry moves. Stored on nothing — it dates the picture. */
export const FIELD_VERSION = 1;

/** 16.54 m by 8.21 m. Only the ratio matters here. */
export const FIELD_ASPECT = 16.54 / 8.21;

/**
 * The portion drawn during auto, in full-field fractions.
 *
 * A robot can only reach its own alliance zone and the neutral zone in auto, so
 * showing the whole field wastes the half of the screen a thumb has to cross.
 *
 * The right edge has to leave a robot's width clear PAST the hub, or there is a
 * band of field a robot cannot legally occupy and dragging into it snaps the
 * robot backwards. At 0.62 that band existed and a test found it.
 */
export const DRAWN = Object.freeze({ x0: 0, y0: 0, x1: 0.68, y1: 1 });

/**
 * Where a robot cannot be.
 *
 * A recording aid, not a validation rule: it keeps a thumb from parking the
 * robot inside the hub, which is a different thing from rejecting a scout's
 * input. Everything is in full-field fractions.
 */
export const OBSTACLES = Object.freeze([
	{ kind: 'circle', label: 'hub', cx: 0.5, cy: 0.5, r: 0.075 }
]);

/**
 * How far from the field edge a robot's CENTRE can be, as a fraction. Half a
 * robot: 0.9 m of a 16.54 m field on x, of an 8.21 m field on y.
 */
export const HALF_ROBOT_X = 0.45 / 16.54;
export const HALF_ROBOT_Y = 0.45 / 8.21;

/**
 * Start bands, named from the perspective of a member of that alliance.
 *
 * The plan is explicit about the perspective: "behind the hub for this season
 * would be considered Middle". The hub is at the centre, so the middle band has
 * to contain y = 0.5, and the names have to swap between alliances — the two
 * teams are standing at opposite ends looking at each other.
 */
export const START_BANDS = Object.freeze([
	{ label: 'Left', upTo: 1 / 3 },
	{ label: 'Middle', upTo: 2 / 3 },
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
 * Resolution is radial for a circle — the shortest way out — rather than
 * snapping to an axis, which would make a robot dragged across the hub jump
 * sideways instead of sliding around it.
 *
 * @param {{x:number,y:number}} pos
 * @returns {{x:number,y:number}}
 */
export function clampToField(pos) {
	const inBounds = (p) => ({
		x: clamp(p.x, DRAWN.x0 + HALF_ROBOT_X, DRAWN.x1 - HALF_ROBOT_X),
		y: clamp(p.y, DRAWN.y0 + HALF_ROBOT_Y, DRAWN.y1 - HALF_ROBOT_Y)
	});
	// Distances are measured in the x fraction's units with y scaled into them:
	// the field is not square, so a circle in fractional coordinates is an
	// ellipse on screen and the hub would otherwise repel from the wrong shape.
	const gap = (p, o) => Math.hypot(p.x - o.cx, (p.y - o.cy) / FIELD_ASPECT);
	const clearOf = (p, o) => gap(p, o) >= o.r + HALF_ROBOT_X - 1e-9;

	let out = inBounds({ x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 });

	for (const o of OBSTACLES) {
		if (o.kind !== 'circle' || clearOf(out, o)) continue;
		const need = o.r + HALF_ROBOT_X;
		const dx = out.x - o.cx;
		const dy = (out.y - o.cy) / FIELD_ASPECT;
		const d = Math.hypot(dx, dy);

		// Candidates, nearest first. Radial is the shortest way out and is what
		// makes a robot dragged across the hub slide around it rather than snap to
		// an axis. The rest exist because the shortest way out can land in a wall:
		// resolving the obstacle and THEN clamping to the field pushed the robot
		// straight back inside, which is a defect any obstacle near a boundary
		// reproduces — it is not specific to this placeholder geometry.
		const dirs = [];
		if (d > 1e-6) dirs.push([dx / d, dy / d], [-dx / d, -dy / d]);
		dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);

		let best = null;
		for (const [ux, uy] of dirs) {
			const c = inBounds({ x: o.cx + ux * need, y: o.cy + uy * need * FIELD_ASPECT });
			if (!clearOf(c, o)) continue;
			const cost = Math.hypot(c.x - out.x, (c.y - out.y) / FIELD_ASPECT);
			if (!best || cost < best.cost) best = { c, cost };
		}
		// Every direction blocked means the geometry has no room for a robot here
		// at all. Leaving the position where the scout put it beats teleporting it
		// somewhere arbitrary — this is a recording aid, not a validation rule.
		if (best) out = best.c;
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
export const DRAWN_ASPECT =
	((DRAWN.x1 - DRAWN.x0) * FIELD_ASPECT) / (DRAWN.y1 - DRAWN.y0);

/**
 * Mirror a position for display when the scout has put their alliance on the
 * right instead of the left.
 *
 * A display transform and nothing else — the plan asks for the toggle, and
 * Decision 1 is what makes it one subtraction rather than a second stored
 * format. Stored coordinates never change.
 */
export function orient(pos, flipped) {
	if (!flipped) return pos;
	return { x: pos.x, y: 1 - pos.y };
}
