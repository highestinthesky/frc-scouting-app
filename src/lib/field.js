// The field geometry engine. Season-independent.
//
// A season's field is data — inches, rectangles and bands, in
// `seasons/<year>.js`. This file is the arithmetic every season shares: given
// that data, where may a robot be, where may it start, which band is that start
// in, and how does a stored position land on the picture. `makeField()` builds
// one season's answers; `seasons/index.js` calls it, so nothing outside the
// season loader should need to.
//
// Nothing in here names a game. A HUB, a BUMP or a rung belongs to the season
// that has one; the comments below use 2026's to explain WHY a rule is shaped
// the way it is, because that is the field the rule was learned on.
//
// ─── the coordinate system, which is the part that must not change ────────
//
// Fractions of the FULL field. (0,0) is the red alliance wall's left corner as
// drawn; (1,1) is the far corner. x runs red wall → blue wall, y runs across.
//
// The drawn region has been CUT to the auto-legal portion before, and the
// coordinates stayed relative to the full field anyway. Normalising to the cut
// instead would mean a season that cuts differently silently rescales every
// stored path, and red and blue would stop sharing a coordinate space. The cut
// is a property of the picture. It is not a property of the data.

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** A frozen copy of each element, inside a frozen array. */
const frozenCopies = (list) => Object.freeze((list ?? []).map((o) => Object.freeze({ ...o })));

/**
 * One season's field, built from its spec and frozen.
 *
 * @typedef {{
 *   LENGTH_IN: number,
 *   WIDTH_IN: number,
 *   ROBOT_SIZE_IN: number,
 *   FIELD_ASPECT: number,
 *   HALF_ROBOT_X: number,
 *   HALF_ROBOT_Y: number,
 *   DRAWN: Readonly<{x0:number,y0:number,x1:number,y1:number}>,
 *   DRAWN_ASPECT: number,
 *   OBSTACLES: ReadonlyArray<{kind:'rect',label:string,x:number,y:number,w:number,h:number,opening?:number}>,
 *   FEATURES: ReadonlyArray<{kind:'rect'|'line',label:string,look:string,x:number,y?:number,w?:number,h?:number}>,
 *   ALLIANCE_BANDS: ReadonlyArray<{end:'near'|'far',x:number,w:number}>,
 *   START_BANDS: ReadonlyArray<{label:string,upTo:number}>,
 *   STARTING_LINE: number|null,
 *   clampToStart: (pos: {x:number,y:number}, allianceColor: string|null) => {x:number,y:number},
 *   startZone: (pos: {x:number,y:number}|null, allianceColor: string|null) => string|null,
 *   clampToField: (pos: {x:number,y:number}) => {x:number,y:number},
 *   toDrawn: (pos: {x:number,y:number}) => {u:number,v:number},
 *   fromDrawn: (u: number, v: number) => {x:number,y:number}
 * }} Field
 */

/**
 * Build a season's field: its derived fractions, and the functions that close
 * over its obstacles and bands.
 *
 * Positions in the spec are already full-field fractions. Only the margins are
 * derived here — half a robot, the aspect — from `lengthIn`/`widthIn`/`robotIn`,
 * with the same arithmetic a season file uses for its own positions, so the two
 * agree to the last bit.
 *
 * @param {import('./seasons/index.js').SeasonSpec['field']} spec
 * @returns {Field}
 */
export function makeField(spec) {
	const LENGTH_IN = spec.lengthIn;
	const WIDTH_IN = spec.widthIn;
	const ROBOT_SIZE_IN = spec.robotIn;

	/** Length over width. 651 / 315 for 2026. */
	const FIELD_ASPECT = LENGTH_IN / WIDTH_IN;

	const HALF_ROBOT_X = ROBOT_SIZE_IN / 2 / LENGTH_IN;
	const HALF_ROBOT_Y = ROBOT_SIZE_IN / 2 / WIDTH_IN;

	/**
	 * The portion drawn during auto: all of it.
	 *
	 * ─── the plan was wrong about this, and the manual settles it ──────────────
	 *
	 * `docs/auto-scouting-plan.md` says "the field should be cut, as robots can
	 * only enter neutral and alliance regions during auto", and this was built cut
	 * at the opponent's ALLIANCE ZONE on that basis. **There is no such rule in
	 * 2026.** The only thing AUTO restricts about driving is G403 — a ROBOT whose
	 * BUMPERS are completely across the CENTER LINE may not CONTACT an opponent —
	 * which is a restriction on contact, not on territory.
	 *
	 * A cut field is therefore not a convenience, it is a hole: a scout watching a
	 * robot that crossed would have had nowhere on the picture to put it, and the
	 * path would have flattened against the edge as though the robot had parked
	 * there. Recording something false is worse than recording nothing, and this
	 * would have done it silently.
	 *
	 * The cost is a longer, thinner picture — 2.05 rather than 1.55 — which is
	 * worse on a laptop and BETTER on a phone stood on end, where the field's long
	 * axis now matches the screen's almost exactly.
	 *
	 * Fixed for every season rather than read from the spec, for the same reason:
	 * a game whose auto really is confined would still be recorded on the whole
	 * field, because a robot that broke the rule still went somewhere.
	 */
	const DRAWN = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

	/** The drawn box's own aspect ratio, for sizing the SVG viewBox. */
	const DRAWN_ASPECT = ((DRAWN.x1 - DRAWN.x0) * FIELD_ASPECT) / (DRAWN.y1 - DRAWN.y0);

	/**
	 * Where a robot cannot be. Rectangles in full-field fractions, `x`/`y` being
	 * the centre — a recording aid, not a validation rule.
	 */
	const OBSTACLES = frozenCopies(spec.obstacles);

	/** Drawn for orientation, driven straight through. Never collided with. */
	const FEATURES = frozenCopies(spec.features);

	/** Which end of the field belongs to an alliance, as a drawn band. */
	const ALLIANCE_BANDS = frozenCopies(spec.allianceBands);

	/** Start bands across the width, from the alliance's own point of view. */
	const START_BANDS = frozenCopies(spec.startBands);

	/**
	 * Distance from the alliance wall to the furthest a start may be, as a
	 * fraction — in 2026 the ROBOT STARTING LINE. `null` when a season puts no
	 * depth limit on a start, and then a start is anywhere a robot can be.
	 */
	const STARTING_LINE = spec.startDepth ?? null;

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
	function clampToField(pos) {
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
			// obstacle near a boundary reproduces it, and in 2026 two of the three
			// were ON one: the DEPOT is against the alliance wall and the far HUB
			// straddled the edge of the field as it was then cut. So each candidate
			// is bounds-clamped BEFORE it is judged.
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
	 * Constrain a starting position to the robot's own alliance zone: from its
	 * alliance wall out to `startDepth`, plus the half robot a start straddling
	 * that line needs. In 2026 that is G303-D's ROBOT STARTING LINE.
	 *
	 * A season with no `startDepth` constrains a start only as far as any other
	 * position — on the field and out of every obstacle.
	 *
	 * @param {{x:number,y:number}} pos
	 * @param {string|null} allianceColor  which end this robot starts at
	 */
	function clampToStart(pos, allianceColor) {
		if (STARTING_LINE === null) return clampToField(pos);

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
		// Handing the clamped position to clampToField() instead is what shipped:
		// its escape is bounded by the FIELD, so with 2026's HUB centred on the
		// starting line it pushed 391 of 3721 placements clean out of the alliance
		// zone — for blue, up to 23.5in into the neutral zone in front of the hub.
		//
		// It is the same shape as the note in clampToField above, one turn along: a
		// resolution free to move on an axis another rule has already fixed will
		// use it. There the field boundary undid the obstacle escape; here the
		// obstacle escape undid the zone.
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
	function startZone(pos, allianceColor) {
		if (!pos || !Number.isFinite(Number(pos.y))) return null;
		// Red stands at x = 0 looking toward +x; blue stands at the far end looking
		// back. What is on red's left is on blue's right.
		const t = allianceColor === 'blue' ? 1 - clamp(Number(pos.y), 0, 1) : clamp(Number(pos.y), 0, 1);
		for (const band of START_BANDS) if (t <= band.upTo) return band.label;
		return START_BANDS[START_BANDS.length - 1].label;
	}

	/**
	 * Full-field fraction to a point inside the drawn box, and back.
	 *
	 * Two functions rather than one used twice, because getting the inverse subtly
	 * wrong is how a robot ends up rendering a few pixels from where it was tapped
	 * and nobody can say why.
	 */
	function toDrawn(pos) {
		return {
			u: (clamp(Number(pos?.x) || 0, DRAWN.x0, DRAWN.x1) - DRAWN.x0) / (DRAWN.x1 - DRAWN.x0),
			v: (clamp(Number(pos?.y) || 0, DRAWN.y0, DRAWN.y1) - DRAWN.y0) / (DRAWN.y1 - DRAWN.y0)
		};
	}

	function fromDrawn(u, v) {
		return {
			x: DRAWN.x0 + clamp(Number(u) || 0, 0, 1) * (DRAWN.x1 - DRAWN.x0),
			y: DRAWN.y0 + clamp(Number(v) || 0, 0, 1) * (DRAWN.y1 - DRAWN.y0)
		};
	}

	return Object.freeze({
		LENGTH_IN,
		WIDTH_IN,
		ROBOT_SIZE_IN,
		FIELD_ASPECT,
		HALF_ROBOT_X,
		HALF_ROBOT_Y,
		DRAWN,
		DRAWN_ASPECT,
		OBSTACLES,
		FEATURES,
		ALLIANCE_BANDS,
		START_BANDS,
		STARTING_LINE,
		clampToStart,
		startZone,
		clampToField,
		toDrawn,
		fromDrawn
	});
}

// ─── presentation, the same for every season ───────────────────────────────

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
