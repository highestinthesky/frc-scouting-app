<script>
	// The field, the robots on it, and the three things you can do with them.
	//
	//   mode="record"   drag one robot for fifteen seconds
	//   mode="review"   scrub back through what you just drew and look at it
	//   mode="replay"   watch six recordings at once
	//
	// Only "record" accepts a drag, and that is a rule about who is allowed to
	// invent a position. See `draggable` below.
	//
	// ─── why one component and not three ───────────────────────────────────────
	//
	// ADR-002 Decision 6: "The correction pass and the manager's replay are the
	// same renderer. That is not a coincidence to exploit later; it is the reason
	// both can be in one release." A track that its own scout can scrub and play
	// back IS the component the eagle's-eye view needs, pointed at six tracks
	// instead of one.
	//
	// Splitting them would have meant two implementations of the same
	// interpolation, and the one thing worse than a replay that is a
	// reconstruction is two reconstructions that disagree.
	//
	// ─── pointer events, not touch events ──────────────────────────────────────
	//
	// One code path for a thumb, a mouse and a stylus, which is what the plan asks
	// for ("either on their phone or computer"). setPointerCapture is what keeps a
	// drag alive when the thumb slides off the SVG — without it a scout who
	// overshoots the field edge drops the robot mid-recording.
	import {
		DRAWN,
		DRAWN_ASPECT,
		ROBOT_SIZE_IN,
		FIELD_LENGTH_IN,
		OBSTACLES,
		FEATURES,
		ALLIANCE_BANDS,
		START_BANDS,
		clampToField,
		toDrawn,
		fromDrawn,
		toScreen,
		fromScreen
	} from '$lib/field.js';
	import { ACTIONS, CLIMB_LEVELS, positionAt, marksAt, trackDuration } from '$lib/auto-track.js';

	/**
	 * @type {{
	 *   mode?: 'record'|'review'|'replay',
	 *   tracks?: Array<{track: object, label: string, colour?: string, offset?: number}>,
	 *   position?: {x:number,y:number}|null,
	 *   trail?: Array<{x:number,y:number}>,
	 *   t?: number,
	 *   flipped?: boolean,
	 *   rotated?: boolean,
	 *   active?: Array<{a: string, lvl?: number, ok?: boolean}>,
	 *   onmove?: (pos: {x:number,y:number}) => void
	 * }}
	 */
	let {
		mode = 'replay',
		tracks = [],
		position = null,
		trail = [],
		t = 0,
		flipped = false,
		rotated = false,
		active = [],
		onmove
	} = $props();

	// The viewBox is in DRAWN units scaled to the picture's own aspect, so every
	// coordinate below is a straight multiply and nothing has to remember which
	// space it is in.
	const LONG = 1000;
	const SHORT = Math.round(LONG / DRAWN_ASPECT);
	// A quarter turn swaps the box, so every coordinate below is still a straight
	// multiply and nothing has to remember which way up it is.
	const VB_W = $derived(rotated ? SHORT : LONG);
	const VB_H = $derived(rotated ? LONG : SHORT);
	const view = $derived({ flipped, rotated });

	// The robot is drawn at its real size.
	//
	// It was a fixed 48 units against a picture that has changed width twice,
	// which made it about 70% of a real robot on the cut field and would have
	// been a different wrong size on this one. A scout judging whether a robot
	// fits between the HUB and a BUMP is reading this square, so it has to be the
	// square the rules describe: 110in of frame perimeter plus bumpers, 34in.
	const ROBOT = (ROBOT_SIZE_IN / FIELD_LENGTH_IN) * LONG;
	const HALF_BOT = ROBOT / 2;

	/**
	 * Full-field position to a point in the viewBox, honouring the flip.
	 *
	 * The rotation is applied in DRAWN space, after toDrawn. Everything on the
	 * field goes through here, which is what makes "the whole picture turns
	 * together" true by construction rather than by remembering to flip each
	 * layer.
	 */
	function place(pos) {
		if (!pos) return null;
		const d = toDrawn(pos);
		const o = toScreen(d.u, d.v, view);
		return { cx: o.u * VB_W, cy: o.v * VB_H };
	}

	/** The same, for a point already in drawn coordinates. */
	function placeDrawn(u, v) {
		const o = toScreen(u, v, view);
		return { cx: o.u * VB_W, cy: o.v * VB_H };
	}

	/**
	 * An axis-aligned rectangle in field fractions, as a viewBox box.
	 *
	 * The flip is applied to the CENTRE and the size is unchanged, because
	 * mirroring is a reflection and a rectangle is symmetric about its own centre
	 * — flipping the corners instead produces a negative height, which SVG drops
	 * silently and which is how a field ends up missing its landmarks.
	 */
	function box(o) {
		const c = place({ x: o.x, y: o.y });
		// Extents are measured along the DRAWN axes, so a quarter turn swaps which
		// screen axis each one lands on. Getting this wrong draws the hub as a
		// long thin slab and nothing errors.
		const along = (o.w / (DRAWN.x1 - DRAWN.x0)) * LONG;
		const across = (o.h / (DRAWN.y1 - DRAWN.y0)) * SHORT;
		const w = rotated ? across : along;
		const h = rotated ? along : across;
		return { x: c.cx - w / 2, y: c.cy - h / 2, w, h, label: o.label };
	}

	const solids = $derived(
		OBSTACLES.filter((o) => o.kind === 'rect').map((o) => {
			const b = box(o);
			// The HUB's hexagonal opening, drawn inside its square footprint —
			// which is what the field actually looks like from above, and what makes
			// it recognisable rather than just another rectangle.
			if (!o.opening) return b;
			const r = (o.opening / (DRAWN.y1 - DRAWN.y0)) * SHORT / 2;
			const c = place({ x: o.x, y: o.y });
			const pts = [];
			for (let i = 0; i < 6; i += 1) {
				const a = (Math.PI / 3) * i - Math.PI / 6;
				pts.push(`${(c.cx + r * Math.cos(a)).toFixed(1)},${(c.cy + r * Math.sin(a)).toFixed(1)}`);
			}
			return { ...b, hex: pts.join(' ') };
		})
	);

	// Each end tinted with the alliance that OWNS it, which is a fact about the
	// field and not about who is looking at it.
	//
	// This used to be `own` / `opp` — the end's relationship to the scout — while
	// the stylesheet painted `own` red and `opp` blue. Those two only agree for a
	// red scout. A blue scout got their own end painted red and the opponent's
	// painted blue: both ends wrong, on the one graphic whose entire job is
	// saying which end is which, and it looked deliberate.
	//
	// `field.js` is unambiguous about the convention — "Red stands at x = 0
	// looking toward +x; blue stands at the far end" — and `clampToStart()` and
	// `startZone()` both already derive from it. So near is red and far is blue,
	// full stop — which is why this component no longer takes an allianceColor
	// at all. Where the robot may START is alliance-dependent and belongs to
	// clampToStart(); what colour an end of the field is, is not.
	//
	// It is no longer gated on having picked an alliance either. The old guard
	// was right for the old meaning: with nobody recorded, "yours" is a guess. It
	// is not a guess that the red end is red, and drawing it before the alliance
	// is chosen is what lets a scout orient the picture in the first place.
	const bands = $derived.by(() =>
		ALLIANCE_BANDS.map((b) => ({
			...box({ x: b.x, y: 0.5, w: b.w, h: 1 }),
			tone: b.end === 'near' ? 'red' : 'blue'
		}))
	);
	const marks = $derived(FEATURES.filter((f) => f.kind === 'rect').map(box));
	const lines = $derived(
		FEATURES.filter((f) => f.kind === 'line').map((f) => {
			const u = toDrawn({ x: f.x, y: 0 }).u;
			return { ...segment(u, 0, u, 1), label: f.label };
		})
	);

	// Band lines are drawn from the SAME numbers the classifier reads, so a
	// renamed or moved band cannot disagree with the label a manager is shown.
	// Lines are drawn between two PLACED endpoints rather than as a constant on
	// one axis. That is what makes them turn with everything else: a band edge is
	// horizontal in one orientation and vertical in the other, and there is no
	// branch here that has to know which.
	const segment = (u0, v0, u1, v1) => {
		const a = placeDrawn(u0, v0);
		const b = placeDrawn(u1, v1);
		return { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
	};

	const bandLines = $derived(
		START_BANDS.slice(0, -1).map((b) => ({ ...segment(0, b.upTo, 1, b.upTo), label: b.label }))
	);

	// Band labels start clear of whatever is against the near wall.
	//
	// Centred in their band they sat exactly where the DEPOT is drawn — both are
	// centred across the width — and "Middle" rendered as "ODLE". Anchoring to
	// the top of the band left one pixel of overlap, which is the kind of fix
	// that comes back the moment a band moves. So they clear the wall furniture
	// HORIZONTALLY instead, computed from the widest thing touching x = 0 rather
	// than from a number that happens to work today.
	// How far along the drawn box the labels sit: clear of whatever is against the
	// near wall. Expressed as a DRAWN fraction rather than a pixel offset, so it
	// survives the box being turned on its side.
	const labelAlong = Math.max(
		0.02,
		...OBSTACLES.filter((o) => o.kind === 'rect' && o.x - o.w / 2 <= DRAWN.x0 + 1e-9).map(
			(o) => (o.x + o.w / 2) / (DRAWN.x1 - DRAWN.x0) + 0.02
		)
	);
	// Anchored away from the wall, whichever side the wall ended up on. Rotated,
	// the wall is at the top and the labels read across, so they centre instead.
	const labelAnchor = $derived(rotated ? 'middle' : flipped ? 'end' : 'start');

	// The NAME never changes under a rotation — that is the point of using one.
	// "Left" is still the scout's left; it is drawn at the other side of the
	// picture, next to the alliance wall, which has also moved.
	// The NAME never changes under any of these transforms — that is the point of
	// using rotations rather than mirrors. "Left" is still the scout's left; it is
	// simply drawn somewhere else, next to the alliance wall, which has moved too.
	const bandLabels = $derived(
		START_BANDS.map((b, i) => {
			const lo = i === 0 ? 0 : START_BANDS[i - 1].upTo;
			const mid = (lo + b.upTo) / 2;
			const p = placeDrawn(labelAlong, mid);
			return { x: p.cx, y: p.cy, label: b.label };
		})
	);

	/**
	 * How far past its own end a robot may be before it is drawn as finished.
	 *
	 * Alignment is on first movement, not on a shared clock, so six tracks of the
	 * same match legitimately end up to a second apart. Anything under this is a
	 * difference in when scouts pressed a button, not in what the robots did.
	 */
	const DONE_GRACE_MS = 1000;

	/** Where each replayed robot is right now, with its own alignment offset. */
	const ghosts = $derived(
		mode === 'replay'
			? tracks
					.map((row) => {
						const local = t - (row.offset ?? 0);
						const pos = positionAt(row.track, local);
						if (!pos) return null;
						return {
							...place(pos),
							label: row.label,
							colour: row.colour ?? '',
							// A climb outlives its own recording.
							//
							// Once a robot starts climbing it is on the tower for the rest
							// of auto — that is why the mark runs to the whistle and why the
							// recorder stops asking the scout to track it. So past the end
							// of this robot's track the climb keeps showing, while nothing
							// else does: a collect that happened to be open at the whistle
							// makes no claim about the seconds after it, and a climb does.
							doing:
								local > trackDuration(row.track)
									? marksAt(row.track, trackDuration(row.track)).filter(
											(m) => m.a === 'climb'
										)
									: marksAt(row.track, local),
							// Past its own end, a robot is drawn faded rather than removed:
							// disappearing reads as "it left the field", which is a claim the
							// recording does not make.
							//
							// But not the instant it ends. Six scouts start their timers by
							// hand and the replay aligns them on first movement, so tracks
							// finish tenths of a second apart for reasons that have nothing
							// to do with the robots — and a robot greying out while its
							// neighbours keep going reads as "this one stopped", which is
							// exactly the wrong thing to say about a clock difference.
							// A robot is only faded once it is clearly, visibly finished.
							done: local > trackDuration(row.track) + DONE_GRACE_MS
						};
					})
					.filter(Boolean)
			: []
	);

	const path = $derived.by(() => {
		const pts = trail.map(place).filter(Boolean);
		if (pts.length < 2) return '';
		return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
	});

	// ─── what the robot is DOING, drawn on the robot ───────────────────────────
	//
	// The field used to say only THAT something was happening: a stroke round the
	// rect in replay, a pulse while recording. Which is the half of the question
	// nobody asks. A manager watching six robots needs to see the collect and the
	// score, because the gap between them IS the cycle.
	//
	// A chip above the robot rather than a fill on it. The rect's colour is
	// already carrying the alliance in replay, its middle is already carrying the
	// team number, and its POSITION is the recorded data — the one thing nothing
	// may sit on top of.
	//
	// Colour is the second signal, never the first: the glyphs are a mirrored
	// pair (an arrow into the robot, an arrow out of it) because at fifteen
	// screen pixels a reversal reads and a hue does not. `fault` is --warning to
	// agree with the action rail the scout holds, so there is one mapping to
	// learn rather than two.
	//
	// Every pairing here is already in check_contrast's table at 4.5 across all
	// four palettes — the chip is --bg-card and the glyphs are --accent,
	// --success and --warning, which are measured against it. That is why the
	// chip is neutral with coloured ink and not a coloured fill: an --on-success
	// token does not exist, and inventing one would mean four new assertions to
	// keep true forever.
	// Sized for the PHONE, which is the tightest case: full screen and turned a
	// quarter, the field draws at about 0.62 screen pixels per viewBox unit, so a
	// radius of 15 was a 19px disc holding a 9px glyph — present, and unreadable.
	// 20 puts it at 25px with a 17px glyph, which is legible at arm's length. It
	// is deliberately wider than the 56-unit robot when two are shown: what the
	// robot is doing is the thing being read, and the robot's own square is
	// already carrying its colour and its number.
	const BADGE_R = 20;
	const BADGE_GAP = 5;
	/**
	 * How much of the disc the glyph spans.
	 *
	 * The source icons already carry their own margin inside the 256 box — the
	 * ladder runs 42..120 of 256 — so this is clear space on top of that, not
	 * instead of it. 0.86 measured legible at the phone size; smaller and the
	 * climb numerals close up.
	 */
	const GLYPH_FILL = 0.86;

	/**
	 * The icons, in their own 256x256 space.
	 *
	 * Taken verbatim from `icons/robot-action-icons/svg/` — the path data is the
	 * designer's, and it is drawn at its native size and placed with a single
	 * transform rather than re-traced into chip units. Re-tracing is how a set of
	 * icons stops matching the file it came from.
	 *
	 * Two things are deliberately NOT verbatim. The colours are stripped: the
	 * source hardcodes #111827, #DC2626 and white, which are three literals that
	 * would be invisible in dark mode and outside every contrast guarantee this
	 * app holds. They are re-applied from tokens in CSS below. And the geometry
	 * is grouped by ROLE — outline, solid, warning, mark — so the stylesheet has
	 * something to colour.
	 *
	 * The climb set is nine icons expressing two independent facts: a ladder or a
	 * warning triangle for whether it came off, and a numeral for which rung. The
	 * two cases the set does not cover are the ones where the rung is unknown,
	 * which is a real answer here — so `LADDER` and the small warning are
	 * composed for those rather than picking a numeral nobody recorded.
	 */
	const ICON_BOX = 256;

	/** The ladder, shared by every made climb. */
	const LADDER = 'M58 44V212M104 44V212 M42 64H120M42 108H120M42 152H120M42 196H120';

	/**
	 * The right slot: a numeral, or the question mark for a rung nobody read.
	 *
	 * `ladder-question` and `warning-question` were drawn for exactly this, which
	 * is better than the centred-ladder composition they replace — an absence now
	 * has a mark of its own instead of being drawn by leaving something out, and
	 * a scout reading the chip is told the rung is unknown rather than left to
	 * infer it from the icon being narrower.
	 */
	const RUNG_UNKNOWN =
		'M175.6 148.7C175.6 130.9 183.1 123.8 193.3 116.1C201.2 110.1 205.5 105.6 205.5 98.6C205.5 90.7 200.2 86 191.8 86C182.3 86 176.3 92.4 175.7 104.1H147.8C148.7 76.7 164.9 61 192.9 61C219.3 61 234 75.4 234 97.4C234 113.3 226.2 122.6 214.5 131.4C205.7 138 201.9 142.5 201.9 152.7V157.5H175.6V148.7ZM174.1 176.4C174.1 167.8 180.7 161.3 189.8 161.3C198.9 161.3 205.5 167.8 205.5 176.4C205.5 185.1 198.9 191.5 189.8 191.5C180.7 191.5 174.1 185.1 174.1 176.4Z';

	/** The numerals, as the designer drew them. */
	const RUNG = {
		1: 'M172.8 188V91.2L149.2 105.4V80.6L174.9 64H200.7V188H172.8Z',
		2: 'M146 188V166.5L184.2 127.2C192.5 118.6 196.7 110.9 196.7 104C196.7 97.7 193 93.4 186.4 93.4C179.4 93.4 175 98.2 174.5 108.1H146.5C147.1 78.7 162.9 62 188.1 62C212.2 62 225 77 225 101.1C225 116.8 217.4 129.9 202.2 145.4L184.8 163H226V188H146Z',
		3: 'M145 148H172C172.6 159.5 177.2 165.6 186.7 165.6C195.1 165.6 199.8 160.5 199.8 152.8C199.8 143.5 194.2 139.6 182.2 139.6H174.6V117.7H182.8C193.2 117.7 198.2 113.5 198.2 105.7C198.2 98.3 193.8 93.8 186.4 93.8C178.2 93.8 173.8 99.2 173.2 109.2H146.4C147 79.8 163.6 62 187.4 62C211.5 62 225 77.1 225 98.8C225 113.4 218 123.4 207 128.4C220 133.3 227.4 144.2 227.4 158.6C227.4 180 211.6 191 187 191C160.8 191 145.6 175.5 145 148Z'
	};
	/** Rung 3 is drawn 3 units high in the source; keep its own nudge. */
	const RUNG_SHIFT = { 1: 0, 2: 0, 3: -3 };

	/** The small warning triangle that replaces the ladder on a failed climb. */
	const WARN_SMALL = {
		tri: 'M69.1 60C73.9 49.5 86.1 49.5 90.9 60L140.7 173.6C144.5 182.1 138.4 188 129.1 188H30.9C21.6 188 15.5 182.1 19.3 173.6L69.1 60Z',
		bar: 'M80 91V139',
		dot: { cx: 80, cy: 162, r: 7 },
		barWidth: 12
	};

	/**
	 * Which icon a mark draws.
	 *
	 * The climb is the only one with variants, and they are exactly the two
	 * questions the recorder asks. `ok === false` is a failed climb; `ok`
	 * absent is a climb nobody judged and draws as a plain one — NOT as a failed
	 * one, which is the blank-is-not-zero line this file keeps.
	 */
	function iconFor(mark) {
		if (mark?.a !== 'climb') return { kind: mark?.a ?? 'collect' };
		const lvl = CLIMB_LEVELS.includes(Number(mark.lvl)) ? Number(mark.lvl) : null;
		return { kind: 'climb', lvl, failed: mark.ok === false };
	}

	const GLYPH_LABEL = {
		collect: 'Collecting',
		score: 'Scoring',
		fault: 'Malfunction'
	};

	/**
	 * What a chip announces.
	 *
	 * A climb is named by WHEN IT BEGAN rather than by a span, because the span is
	 * not a fact about the robot — it always runs to the whistle. "Began climbing
	 * at 12.7s" is the observation; "12.7 to 15.0s" is that observation plus the
	 * length of the recording, which says nothing.
	 */
	function markLabel(mark) {
		if (mark?.a !== 'climb') return GLYPH_LABEL[mark?.a] ?? '';
		const at = Number.isFinite(Number(mark.t0))
			? ` at ${(Number(mark.t0) / 1000).toFixed(1)}s`
			: '';
		const lvl = CLIMB_LEVELS.includes(Number(mark.lvl))
			? `, rung ${Number(mark.lvl)}`
			: ', rung not recorded';
		const out = mark.ok === true ? ', made it' : mark.ok === false ? ', failed' : '';
		return `Began climbing${at}${lvl}${out}`;
	}

	/**
	 * Lay a row of chips above a robot, centred on it.
	 *
	 * Ordered by ACTIONS rather than by whatever order the intervals happen to
	 * be in, so a robot collecting-and-off-path draws its chips the same way
	 * every time and the row does not reshuffle between frames.
	 */
	function badges(doing, cx, cy) {
		const marks = Array.isArray(doing) ? doing.filter((m) => ACTIONS.includes(m?.a)) : [];
		const list = ACTIONS.map((a) => marks.find((m) => m.a === a)).filter(Boolean);
		if (!list.length) return [];
		const step = BADGE_R * 2 + BADGE_GAP;

		// Above the robot, unless there is no above. A robot against the top wall
		// — which is most of a start position on a rotated phone — would put the
		// row off the top of the viewBox and simply lose it, and a chip that
		// vanishes reads as an action that stopped.
		const lift = HALF_BOT + BADGE_R + 4;
		const wantY = cy - lift;
		const y = wantY - BADGE_R < 0 ? cy + lift : wantY;

		// And the row is kept inside the sides for the same reason: two chips are
		// wider than the robot, so a robot in a corner would drop one.
		const span = (list.length - 1) * step;
		const half = span / 2;
		const lo = BADGE_R + half;
		const hi = VB_W - BADGE_R - half;
		const mid = hi < lo ? cx : Math.min(Math.max(cx, lo), hi);

		return list.map((m, i) => ({
			mark: m,
			a: m.a,
			icon: iconFor(m),
			label: markLabel(m),
			cx: mid - half + i * step,
			cy: y
		}));
	}

	const me = $derived(place(position));
	// A drag writes a position down. That is only ever allowed while the match is
	// the thing being watched.
	//
	// "correct" used to be draggable too — the scout scrubbed back afterwards and
	// nudged the robot to where they remembered it. The trouble is that a position
	// recalled after the fact is indistinguishable, once stored, from one observed
	// at 10 Hz, and it is the same failure as blank-is-not-zero: a number that
	// looks like one thing and is another. A track is evidence of where a robot
	// was, and evidence is not edited from memory.
	//
	// What the pass still does — scrub, trim an action, set a rung, turn the whole
	// thing end for end, throw it away and record again — is all either reading or
	// a whole-track operation with a known cause. None of them make up a point.
	const draggable = $derived(mode === 'record');

	let svg = $state(null);
	let dragging = $state(false);

	/**
	 * The SVG's box as it was when the current drag began.
	 *
	 * A drag maps the pointer's ABSOLUTE position through this box, so if the box
	 * moves or resizes mid-drag the same physical hand position means a different
	 * place on the field, and the robot teleports on the next pointermove. That
	 * shipped: entering full screen at the whistle moved the field from 468x228 to
	 * 1104x535 with the scout's hand still on the robot.
	 *
	 * Freezing the box for the life of the drag is the guarantee rather than an
	 * arrangement that happens to satisfy it. A ResizeObserver was tried first and
	 * is not enough — the layout also TRANSLATES, and a five-pixel shift with an
	 * unchanged size moved the robot four units without ever firing it.
	 *
	 * The cost is a drag that continues through a genuine scroll being off by the
	 * scroll distance. Nothing here scrolls while a drag is live: full screen is
	 * `position: fixed` with `overflow: hidden`, and the field sets
	 * `touch-action: none` precisely so a drag never becomes one.
	 */
	let dragBox = null;

	function posFromEvent(ev) {
		const r = dragBox ?? svg.getBoundingClientRect();
		// Guard against a zero-width box. It happens during layout and while the
		// pane is hidden, and dividing by it produces Infinity, which clamps to a
		// field corner — a robot that teleports for no visible reason.
		if (r.width < 1 || r.height < 1) return null;
		// fromScreen, not toScreen: a quarter turn is not its own inverse, and
		// assuming it was would land the robot a quarter of the field from the
		// thumb in the one mode that exists to make the thumb more accurate.
		const o = fromScreen(
			(ev.clientX - r.left) / r.width,
			(ev.clientY - r.top) / r.height,
			view
		);
		return clampToField(fromDrawn(o.u, o.v));
	}

	function down(ev) {
		if (!draggable) return;
		// Take the box once, here, and hold it for the whole drag.
		const r = svg?.getBoundingClientRect();
		dragBox = r && r.width >= 1 && r.height >= 1 ? r : null;
		const p = posFromEvent(ev);
		if (!p) {
			dragBox = null;
			return;
		}
		dragging = true;
		// Capture, so a thumb that slides past the field edge keeps dragging
		// instead of dropping the robot where it left.
		//
		// Guarded: setPointerCapture throws NotFoundError when the pointer id is
		// not an active pointer, and an uncaught throw in a pointerdown handler
		// takes the drag down with it. Capture is an improvement to the drag, not
		// a precondition for it, so failing to get it must not stop the drag.
		try {
			ev.currentTarget.setPointerCapture?.(ev.pointerId);
		} catch {
			/* no capture; the drag still works while the pointer stays over the field */
		}
		onmove?.(p);
	}

	function move(ev) {
		if (!dragging) return;
		const p = posFromEvent(ev);
		if (p) onmove?.(p);
	}

	function up(ev) {
		dragging = false;
		dragBox = null;
		try {
			ev.currentTarget.releasePointerCapture?.(ev.pointerId);
		} catch {
			/* never captured, or already released */
		}
	}

	// Keyboard is not a nicety here: a drag-only control is unreachable without a
	// pointer, and the correction pass is exactly where someone on a laptop will
	// be nudging a robot a few centimetres.
	function key(ev) {
		if (!draggable || !position) return;
		const step = ev.shiftKey ? 0.05 : 0.01;
		const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
			ev.key
		];
		if (!d) return;
		ev.preventDefault();
		// The nudge is expressed in SCREEN terms — ArrowRight moves the robot
		// right on the screen — so it goes through the same inverse the pointer
		// does rather than through a hand-written sign flip. That sign flip
		// already shipped wrong once: it inverted only y, so ArrowRight walked
		// the robot left across a flipped field.
		const here = toDrawn(position);
		const sc = toScreen(here.u, here.v, view);
		const moved = fromScreen(sc.u + d[0] * step, sc.v + d[1] * step, view);
		onmove?.(clampToField(fromDrawn(moved.u, moved.v)));
	}
</script>

<svg
	bind:this={svg}
	viewBox="0 0 {VB_W} {VB_H}"
	class="field"
	class:draggable
	role={draggable ? 'application' : 'img'}
	aria-label={draggable
		? 'Field. Drag the robot, or use the arrow keys.'
		: mode === 'review'
			? 'Field, showing the recorded path'
			: 'Field replay'}
	tabindex={draggable ? 0 : -1}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onkeydown={key}
>
	<rect x="0" y="0" width={VB_W} height={VB_H} class="carpet" />

	<!-- Alliance ends, tinted, under everything. -->
	{#each bands as b}
		{#if b.tone !== 'none'}
			<rect x={b.x} y={b.y} width={b.w} height={b.h} class="alliance {b.tone}" />
		{/if}
	{/each}

	{#each bandLabels as b}
		<text x={b.x} y={b.y} class="band-label" text-anchor={labelAnchor} dominant-baseline="middle">{b.label}</text>
	{/each}
	{#each bandLines as b}
		<line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} class="band-line" />
	{/each}

	<!-- Driven over and driven under: landmarks a scout steers by, and paths
	     legitimately cross both. Drawn under everything else. -->
	{#each marks as m}
		<rect x={m.x} y={m.y} width={m.w} height={m.h} rx="4" class="mark {m.label}" />
	{/each}

	{#each lines as l}
		<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} class="mark-line {l.label.split(' ')[0]}" />
	{/each}

	<!-- Solid: a robot cannot be here. Both HUBs and the DEPOT, both ends, drawn
	     whole — the field has not been cut since v0.81. -->
	{#each solids as o}
		<rect x={o.x} y={o.y} width={o.w} height={o.h} rx="4" class="solid" />
		{#if o.hex}<polygon points={o.hex} class="opening" />{/if}
	{/each}

	{#if path}<path d={path} class="trail" />{/if}

	{#each ghosts as g}
		<g class="bot" class:done={g.done} class:doing={g.doing.length > 0}>
			<rect x={g.cx - HALF_BOT} y={g.cy - HALF_BOT} width={ROBOT} height={ROBOT} rx="6" style={g.colour ? `--bot: ${g.colour}` : ''} />
			<text x={g.cx} y={g.cy + 1} dominant-baseline="middle" text-anchor="middle">{g.label}</text>
		</g>
	{/each}

	{#if me}
		<g class="me" class:acting={active.length > 0}>
			<rect x={me.cx - HALF_BOT} y={me.cy - HALF_BOT} width={ROBOT} height={ROBOT} rx="6" />
			{#if active.length}
				<circle cx={me.cx} cy={me.cy} r={ROBOT * 0.75} class="pulse" />
			{/if}
		</g>
	{/if}

	<!-- Chips LAST, so they sit above every robot rather than under the next one
	     drawn. Six robots overlap constantly on a real replay, and a chip that
	     slides behind a passing robot reads as the action having stopped. -->
	{#each ghosts as g}
		{#each badges(g.doing, g.cx, g.cy) as b (b.a)}
			{@render chip(b, g.done)}
		{/each}
	{/each}
	{#if me}
		{#each badges(active, me.cx, me.cy) as b (b.a)}
			{@render chip(b, false)}
		{/each}
	{/if}
</svg>

<!-- One chip. A <title> rather than a legend beside the field: it is the native
     tooltip AND the accessible name, it costs no space on a phone, and the
     field is already the densest picture in the app. -->
{#snippet chip(b, faded)}
	<g class="badge {b.a}" class:faded class:failed={b.icon.failed}>
		<title>{b.label}</title>
		<circle class="disc" cx={b.cx} cy={b.cy} r={BADGE_R} />
		<!-- The icon draws in its own 256 space and one transform puts it on the
		     chip, so the path data stays byte-identical to the source files. The
		     glyph fills GLYPH_FILL of the disc; the rest is the ring of clear
		     space that keeps it legible against a drawn field. -->
		<g
			transform="translate({b.cx} {b.cy}) scale({(BADGE_R * 2 * GLYPH_FILL) /
				ICON_BOX}) translate({-ICON_BOX / 2} {-ICON_BOX / 2})"
		>
			{#if b.icon.kind === 'collect'}
				<g class="g-line" stroke-width="18">
					<path d="M64 54H96M64 54V202M64 202H96" />
					<path d="M202 128H105" />
					<path d="M137 92L101 128L137 164" />
				</g>
			{:else if b.icon.kind === 'score'}
				<g class="g-line" stroke-width="12">
					<path d="M61 151C82 145 101 128 119 105" />
					<path d="M93 183C114 177 133 160 151 137" />
					<path d="M125 215C146 209 165 192 183 169" />
				</g>
				<g class="g-fill">
					<circle cx="144" cy="80" r="16" />
					<circle cx="176" cy="112" r="16" />
					<circle cx="208" cy="144" r="16" />
				</g>
			{:else if b.icon.kind === 'fault'}
				<path
					class="g-warn"
					d="M112.4 36.2C119.3 24.2 136.7 24.2 143.6 36.2L228.2 183C235.1 195 226.4 210 212.6 210H43.4C29.6 210 20.9 195 27.8 183L112.4 36.2Z"
				/>
				<path class="g-mark" stroke-width="18" d="M128 82V145" />
				<circle class="g-mark-fill" cx="128" cy="177" r="11" />
			{:else if b.icon.kind === 'climb'}
				<!-- Left slot: the ladder, or the warning triangle when it came off. -->
				{#if b.icon.failed}
					<path class="g-warn" d={WARN_SMALL.tri} />
					<path class="g-mark" stroke-width={WARN_SMALL.barWidth} d={WARN_SMALL.bar} />
					<circle
						class="g-mark-fill"
						cx={WARN_SMALL.dot.cx}
						cy={WARN_SMALL.dot.cy}
						r={WARN_SMALL.dot.r}
					/>
				{:else}
					<g class="g-line" stroke-width="13">
						<path d={LADDER} />
					</g>
				{/if}
				<!-- Right slot: the rung, or a question mark when nobody read it.
				     Never a numeral picked as a stand-in — that would assert a rung
				     the scout did not report. -->
				{#if b.icon.lvl}
					<path
						class="g-fill"
						transform="translate(0 {RUNG_SHIFT[b.icon.lvl]})"
						d={RUNG[b.icon.lvl]}
					/>
				{:else}
					<path class="g-fill" d={RUNG_UNKNOWN} />
				{/if}
			{/if}
		</g>
	</g>
{/snippet}

<style>
	/* Hallmark · genre: modern-minimal · component: auto-field
	 * design-system: design.md
	 */
	.field {
		width: 100%;
		height: auto;
		display: block;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		/* The scout is dragging on this. Without it a drag scrolls the page on a
		   phone and the robot stays put, which reads as the field being broken. */
		touch-action: none;
		user-select: none;
	}
	.field.draggable {
		cursor: grab;
	}
	.field.draggable:active {
		cursor: grabbing;
	}
	.field:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.carpet {
		fill: var(--bg-subtle);
	}
	.band-line {
		stroke: var(--border);
		stroke-width: 2;
		stroke-dasharray: 8 8;
	}
	/* --text-muted, not --text-faint. These are functional orientation labels, and
	   faint measured 4.54 on the carpet in light mode — a pass with no margin, on
	   SVG text that check_contrast.mjs structurally cannot see because its
	   foreground is a `fill` rather than a token pairing. That is the same blind
	   spot the v0.80 pill bug lived in, so the margin is bought here rather than
	   relied on. */
	.band-label {
		fill: var(--text-muted);
		font-size: 26px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	/* A stroke means "this stops a robot", and nothing else on the field has one.
	   That is the entire visual grammar here, and it has to survive being glanced
	   at on a phone in a gym: the HUB and the BUMP beside it are adjacent
	   rectangles of similar size, and if they read alike the scout learns a field
	   where the hub is passable. */
	/* Tint, not fill: the band sits under the BUMPs and TRENCHes and has to let
	   them read through it. */
	.alliance.red {
		fill: var(--alliance-red);
		opacity: 0.16;
	}
	.alliance.blue {
		fill: var(--alliance-blue);
		opacity: 0.16;
	}

	.opening {
		fill: var(--bg-page);
		stroke: var(--text-faint);
		stroke-width: 3;
	}
	.solid {
		fill: var(--bg-card);
		stroke: var(--text-faint);
		stroke-width: 5;
	}
	.mark {
		fill: var(--bg-elev);
		opacity: 0.6;
	}
	.mark.tower {
		fill: var(--border-strong);
		opacity: 0.5;
	}
	.mark.trench {
		fill: none;
		stroke: var(--border);
		stroke-width: 2;
		stroke-dasharray: 6 6;
	}
	.mark-line {
		stroke: var(--border);
		stroke-width: 2;
	}
	.mark-line.centre {
		stroke-dasharray: 10 8;
	}

	.trail {
		fill: none;
		stroke: var(--accent);
		stroke-width: 5;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.55;
	}

	.me rect {
		fill: var(--accent);
		stroke: var(--bg-page);
		stroke-width: 3;
	}
	.pulse {
		fill: none;
		stroke: var(--accent);
		stroke-width: 4;
		opacity: 0.5;
	}

	/* The class is `bot`, not `ghost`: Button already ships a `ghost` VARIANT and
	   renders that class name. Svelte's scoping keeps the two apart today, so this
	   is a trap rather than a bug — but a :global() reaching for either would find
	   both, and a replay page renders them side by side.

	   --bot is set per robot from the markup so six ghosts can be told apart. The
	   default is declared HERE rather than as a var() fallback: `var(--bot,
	   var(--accent))` is indistinguishable from the bug where a token was never
	   defined and renders as a plausible-looking colour instead of an obvious
	   break. check_components.mjs refuses that shape, correctly. */
	.bot rect {
		--bot: var(--accent);
		fill: var(--bot);
		opacity: 0.9;
	}
	.bot text {
		fill: var(--on-accent);
		font-size: 20px;
		font-weight: 700;
	}
	/* A robot past the end of its own recording is faded, never removed —
	   disappearing reads as "it left the field", which the recording does not say. */
	.bot.done {
		opacity: 0.3;
	}
	.bot.doing rect {
		stroke: var(--on-accent);
		stroke-width: 3;
	}

	/* The action chip. Neutral disc, coloured glyph — see `badges()` for why that
	   way round and not a coloured fill. */
	/* The disc is --bg-card on a --bg-subtle carpet, which is 1.08 apart in dark:
	   the EDGE is the whole of what separates the chip from the field, so it is
	   doing the job WCAG 1.4.11 describes and it has to be measured.
	   --border-strong is 2.97 on --bg-subtle in the light palette — under the 3.0
	   floor, found by pinning the pair. --text-faint is what the field's other
	   outlines already use (.solid, .opening) and it is pinned at 4.5 against
	   this ground in all four palettes, so it is both stronger and already
	   guaranteed. */
	/* `.disc`, not `circle`.
	   This was `.badge circle`, which is the chip's disc AND every circle inside
	   the icon on it — the shooting icon's three balls and the warning triangle's
	   dot. The balls were painted --bg-card and vanished into the disc: black on
	   black in dark, and white on white in light, so it was never a dark-mode
	   problem and a second icon set would have fixed nothing. A direct match also
	   beats the fill inherited from the icon's own group, which is why the parent
	   computed the right colour and the child did not. */
	.badge .disc {
		fill: var(--bg-card);
		stroke: var(--text-faint);
		stroke-width: 1.5;
	}
	/* ─── the icon's four roles ─────────────────────────────────────────────
	   The source files hardcode #111827, #DC2626 and white. Those are three
	   literals that would be invisible on a dark carpet and outside every
	   contrast guarantee in check_contrast, so the shapes are kept and the
	   colours are re-applied here from tokens.

	   `--accent` for the ink, `--success` for the score — the other half of a
	   cycle is the one hue change that earns its place — and `--danger` for the
	   warning, which is what the designer's #DC2626 means and what a failed
	   climb is. Every one of these is already pinned against `--bg-card` at 4.5
	   in all four palettes, which is why the disc is neutral and the ink is
	   coloured rather than the other way round. */
	.badge .g-line {
		fill: none;
		stroke: var(--accent);
		stroke-linecap: round;
		stroke-linejoin: round;
		/* The strokes are authored in a 256 box and scaled down with everything
		   else, so no vector-effect: the whole icon shrinks together, which is
		   what keeps it the designer's drawing rather than a thicker relative of
		   it. */
	}
	.badge .g-fill {
		fill: var(--accent);
		stroke: none;
	}
	.badge.score .g-line {
		stroke: var(--success);
	}
	.badge.score .g-fill {
		fill: var(--success);
	}
	/* The warning triangle is a FILL, and the mark inside it is cut back to the
	   disc's own colour rather than to white. White is only right on one of the
	   two themes; the disc colour is right on both by construction, and it reads
	   as the triangle being punched through. */
	.badge .g-warn {
		fill: var(--danger);
		stroke: none;
	}
	.badge .g-mark {
		fill: none;
		stroke: var(--bg-card);
		stroke-linecap: round;
	}
	.badge .g-mark-fill {
		fill: var(--bg-card);
		stroke: none;
	}
	/* Past the end of its own recording, a robot's chips fade with it. */
	.badge.faded {
		opacity: 0.3;
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse {
			display: none;
		}
	}
</style>
