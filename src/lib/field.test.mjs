// Tests for the season field geometry. 2026 — REBUILT.
//   node src/lib/field.test.mjs
//
// The numbers come from FIRST's published dimensions, so some of these
// assertions check the ARITHMETIC — that the derived fractions still match the
// inches in the manual. That is worth pinning: this file is retuned every
// January by someone reading a drawing, and a transposed digit in a fraction is
// invisible while a failing ratio is not.
//
// The rest check the RULES, which do not move when the numbers do: which
// coordinate space things live in, that the alliance perspective inverts, and
// that a robot cannot be parked inside a wall or a HUB.

import {
	DRAWN,
	OBSTACLES,
	FEATURES,
	FIELD_ASPECT,
	FIELD_SEASON,
	HALF_ROBOT_X,
	HALF_ROBOT_Y,
	START_BANDS,
	startZone,
	clampToStart,
	STARTING_LINE,
	mirrorPosition,
	ROBOT_SIZE_IN,
	clampToField,
	toDrawn,
	fromDrawn,
	toScreen,
	fromScreen
} from './field.js';

let pass = 0;
let fail = 0;
function ok(label, cond) {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.error(`FAIL: ${label}`);
	}
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ─── the published numbers ─────────────────────────────────────────────────
{
	ok('this is the 2026 field', FIELD_SEASON === 2026);
	// 54 ft 3 in by 26 ft 3 in.
	ok('the field is 54ft 3in by 26ft 3in', near(FIELD_ASPECT, 651 / 315, 1e-9));

	// The whole field is drawn. `docs/auto-scouting-plan.md` assumed robots are
	// confined to their own half in auto and this was built cut on that basis;
	// the 2026 manual has no such rule. G403 restricts CONTACT past the centre
	// line, not territory. A cut field would have had nowhere to put a robot that
	// crossed, and its path would have flattened against the edge as though it
	// had parked there — recording something false rather than nothing.
	ok('the whole field is drawn', DRAWN.x1 === 1 && DRAWN.y1 === 1);

	// 120in frame perimeter, so a square robot is 30in a side; bumpers add about
	// 3.25in per side. BUMPERS are what the rules measure — G303 places a robot by
	// where its bumpers are — so that is what this measures too.
	ok('a robot is 36.5in across, bumpers included', near(ROBOT_SIZE_IN, 36.5, 1e-9));

	const hubs = OBSTACLES.filter((o) => o.label.includes('hub'));
	ok('there are two HUBs, not one', hubs.length === 2);
	// Each is centred one ALLIANCE ZONE from its OWN wall, and that depth is
	// DERIVED so the three zones tile the field: (651 - 283) / 2 = 184.
	//
	// The manual quotes 158.6 for this, twice, and its own numbers contradict it —
	// 158.6 + 283 + 158.6 = 600.2 against a 651in field, leaving 51in nowhere. The
	// derived figure also matches where the HUB bands sit on the team's field
	// image, at about 0.282 of the field length. Two signals against one, so the
	// quoted number is the one not used.
	ok('the alliance zone tiles the field with the neutral zone',
		near(hubs[0].x * 651, (651 - 283) / 2, 1e-6));
	ok('the near HUB is 184in from this wall', near(hubs[0].x, 184 / 651, 1e-9));
	ok('the far HUB is 184in from the far wall', near(hubs[1].x, (651 - 184) / 651, 1e-9));
	ok('and the quoted 158.6 is NOT what is used', !near(hubs[0].x, 158.6 / 651, 1e-3));
	ok('nothing sits on the centre line',
		!OBSTACLES.some((o) => Math.abs(o.x - 0.5) < o.w / 2));
	// 47in square footprint, with a 41.7in hexagonal opening the drawing shows.
	ok('a HUB is a 47in square', near(hubs[0].w, 47 / 651, 1e-9) && near(hubs[0].h, 47 / 315, 1e-9));
	ok('and it carries its opening for the drawing',
		near(hubs[0].opening, 41.7 / 315, 1e-9));

	// Both ends are furnished, because both ends are reachable.
	ok('the opponent end has its structures too',
		OBSTACLES.filter((o) => o.label.startsWith('far')).length === 2);
	ok('and they mirror the near ones',
		near(hubs[0].x, 1 - hubs[1].x, 1e-9));
}

// ─── BUMPs and TRENCHes are landmarks, not walls ───────────────────────────
{
	// A robot drives OVER a BUMP and UNDER a TRENCH. Treating either as an
	// obstacle would fight the scout on a path that really does cross them, and
	// it is the most natural wrong thing to do when adding them to the picture.
	const obstacleLabels = OBSTACLES.map((o) => o.label);
	ok('a BUMP is not an obstacle', !obstacleLabels.includes('bump'));
	ok('a TRENCH is not an obstacle', !obstacleLabels.includes('trench'));

	const featureLabels = FEATURES.map((f) => f.label);
	ok('but both are drawn', featureLabels.includes('bump') && featureLabels.includes('trench'));
	ok('two BUMPs', FEATURES.filter((f) => f.label === 'bump').length === 2);
	ok('two TRENCHes on this half', FEATURES.filter((f) => f.label === 'trench').length === 2);
	ok('the starting line is drawn', featureLabels.includes('starting line'));

	// HUB + two BUMPs + two TRENCHes fill the width exactly. That sum is the
	// check that this reading of the manual is right, so it is asserted rather
	// than assumed.
	const bumps = FEATURES.filter((f) => f.label === 'bump');
	const trenches = FEATURES.filter((f) => f.label === 'trench');
	const hub = OBSTACLES.find((o) => o.label === 'hub');
	const spanned = hub.h + bumps.reduce((n, b) => n + b.h, 0) + trenches.reduce((n, t) => n + t.h, 0);
	ok(`the lateral elements fill the width exactly (got ${spanned.toFixed(6)})`, near(spanned, 1, 1e-9));
}

// ─── the alliance perspective inverts, and that is the whole of Decision 1 ──
{
	// The plan is explicit: "behind the hub for this season would be considered
	// Middle", named from the perspective of a member of that team. The HUB is
	// centred across the width, so the middle band must contain y = 0.5 for both.
	ok('behind the hub is Middle for red', startZone({ x: 0.2, y: 0.5 }, 'red') === 'Middle');
	ok('behind the hub is Middle for blue', startZone({ x: 0.2, y: 0.5 }, 'blue') === 'Middle');

	// Middle is the HUB's own footprint widened by half a robot, so a robot whose
	// EDGE overlaps the hub's shadow is behind the hub.
	const hub = OBSTACLES.find((o) => o.label === 'hub');
	ok('Middle is the hub footprint plus half a robot each side',
		near(START_BANDS[1].upTo - START_BANDS[0].upTo, hub.h + 2 * HALF_ROBOT_Y, 1e-9));

	// The two teams stand at opposite ends looking at each other, so one physical
	// corner has two names. Storing the LABEL instead of deriving it would freeze
	// one season's vocabulary into every old row.
	ok('one corner is Left to red', startZone({ x: 0.2, y: 0.05 }, 'red') === 'Left');
	ok('and Right to blue', startZone({ x: 0.2, y: 0.05 }, 'blue') === 'Right');
	ok('and the far corner inverts too',
		startZone({ x: 0.2, y: 0.95 }, 'red') === 'Right' &&
			startZone({ x: 0.2, y: 0.95 }, 'blue') === 'Left');

	ok('an unknown alliance falls back to the field orientation',
		startZone({ x: 0.2, y: 0.05 }, null) === 'Left');
	ok('no position is no zone, not a guess', startZone(null, 'red') === null);
}

// ─── a robot cannot be inside a wall ───────────────────────────────────────
{
	const out = clampToField({ x: -5, y: -5 });
	ok('a robot dragged off the near corner stays on the field',
		out.x >= DRAWN.x0 && out.y >= DRAWN.y0);
	ok('with half a robot of margin', out.x >= DRAWN.x0 + HALF_ROBOT_X - 1e-9);

	const far = clampToField({ x: 5, y: 5 });
	ok('and off the far corner', far.x <= DRAWN.x1 && far.y <= DRAWN.y1);
	ok('and it can reach the opponent wall, because auto allows that',
		far.x > 0.9);
}

// ─── a robot cannot be inside a HUB, or the DEPOT ──────────────────────────
{
	const clearOf = (p, o) =>
		Math.abs(p.x - o.x) >= o.w / 2 + HALF_ROBOT_X - 1e-9 ||
		Math.abs(p.y - o.y) >= o.h / 2 + HALF_ROBOT_Y - 1e-9;

	for (const o of OBSTACLES) {
		// Approach from four sides. Each must resolve, and out of the box.
		const from = [
			{ x: o.x - o.w / 4, y: o.y },
			{ x: o.x + o.w / 4, y: o.y },
			{ x: o.x, y: o.y - o.h / 4 },
			{ x: o.x, y: o.y + o.h / 4 },
			{ x: o.x, y: o.y }
		].map(clampToField);
		for (const p of from) {
			ok(`pushed clear of the ${o.label}`, clearOf(p, o));
			ok(`${o.label} resolution stays on the field`,
				Number.isFinite(p.x) && p.x >= DRAWN.x0 && p.x <= DRAWN.x1);
		}
	}

	// The DEPOT is against the alliance wall and the far HUB straddles the cut
	// edge, so for both of them the nearest way out is off the field. Resolving
	// the obstacle and THEN clamping pushed the robot back inside; a version of
	// this file shipped that bug and a test found it.
	const depot = OBSTACLES.find((o) => o.label === 'depot');
	const pushed = clampToField({ x: depot.x, y: depot.y });
	ok('an obstacle on a wall still resolves outward, not into the wall',
		pushed.x > depot.x && clearOf(pushed, depot));

	// A position already clear is left exactly alone. A clamp that nudges valid
	// input would smear a whole path by a few centimetres a sample.
	const clear = { x: 0.45, y: 0.2 };
	const same = clampToField(clear);
	ok('a legal position is untouched', near(same.x, clear.x) && near(same.y, clear.y));
}

// ─── the drawn box is a view, not a coordinate space ───────────────────────
{
	// This is the sharp edge in Decision 1. The picture is cut; the data is not.
	const p = { x: 0.31, y: 0.4 };
	const d = toDrawn(p);
	const back = fromDrawn(d.u, d.v);
	ok('a full-field position round-trips through the drawn box',
		near(back.x, p.x, 1e-9) && near(back.y, p.y, 1e-9));

	ok('the drawn box left edge is u=0', near(toDrawn({ x: DRAWN.x0, y: 0 }).u, 0));
	ok('the drawn box right edge is u=1', near(toDrawn({ x: DRAWN.x1, y: 0 }).u, 1));

	// The picture is the whole field today, so these agree. The separation stays
	// because a season that cuts the drawn region again must not rescale a single
	// stored path — the cut is a property of the picture, not of the data.
	ok('the picture currently spans the whole field',
		near(fromDrawn(0.5, 0.5).x, 0.5, 1e-9));
	ok('the far wall is the far edge', near(toDrawn({ x: 1, y: 0 }).u, 1, 1e-9));
}

// ─── presentation: turning the view around, and standing it on end ─────────
//
// The plan asks for the alliance wall to be movable to either side of the
// screen. The first implementation mirrored v — the axis ACROSS the field —
// which swapped Left and Right and left the wall where it was: the wrong axis,
// applied consistently, so nothing disagreed and none of it was what was asked.
{
	const id = toScreen(0.3, 0.25, {});
	ok('no view options is identity', id.u === 0.3 && id.v === 0.25);

	// Both axes, because a rotation is both. Mirroring u alone would move the
	// wall and REVERSE the scout's left and right — worse than the original bug,
	// because the labels would still look deliberate.
	const f = toScreen(0.3, 0.25, { flipped: true });
	ok('flipping moves the alliance wall to the other side', near(f.u, 0.7));
	ok('and the across-field axis turns with it', near(f.v, 0.75));

	// Handedness is what makes the labels honest. Under a rotation two bands swap
	// places on screen but stay on the same side of each other, so "Left" still
	// names the strip physically on the scout's left.
	ok('flipping preserves the order of the bands',
		toScreen(0.1, 0.2, { flipped: true }).v > toScreen(0.1, 0.8, { flipped: true }).v);

	// A quarter turn puts the long axis down a portrait phone. Clockwise, so the
	// alliance wall ends up at the top — the view a scout has behind their own
	// driver station.
	const r = toScreen(0, 0, { rotated: true });
	ok('rotating puts the near-wall corner at the top right', near(r.u, 1) && near(r.v, 0));
	ok('and the far end of the picture runs down the screen',
		near(toScreen(1, 0, { rotated: true }).v, 1));

	// The inverse is the assertion that matters: it is what puts the robot under
	// the thumb. A quarter turn is NOT self-inverse, and assuming it was would
	// land the robot a quarter of the field away in the one mode that exists to
	// make the thumb more accurate.
	for (const view of [{}, { flipped: true }, { rotated: true }, { flipped: true, rotated: true }]) {
		const name = JSON.stringify(view);
		for (const [u, v] of [[0.25, 0.3], [0, 0], [1, 1], [0.5, 0.5], [0.9, 0.1]]) {
			const sc = toScreen(u, v, view);
			const back = fromScreen(sc.u, sc.v, view);
			ok(`${name} round-trips (${u},${v})`, near(back.u, u, 1e-9) && near(back.v, v, 1e-9));
		}
	}

	// The centre of the picture is every transform's fixed point.
	for (const view of [{ flipped: true }, { rotated: true }, { flipped: true, rotated: true }]) {
		const c = toScreen(0.5, 0.5, view);
		ok(`${JSON.stringify(view)} leaves the centre alone`, near(c.u, 0.5) && near(c.v, 0.5));
	}
}

// ─── where a robot may start ───────────────────────────────────────────────
//
// G303-D: "its BUMPERS overlap their ROBOT STARTING LINE." Not anywhere in the
// alliance zone and not anywhere on the field — straddling one line. Anything
// else is a placement that could not have happened, and a start position is the
// single most-asked question of this whole feature.
{
	const halfRobot = HALF_ROBOT_X;

	// Dragged to the middle of the field, a red robot comes back to the line.
	const red = clampToStart({ x: 0.5, y: 0.3 }, 'red');
	ok('a red start is pulled back to its starting line',
		Math.abs(red.x - STARTING_LINE) <= halfRobot + 1e-9);
	ok('and only its bumpers may overlap, not its centre',
		near(red.x, STARTING_LINE + halfRobot, 1e-6));

	// Blue starts at the other end, and the constraint mirrors with it.
	const blue = clampToStart({ x: 0.5, y: 0.3 }, 'blue');
	ok('a blue start is pulled to the far line',
		Math.abs(blue.x - (1 - STARTING_LINE)) <= halfRobot + 1e-9);
	ok('red and blue start lines mirror', near(red.x, 1 - blue.x, 1e-9));

	// Across the field is unconstrained — the rule is about one line, not a box.
	ok('the across-field position is left alone', near(clampToStart({ x: 0.5, y: 0.12 }, 'red').y, 0.12));

	// A legal start is untouched.
	const legal = { x: STARTING_LINE, y: 0.15 };
	ok('a legal start is not moved',
		near(clampToStart(legal, 'red').x, legal.x, 1e-6));

	// Turning a recording end for end maps one alliance's starting line exactly
	// onto the other's. That is what makes the flip the right correction for a
	// recording made against the wrong alliance: fix the alliance, flip the
	// track, and the start lands back on its own line rather than near it.
	const onRedLine = { x: STARTING_LINE, y: 0.3 };
	const flipped = mirrorPosition(onRedLine);
	ok('a flip lands the start on the other alliance line',
		near(flipped.x, 1 - STARTING_LINE, 1e-9));
	ok('and clampToStart for that alliance leaves it alone',
		near(clampToStart(flipped, 'blue').x, flipped.x, 1e-6));

	// A rotation, so handedness survives and Left does not become Left again.
	ok('the across-field axis turns too', near(flipped.y, 0.7, 1e-9));

	// And it still cannot end up inside a structure.
	//
	// Note what this assertion does NOT say: it passes if EITHER axis clears the
	// hub, so it stayed green the whole time a start was being pushed out of the
	// hub along x — off the starting line and into the neutral zone. It is the
	// right assertion for its own question and the wrong one for the rule, so the
	// rule is asserted separately below.
	const intoHub = clampToStart({ x: STARTING_LINE, y: 0.5 }, 'red');
	const hub = OBSTACLES.find((o) => o.label === 'hub');
	ok('a start cannot be inside the HUB',
		Math.abs(intoHub.x - hub.x) >= hub.w / 2 + HALF_ROBOT_X - 1e-9 ||
			Math.abs(intoHub.y - hub.y) >= hub.h / 2 + HALF_ROBOT_Y - 1e-9);
	ok('and it clears the HUB by sliding ALONG the line, not off it',
		near(intoHub.x, STARTING_LINE, 1e-9) && Math.abs(intoHub.y - 0.5) > 1e-6);
}

// ─── a start is always on the starting line ────────────────────────────────
//
// G303-D is a rule about x and nothing else: the bumpers overlap the ROBOT
// STARTING LINE, so the centre is within half a robot of it. Everywhere else is
// a placement that could not have happened.
//
// Swept rather than sampled, because the failure was not at an edge — the HUB is
// a 47in square CENTRED ON THE LINE, so the whole middle of the field resolved
// out of the band. 391 of 3721 placements landed off the line, up to 23.5in,
// which for blue is 23.5in into the neutral zone in front of the hub.
{
	const insideAny = (p) =>
		OBSTACLES.some(
			(o) =>
				o.kind === 'rect' &&
				Math.abs(p.x - o.x) < o.w / 2 + HALF_ROBOT_X - 1e-9 &&
				Math.abs(p.y - o.y) < o.h / 2 + HALF_ROBOT_Y - 1e-9
		);

	for (const colour of ['red', 'blue']) {
		const line = colour === 'blue' ? 1 - STARTING_LINE : STARTING_LINE;
		const lo = line - HALF_ROBOT_X;
		const hi = line + HALF_ROBOT_X;
		let offLine = 0;
		let inside = 0;
		let outOfBounds = 0;
		for (let i = 0; i <= 60; i += 1) {
			for (let j = 0; j <= 60; j += 1) {
				const p = clampToStart({ x: i / 60, y: j / 60 }, colour);
				if (p.x < lo - 1e-9 || p.x > hi + 1e-9) offLine += 1;
				if (insideAny(p)) inside += 1;
				if (p.y < HALF_ROBOT_Y - 1e-9 || p.y > 1 - HALF_ROBOT_Y + 1e-9) outOfBounds += 1;
			}
		}
		ok(`${colour}: no drag anywhere on the field starts off the line`, offLine === 0,
			`${offLine} of 3721 landed outside [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
		ok(`${colour}: and none of them starts inside a structure`, inside === 0, `${inside} of 3721`);
		ok(`${colour}: and none of them leaves the field`, outOfBounds === 0, `${outOfBounds} of 3721`);
	}
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
