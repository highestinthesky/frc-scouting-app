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
		OBSTACLES,
		FEATURES,
		START_BANDS,
		clampToField,
		toDrawn,
		fromDrawn,
		orient
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
		active = [],
		onmove
	} = $props();

	// The viewBox is in DRAWN units scaled to the picture's own aspect, so every
	// coordinate below is a straight multiply and nothing has to remember which
	// space it is in.
	const VB_W = 1000;
	const VB_H = Math.round(VB_W / DRAWN_ASPECT);

	/** Full-field position to a point in the viewBox, honouring the flip. */
	function place(pos) {
		if (!pos) return null;
		const d = toDrawn(orient(pos, flipped));
		return { cx: d.u * VB_W, cy: d.v * VB_H };
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
		const w = (o.w / (DRAWN.x1 - DRAWN.x0)) * VB_W;
		const h = (o.h / (DRAWN.y1 - DRAWN.y0)) * VB_H;
		return { x: c.cx - w / 2, y: c.cy - h / 2, w, h, label: o.label };
	}

	const solids = $derived(OBSTACLES.filter((o) => o.kind === 'rect').map(box));
	const marks = $derived(FEATURES.filter((f) => f.kind === 'rect').map(box));
	const lines = $derived(
		FEATURES.filter((f) => f.kind === 'line').map((f) => ({
			x: place({ x: f.x, y: 0.5 }).cx,
			label: f.label
		}))
	);

	// Band lines are drawn from the SAME numbers the classifier reads, so a
	// renamed or moved band cannot disagree with the label a manager is shown.
	const bands = $derived(
		START_BANDS.slice(0, -1).map((b) => {
			const y = flipped ? 1 - b.upTo : b.upTo;
			return { y: y * VB_H, label: b.label };
		})
	);

	// Band labels start clear of whatever is against the near wall.
	//
	// Centred in their band they sat exactly where the DEPOT is drawn — both are
	// centred across the width — and "Middle" rendered as "ODLE". Anchoring to
	// the top of the band left one pixel of overlap, which is the kind of fix
	// that comes back the moment a band moves. So they clear the wall furniture
	// HORIZONTALLY instead, computed from the widest thing touching x = 0 rather
	// than from a number that happens to work today.
	const labelX = $derived(
		Math.max(
			14,
			...OBSTACLES.filter((o) => o.kind === 'rect' && o.x - o.w / 2 <= DRAWN.x0 + 1e-9).map(
				(o) => ((o.x + o.w / 2) / (DRAWN.x1 - DRAWN.x0)) * VB_W + 16
			)
		)
	);

	const bandLabels = $derived(
		START_BANDS.map((b, i) => {
			const lo = i === 0 ? 0 : START_BANDS[i - 1].upTo;
			const mid = (lo + b.upTo) / 2;
			return { y: (flipped ? 1 - mid : mid) * VB_H, label: b.label };
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
		const u = (ev.clientX - r.left) / r.width;
		const v = (ev.clientY - r.top) / r.height;
		return clampToField(orient(fromDrawn(u, v), flipped));
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
		const dir = flipped ? -1 : 1;
		onmove?.(clampToField({ x: position.x + d[0], y: position.y + d[1] * dir }));
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

	{#each bandLabels as b}
		<text x={labelX} y={b.y} class="band-label" dominant-baseline="middle">{b.label}</text>
	{/each}
	{#each bands as b}
		<line x1="0" y1={b.y} x2={VB_W} y2={b.y} class="band-line" />
	{/each}

	<!-- Driven over and driven under: landmarks a scout steers by, and paths
	     legitimately cross both. Drawn under everything else. -->
	{#each marks as m}
		<rect x={m.x} y={m.y} width={m.w} height={m.h} rx="4" class="mark {m.label}" />
	{/each}

	{#each lines as l}
		<line x1={l.x} y1="0" x2={l.x} y2={VB_H} class="mark-line {l.label.split(' ')[0]}" />
	{/each}

	<!-- The cut edge. The picture stops here; the coordinate space does not. -->
	<line x1={VB_W - 1} y1="0" x2={VB_W - 1} y2={VB_H} class="cut" />

	<!-- Solid: a robot cannot be here. Both HUBs and the DEPOT. The far HUB
	     straddles the cut, so it renders as a half square on the right edge. -->
	{#each solids as o}
		<rect x={o.x} y={o.y} width={o.w} height={o.h} rx="4" class="solid" />
	{/each}

	{#if path}<path d={path} class="trail" />{/if}

	{#each ghosts as g}
		<g class="bot" class:done={g.done} class:doing={g.doing.length > 0}>
			<rect x={g.cx - 22} y={g.cy - 22} width="44" height="44" rx="6" style={g.colour ? `--bot: ${g.colour}` : ''} />
			<text x={g.cx} y={g.cy + 1} dominant-baseline="middle" text-anchor="middle">{g.label}</text>
		</g>
	{/each}

	{#if me}
		<g class="me" class:acting={active.length > 0}>
			<rect x={me.cx - 24} y={me.cy - 24} width="48" height="48" rx="6" />
			{#if active.length}
				<circle cx={me.cx} cy={me.cy} r="34" class="pulse" />
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
	.solid {
		fill: var(--bg-card);
		stroke: var(--text-faint);
		stroke-width: 5;
	}
	.mark {
		fill: var(--bg-elev);
		opacity: 0.6;
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
