// Tests for the season field geometry.
//   node src/lib/field.test.mjs
//
// The geometry itself is a placeholder and will be replaced with a traced field.
// These assertions are about the RULES, which do not move when the numbers do:
// which coordinate space things live in, that the alliance perspective inverts,
// and that a robot cannot be parked inside a wall or the hub.

import {
	DRAWN,
	OBSTACLES,
	FIELD_ASPECT,
	HALF_ROBOT_X,
	startZone,
	clampToField,
	toDrawn,
	fromDrawn,
	orient
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

// ─── the alliance perspective inverts, and that is the whole of Decision 1 ──
{
	// The plan is explicit: "behind the hub for this season would be considered
	// Middle", named from the perspective of a member of that team. The hub is at
	// the centre, so the middle band must contain y = 0.5 for both alliances.
	ok('the hub line is Middle for red', startZone({ x: 0.1, y: 0.5 }, 'red') === 'Middle');
	ok('the hub line is Middle for blue', startZone({ x: 0.1, y: 0.5 }, 'blue') === 'Middle');

	// The two teams stand at opposite ends looking at each other, so one physical
	// corner has two names. Storing the LABEL instead of deriving it would freeze
	// one season's vocabulary into every old row.
	ok('one corner is Left to red', startZone({ x: 0.1, y: 0.05 }, 'red') === 'Left');
	ok('and Right to blue', startZone({ x: 0.1, y: 0.05 }, 'blue') === 'Right');
	ok('and the far corner inverts too',
		startZone({ x: 0.1, y: 0.95 }, 'red') === 'Right' &&
			startZone({ x: 0.1, y: 0.95 }, 'blue') === 'Left');

	ok('an unknown alliance falls back to the field orientation',
		startZone({ x: 0.1, y: 0.05 }, null) === 'Left');
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

	// The drawn region is CUT, so the right edge is the cut and not the far wall.
	ok('the cut is the boundary, not the full field', far.x < 1);
}

// ─── a robot cannot be inside the hub ──────────────────────────────────────
{
	const hub = OBSTACLES.find((o) => o.label === 'hub');
	const dist = (p) => Math.hypot(p.x - hub.cx, (p.y - hub.cy) / FIELD_ASPECT);

	// Approaching from four sides must resolve to four different places — that is
	// what makes it a slide around the obstacle rather than a snap to one axis.
	const from = [
		{ x: hub.cx - 0.02, y: hub.cy },
		{ x: hub.cx + 0.02, y: hub.cy },
		{ x: hub.cx, y: hub.cy - 0.02 },
		{ x: hub.cx, y: hub.cy + 0.02 }
	].map(clampToField);

	for (const p of from) {
		ok('pushed clear of the hub', dist(p) >= hub.r + HALF_ROBOT_X - 1e-6);
	}
	ok('the shortest way out is taken, not one fixed axis',
		new Set(from.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size === 4);

	// Dead centre has no shortest direction. It must not divide by zero.
	const centre = clampToField({ x: hub.cx, y: hub.cy });
	ok('dead centre resolves rather than producing NaN',
		Number.isFinite(centre.x) && Number.isFinite(centre.y));
	ok('and ends up clear', dist(centre) >= hub.r + HALF_ROBOT_X - 1e-6);

	// A position already clear is left exactly alone. A clamp that nudges valid
	// input would smear a whole path by a few centimetres a sample.
	const clear = { x: DRAWN.x0 + 0.1, y: 0.2 };
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

	// The cut is 62% of the field, so the middle of the PICTURE is not the middle
	// of the FIELD. Confusing the two is the bug this separation exists to stop.
	ok('the centre of the picture is not the centre of the field',
		!near(fromDrawn(0.5, 0.5).x, 0.5, 0.01));
}

// ─── orientation is display only ───────────────────────────────────────────
{
	const p = { x: 0.3, y: 0.25 };
	ok('unflipped is identity', orient(p, false).y === 0.25);
	ok('flipped mirrors across the long axis', near(orient(p, true).y, 0.75));
	ok('flipping twice is identity', near(orient(orient(p, true), true).y, 0.25));
	ok('and x never moves — the alliance walls do not swap', orient(p, true).x === 0.3);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
