<script>
	// The field, the robots on it, and the three things you can do with them.
	//
	//   mode="record"   drag one robot for fifteen seconds
	//   mode="correct"  scrub back through what you just drew and fix it
	//   mode="replay"   watch six recordings at once
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
	import { positionAt, actionsAt, trackDuration } from '$lib/auto-track.js';

	/**
	 * @type {{
	 *   mode?: 'record'|'correct'|'replay',
	 *   tracks?: Array<{track: object, label: string, colour?: string, offset?: number}>,
	 *   position?: {x:number,y:number}|null,
	 *   trail?: Array<{x:number,y:number}>,
	 *   t?: number,
	 *   flipped?: boolean,
	 *   rotated?: boolean,
	 *   allianceColor?: string|null,
	 *   active?: string[],
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
		allianceColor = null,
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
	 * The rotation is applied in DRAWN space, after toDrawn — the drawn region is
	 * cut, so rotating in field coordinates would slide the window onto the
	 * opponent's half. Everything on the field goes through here, which is what
	 * makes "the whole picture turns together" true by construction rather than
	 * by remembering to flip each layer.
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

	// The alliance's own end, tinted. The team's field image does this and it is
	// the one thing that says which end is yours without a label.
	const bands = $derived.by(() => {
		const mine = allianceColor === 'blue' ? 'far' : 'near';
		return ALLIANCE_BANDS.map((b) => {
			const r = box({ x: b.x, y: 0.5, w: b.w, h: 1 });
			return {
				...r,
				// With no alliance recorded yet, neither end is claimed — colouring one
				// would be a guess a scout would read as a fact.
				tone: allianceColor ? (b.end === mine ? 'own' : 'opp') : 'none'
			};
		});
	});
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
							doing: actionsAt(row.track, local),
							// Past its own end, a robot is drawn faded rather than removed:
							// disappearing reads as "it left the field", which is a claim the
							// recording does not make.
							done: local > trackDuration(row.track)
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

	const me = $derived(place(position));
	const draggable = $derived(mode === 'record' || mode === 'correct');

	let svg = $state(null);
	let dragging = $state(false);

	function posFromEvent(ev) {
		const r = svg.getBoundingClientRect();
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
		const p = posFromEvent(ev);
		if (!p) return;
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

	<!-- The cut edge. The picture stops here; the coordinate space does not. It is
	     the far end from the alliance wall, so it changes sides with the flip. -->
	{#each [segment(1, 0, 1, 1)] as c}
		<line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} class="cut" />
	{/each}

	<!-- Solid: a robot cannot be here. Both HUBs and the DEPOT. The far HUB
	     straddles the cut, so it renders as a half square on the right edge. -->
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
</svg>

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
	.cut {
		stroke: var(--border-strong);
		stroke-width: 3;
	}
	/* A stroke means "this stops a robot", and nothing else on the field has one.
	   That is the entire visual grammar here, and it has to survive being glanced
	   at on a phone in a gym: the HUB and the BUMP beside it are adjacent
	   rectangles of similar size, and if they read alike the scout learns a field
	   where the hub is passable. */
	/* Tint, not fill: the band sits under the BUMPs and TRENCHes and has to let
	   them read through it. */
	.alliance.own {
		fill: var(--alliance-red);
		opacity: 0.16;
	}
	.alliance.opp {
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

	@media (prefers-reduced-motion: reduce) {
		.pulse {
			display: none;
		}
	}
</style>
