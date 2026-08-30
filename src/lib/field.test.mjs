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
	// 651.2in by 317.7in.
	ok('the field is 651.2 by 317.7 inches', near(FIELD_ASPECT, 651.2 / 317.7, 1e-9));

	// A robot may not enter the opponent's ALLIANCE ZONE in auto, and that zone is
	// 158.6in deep, so the picture stops 158.6in short of the far wall.
	ok('the cut is the opponent alliance zone', near(DRAWN.x1, (651.2 - 158.6) / 651.2, 1e-9));

	const hubs = OBSTACLES.filter((o) => o.label.includes('hub'));
	ok('there are two HUBs, not one', hubs.length === 2);
	// Each is centred 158.6in from ITS OWN alliance wall. Nothing is at the
	// centre line — the placeholder that preceded this put one obstacle there.
	ok('the near HUB is 158.6in from this wall', near(hubs[0].x, 158.6 / 651.2, 1e-9));
	ok('the far HUB is 158.6in from the far wall', near(hubs[1].x, (651.2 - 158.6) / 651.2, 1e-9));
	ok('nothing sits on the centre line',
		!OBSTACLES.some((o) => Math.abs(o.x - 0.5) < o.w / 2));
	// 47in square.
	ok('a HUB is a 47in square', near(hubs[0].w, 47 / 651.2, 1e-9) && near(hubs[0].h, 47 / 317.7, 1e-9));

	// The far HUB straddles the cut, so half of it is reachable and it must be
	// drawn and collided with rather than clipped away.
	ok('the far HUB straddles the cut edge',
		hubs[1].x - hubs[1].w / 2 < DRAWN.x1 && hubs[1].x + hubs[1].w / 2 > DRAWN.x1);
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
	ok('the cut is the boundary, not the full field', far.x < 1);
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

	// The cut is 76% of the field, so the middle of the PICTURE is not the middle
	// of the FIELD. Confusing the two is the bug this separation exists to stop.
	ok('the centre of the picture is not the centre of the field',
		!near(fromDrawn(0.5, 0.5).x, 0.5, 0.01));
	// And specifically: the centre line sits past the middle of the picture.
	ok('the centre line is right of the picture centre', toDrawn({ x: 0.5, y: 0.5 }).u > 0.5);
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

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
