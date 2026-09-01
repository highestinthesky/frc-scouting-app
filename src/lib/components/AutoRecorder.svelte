<script>
	// Fifteen seconds of auto, recorded by a thumb.
	//
	// ADR-002 Decision 6, which is the decision this whole component is:
	//
	//   The scout drags DURING the fifteen seconds, and then gets a correction
	//   pass before submitting.
	//
	// The first draft of the ADR forbade recording during auto, on the grounds
	// that a scout looking at a phone is not watching the field. That objection is
	// real. It is not answered by giving up the track, because a path
	// reconstructed from memory afterwards is exactly the "guessed path that looks
	// like data" the objection was protecting against. It is answered by buying
	// the accuracy back afterwards, with no clock on it.
	//
	// ─── the four states ───────────────────────────────────────────────────────
	//
	//   place    drag the robot to where it starts. Before the match, no clock.
	//   arm      one big button, because the next thing that happens is a match.
	//   live     15 s. Drag, hold the action buttons. This is the only timed part.
	//   correct  scrub, fix, trim. Or throw it away and place again.
	//
	// Everything is skippable and everything is undoable. A required field here
	// would manufacture false data at exactly the moment the real data was
	// unavailable, which is Decision 4 pointed at the input instead of the reader.
	import { onDestroy } from 'svelte';
	import AutoField from './AutoField.svelte';
	import Button from './Button.svelte';
	import {
		SAMPLE_HZ,
		ACTIONS,
		CLIMB_LEVELS,
		encodeTrack,
		decodeTrack,
		positionAt,
		trackDuration,
		cycleStats
	} from '$lib/auto-track.js';
	import { startZone, clampToStart, mirrorPosition } from '$lib/field.js';

	/**
	 * @type {{
	 *   value?: object|null,
	 *   allianceColor?: string|null,
	 *   onchange?: (track: object|null) => void
	 * }}
	 */
	let { value = null, allianceColor = null, onchange } = $props();

	/** Auto is fifteen seconds. The recorder stops itself. */
	const AUTO_MS = 15_000;
	const STEP_MS = 1000 / SAMPLE_HZ;
	/** The most samples a recording can hold. Derived, so it cannot disagree. */
	const MAX_SAMPLES = Math.round(AUTO_MS / STEP_MS);

	let phase = $state('place');
	let start = $state(null);
	let here = $state(null);
	let samples = $state([]);
	let intervals = $state([]);
	/** Which action buttons are held right now, action -> t0. */
	let held = $state({});
	let elapsed = $state(0);
	let scrub = $state(0);
	let handed = $state('right');
	let flipped = $state(false);
	let full = $state(false);
	let portrait = $state(false);
	/** Index of the climb interval waiting for its rung, or null. */
	let askLevelFor = $state(null);

	// Full screen on a phone held upright is width-bound — the field is half
	// again as wide as it is tall, so it bought 2% and left 607px of height
	// empty. Turned a quarter, the long axis of the field runs down the long axis
	// of the phone: about seven times the area to aim a thumb at.
	//
	// Only in full screen. Inline in the form the field sits in a column of
	// fields and a tall picture there would push the rest of the form off the
	// screen to solve a problem that page does not have.
	const rotated = $derived(full && portrait);

	// Measured from the viewport rather than asked of a media query.
	//
	// `matchMedia('(orientation: portrait)')` only reports a change through an
	// event, and that event did not fire when the viewport changed shape — CSS
	// re-evaluated and this state did not, so the field stayed stood on end in
	// landscape and rendered 180px wide. One source that is read on every resize
	// cannot drift from the layout the same way.
	//
	// `h > w` is what `(orientation: portrait)` means in a browser anyway: it is
	// the viewport's shape, not the device's.
	$effect(() => {
		// Read again whenever full screen is entered, not only on a resize event. A
		// phone rotated while the app was backgrounded fires nothing a hidden page
		// hears, and entering full screen is the moment the answer starts to
		// matter — so the one user action that always precedes a recording is also
		// a chance to re-measure.
		full;
		const read = () => (portrait = window.innerHeight > window.innerWidth);
		read();
		window.addEventListener('resize', read);
		window.addEventListener('orientationchange', read);
		return () => {
			window.removeEventListener('resize', read);
			window.removeEventListener('orientationchange', read);
		};
	});

	let timer = null;
	let startedAt = 0;

	// If the form already holds a track — an edit, or a draft restored — open in
	// the correction pass rather than the placement step, so a scout returning to
	// an entry does not have to record it again to see it.
	$effect(() => {
		if (value && phase === 'place' && samples.length === 0 && !start) {
			const d = decodeTrack(value);
			if (d) {
				start = d.start;
				here = d.start;
				samples = d.samples.map((s) => ({ x: s.x, y: s.y }));
				intervals = d.intervals.map((iv) => ({ ...iv }));
				phase = 'correct';
			}
		}
	});

	const zone = $derived(startZone(start, allianceColor));
	const preview = $derived(
		decodeTrack(encodeTrack({ start, samples, intervals, hz: SAMPLE_HZ }))
	);
	const stats = $derived(preview ? cycleStats(preview) : null);
	const duration = $derived(preview ? trackDuration(preview) : 0);

	/** Where the robot is at the scrub position, for the correction pass. */
	const atScrub = $derived(preview ? positionAt(preview, scrub) : null);

	function emit() {
		onchange?.(encodeTrack({ start, samples, intervals, hz: SAMPLE_HZ }));
	}

	function place(pos) {
		if (phase === 'place') {
			// G303-D: "its BUMPERS overlap their ROBOT STARTING LINE." A start
			// anywhere else is a placement that could not have happened, and a start
			// position is the single most-asked question of this whole feature — so
			// it is constrained at the input rather than corrected in the reading.
			const p = clampToStart(pos, allianceColor);
			here = p;
			start = p;
			emit();
			return;
		}
		// Live drag only moves the robot; the sampler is what writes it down, at a
		// fixed cadence. Recording on every pointer event instead would give a track
		// whose density depends on how fast the scout's thumb moved, and the
		// timestamps would stop being derivable from the index.
		//
		// After the whistle the field stops accepting a drag at all, so there is no
		// third case here. The correction pass used to rewrite the sample under the
		// scrub head; see `draggable` in AutoField for why it no longer does.
		if (phase === 'live') here = pos;
	}

	function begin() {
		// Defensive: a second begin() with a timer still running leaks the first
		// one, and two samplers filling the same array double the rate at which `t`
		// advances — a 15-second recording that decodes as 7.5 seconds of motion at
		// twice the speed, with nothing about it looking wrong.
		if (timer) clearInterval(timer);
		samples = [];
		intervals = [];
		held = {};
		elapsed = 0;
		here = start;
		phase = 'live';
		startedAt = performance.now();
		timer = setInterval(tick, STEP_MS);
	}

	// ─── the sampler fills to a clock, it does not count its own ticks ─────────
	//
	// setInterval is not a clock. A browser throttles it hard when the tab is
	// backgrounded — a dimmed screen, a scout switching apps, a notification — and
	// on the first run of this component a 15-second recording came out as 52.2
	// seconds because it was counting ticks that had stopped arriving on time.
	//
	// That is worse than a wrong duration. `t` is DERIVED from a sample's index
	// (see auto-track.js), so evenly-spaced samples are the one thing the whole
	// encoding rests on. 150 samples spread over 52 real seconds decode as 15
	// seconds of motion at three times the true speed, and nothing about the
	// result looks wrong.
	//
	// So each tick asks the clock how many samples SHOULD exist by now and fills
	// forward to that index. A late tick writes several samples; a skipped one is
	// caught up by the next. The index and the time cannot drift apart.
	function tick() {
		elapsed = performance.now() - startedAt;
		// Held at the last known position. A robot that is not being dragged has
		// not vanished — it is standing still, which is a real thing a robot does
		// in auto and a real thing to record. Filling the gap this way is also the
		// honest reading of a throttled tick: the robot was somewhere, and nobody
		// was asked where.
		const at = here ?? start ?? { x: 0.1, y: 0.5 };
		const want = Math.min(MAX_SAMPLES, Math.floor(elapsed / STEP_MS) + 1);
		while (samples.length < want) samples.push(at);
		samples = samples;
		if (elapsed >= AUTO_MS) finish();
	}

	function finish() {
		if (timer) clearInterval(timer);
		timer = null;
		// Clamped, for the same reason the sampler fills to a clock: a throttled
		// tick can arrive well past fifteen seconds, and a recording of auto is
		// fifteen seconds by definition. Stopping early is the case where this is
		// simply the elapsed time.
		elapsed = Math.min(elapsed, AUTO_MS);
		// Any button still down when the whistle goes is closed at the whistle
		// rather than dropped. A scout holding "scoring" as auto ends recorded
		// something true, and discarding it would lose the longest interval on the
		// track precisely when it mattered.
		const now = Math.round(elapsed);
		for (const [a, t0] of Object.entries(held)) intervals.push({ a, t0, t1: now });
		held = {};
		intervals = intervals;
		phase = 'correct';
		// The scrub head lands at the END of the recording, not the start.
		//
		// At 0 the robot teleported back to where it lined up the moment the
		// whistle went, which reads as the recording having gone wrong. Worse, the
		// scrub index is what a correction edits: a scout who reached out to fix
		// the last thing they saw was moving SAMPLE ZERO instead, dragging the
		// start position across the field and leaving a straight line from there to
		// the second sample. An extra line that was never driven.
		//
		// Ending where the recording ended means the picture does not move, and the
		// first correction lands on the last moment — which is the one still in the
		// scout's head.
		scrub = Math.max(0, (samples.length - 1) * STEP_MS);
		// A climb that ended at the whistle never got its question. It gets it now,
		// where there is no clock on the answer.
		const pending = intervals.findIndex((iv) => iv.a === 'climb' && iv.lvl == null);
		askLevelFor = pending >= 0 ? pending : null;
		emit();
	}

	function press(action) {
		if (phase !== 'live' || held[action] != null) return;
		held = { ...held, [action]: Math.round(performance.now() - startedAt) };
	}

	function release(action) {
		if (held[action] == null) return;
		const t0 = held[action];
		const t1 = Math.round(performance.now() - startedAt);
		const { [action]: _drop, ...rest } = held;
		held = rest;
		if (t1 > t0) {
			intervals.push({ a: action, t0: Math.min(t0, AUTO_MS), t1: Math.min(t1, AUTO_MS) });
			intervals = intervals;
			if (action === 'climb') askLevelFor = intervals.length - 1;
		}
	}

	// ─── the rung ──────────────────────────────────────────────────────────────
	//
	// A climb has a level, and the level cannot be recorded while the robot is
	// still climbing. So the button behaves like the others during the hold, and
	// the question arrives when the hold ends — during the recording if there is
	// time, and waiting in the correction pass if there is not.
	//
	// It is skippable. A scout who saw a robot get onto the TOWER but could not
	// tell which rung has recorded something true; forcing a number would turn it
	// into something false, which is Decision 4 pointed at the input.
	function setLevel(i, lvl) {
		if (i == null || !intervals[i]) return;
		if (lvl == null) delete intervals[i].lvl;
		else intervals[i].lvl = lvl;
		intervals = intervals;
		askLevelFor = null;
		emit();
	}

	function dropInterval(i) {
		intervals.splice(i, 1);
		intervals = intervals;
		emit();
	}

	/**
	 * Turn the whole recording end for end.
	 *
	 * For the scout who read the field the wrong way round — every position 180°
	 * from the truth, which is a plausible auto at the wrong end and looks fine.
	 * It cannot be re-recorded, because the match is over.
	 *
	 * Positions only. The alliance is a fact from the schedule and is not this
	 * button's to change; that is why it says "flip" and not "switch alliance".
	 */
	function flipRecording() {
		if (start) start = mirrorPosition(start);
		samples = samples.map(mirrorPosition);
		here = start;
		emit();
	}

	function discard() {
		start = null;
		here = null;
		samples = [];
		intervals = [];
		held = {};
		elapsed = 0;
		scrub = 0;
		phase = 'place';
		emit();
	}

	// ─── keys, for the half of the team on a laptop ────────────────────────────
	//
	// A drag-only control with hold-to-record buttons is a two-hand job, and on a
	// desktop one of those hands is on the mouse. A / S / D sit under the resting
	// left hand while the right drags, which is the same reason those keys are
	// the movement keys in every game these scouts have played.
	//
	// Bound on the window rather than the component: the pointer is captured by
	// the SVG during a drag, so a listener on the recorder would only fire when
	// focus happened to be inside it — which, mid-drag, it is not.
	const KEYS = { a: 'collect', s: 'score', d: 'fault', f: 'climb' };

	function isTyping(t) {
		return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
	}

	function keydown(ev) {
		// `repeat` is the important guard. Holding a key fires keydown over and
		// over, and each one would open a new interval while the first is still
		// open — the release then closes only the last, and the rest never end.
		if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
		if (isTyping(ev.target)) return;
		// Space starts it, not Enter.
		//
		// Enter is across the keyboard from A/S/D/F and under the hand that is on
		// the mouse — the one hand that is busy, because it is about to drag the
		// robot. Space is under the thumb that is already resting there, and it is
		// what starts a stopwatch, a video and a game, which is the whole of what
		// this control does.
		//
		// preventDefault stops two things, both of which have to be stopped: the
		// page scrolling, and Space activating whatever button happens to hold
		// focus. Enter still works when the Start button itself is focused, which
		// is the browser's job and not this handler's.
		if (phase === 'place' && ev.key === ' ' && start) {
			ev.preventDefault();
			begin();
			return;
		}
		if (phase !== 'live') return;
		if (ev.key === 'Escape') {
			ev.preventDefault();
			finish();
			return;
		}
		// Space does nothing during the recording, but it must not do its DEFAULT
		// either: it scrolls the page and it clicks whichever action button holds
		// focus. The recorder owns the keyboard for these fifteen seconds.
		if (ev.key === ' ') {
			ev.preventDefault();
			return;
		}
		const action = KEYS[ev.key.toLowerCase()];
		if (!action) return;
		ev.preventDefault();
		press(action);
	}

	function keyup(ev) {
		if (isTyping(ev.target)) return;
		const action = KEYS[ev.key?.toLowerCase?.()];
		if (action) release(action);
	}

	$effect(() => {
		window.addEventListener('keydown', keydown);
		window.addEventListener('keyup', keyup);
		// A key held when the window loses focus never sends its keyup, so the
		// interval would run to the end of the recording. Closing every held
		// action on blur is the honest reading: we stopped being told.
		const blur = () => {
			for (const a of Object.keys(held)) release(a);
		};
		window.addEventListener('blur', blur);
		return () => {
			window.removeEventListener('keydown', keydown);
			window.removeEventListener('keyup', keyup);
			window.removeEventListener('blur', blur);
		};
	});

	// Recording takes the whole screen, and gives it back afterwards.
	//
	// The field was sharing a phone with a form, which is the one thing it cannot
	// afford: fifteen seconds of thumb-tracking on a 358px-wide picture is the
	// input the whole feature rests on. Full screen is entered automatically at
	// `begin` rather than offered as a preference, because a scout about to watch
	// a match is not going to go looking for a setting.
	$effect(() => {
		if (phase === 'live') full = true;
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const remaining = $derived(Math.max(0, Math.ceil((AUTO_MS - elapsed) / 1000)));
	const activeNow = $derived(Object.keys(held));
	// Short enough to survive a quarter of a phone's width. "Disrupted" truncated
	// to "Disrup…" on the rail, and a control whose label is cut off is a control
	// a scout has to remember rather than read. "Off path" is also closer to what
	// the plan actually describes — "disrupted from its original path" — than a
	// word that sounds like the robot's fault.
	const LABELS = { collect: 'Collect', score: 'Score', fault: 'Off path', climb: 'Climb' };
	const KEY_FOR = { collect: 'A', score: 'S', fault: 'D', climb: 'F' };
</script>

<div class="shell" class:full>
<div class="rec" class:left={handed === 'left'}>
	<div class="stage">
		<!-- `phase` and `mode` deliberately disagree in the last state: the pass
		     still corrects — trim an action, set a rung, turn the track end for end
		     — but the FIELD is read-only, because those are the corrections that do
		     not invent a position. -->
		<AutoField
			mode={phase === 'correct' ? 'review' : 'record'}
			position={phase === 'correct' ? atScrub : here}
			trail={phase === 'place' ? [] : samples}
			{flipped}
			{rotated}
			{allianceColor}
			active={activeNow}
			onmove={place}
		/>
	</div>

	{#if phase === 'live'}
		<div class="rail" aria-label="Actions">
			{#each ACTIONS as a}
				<button
					type="button"
					class="act {a}"
					class:on={held[a] != null}
					onpointerdown={() => press(a)}
					onpointerup={() => release(a)}
					onpointerleave={() => release(a)}
					onpointercancel={() => release(a)}
				>
					<span class="what">{LABELS[a]}</span>
					<kbd>{KEY_FOR[a]}</kbd>
				</button>
			{/each}
		</div>
	{/if}
</div>

<div class="controls">
	{#if askLevelFor != null}
		<!-- Three RUNGs at 27, 45 and 63 inches. Skippable: a scout who saw a robot
		     get onto the TOWER but could not tell which rung has recorded
		     something true, and forcing a number would make it false. -->
		<div class="rungs" role="group" aria-label="Which rung?">
			<span class="say">Rung</span>
			{#each CLIMB_LEVELS as lvl}
				<button
					type="button"
					class="rung"
					class:on={intervals[askLevelFor]?.lvl === lvl}
					onclick={() => setLevel(askLevelFor, lvl)}
				>
					{lvl}
				</button>
			{/each}
			<button type="button" class="rung skip" onclick={() => setLevel(askLevelFor, null)}>
				Not sure
			</button>
		</div>
	{/if}

	{#if phase === 'place'}
		<p class="say">
			{#if start}Starting {zone ?? 'position'} set.{:else}Drag the robot to where it starts.{/if}
		</p>
		<div class="row">
			<Button variant="primary" disabled={!start} onclick={begin}>
				Start recording<kbd class="on-btn">space</kbd>
			</Button>
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>
				Wall {flipped ? 'left' : 'right'}
			</Button>
			<Button variant="ghost" onclick={() => (full = !full)}>
				{full ? 'Exit full screen' : 'Full screen'}
			</Button>
		</div>
	{:else if phase === 'live'}
		<p class="say live" aria-live="polite">{remaining}s</p>
		<div class="row">
			<Button variant="ghost" onclick={finish}>Stop<kbd class="on-btn">esc</kbd></Button>
			<Button variant="ghost" onclick={() => (handed = handed === 'right' ? 'left' : 'right')}>
				Buttons {handed === 'right' ? 'left' : 'right'}
			</Button>
		</div>
	{:else}
		<p class="say">
			Recorded {(duration / 1000).toFixed(1)}s{zone ? ` from ${zone}` : ''}{stats?.cycles
				? ` · ${stats.cycles} ${stats.cycles === 1 ? 'cycle' : 'cycles'}`
				: ''}
		</p>

		{#if samples.length}
			<label class="scrubber">
				<span>Scrub</span>
				<input
					type="range"
					min="0"
					max={duration}
					step={STEP_MS}
					bind:value={scrub}
					aria-label="Scrub through the recording"
				/>
				<span class="clock">{(scrub / 1000).toFixed(1)}s</span>
			</label>
		{/if}

		{#if intervals.length}
			<ul class="ivs">
				{#each intervals as iv, i}
					<li>
						<span class="what {iv.a}">{LABELS[iv.a]}{#if iv.a === 'climb' && iv.lvl}
								<span class="lvl">L{iv.lvl}</span>{/if}</span>
						<span class="when">{(iv.t0 / 1000).toFixed(1)}–{(iv.t1 / 1000).toFixed(1)}s</span>
						{#if iv.a === 'climb'}
							<button type="button" class="drop" onclick={() => (askLevelFor = i)}>
								{iv.lvl ? 'Change rung' : 'Set rung'}
							</button>
						{/if}
						<button type="button" class="drop" onclick={() => dropInterval(i)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row">
			<Button variant="ghost" onclick={discard}>Record again</Button>
			{#if start || samples.length}
				<Button variant="ghost" onclick={flipRecording}>Flip recording</Button>
			{/if}
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>
				Wall {flipped ? 'left' : 'right'}
			</Button>
			{#if full}
				<Button variant="ghost" onclick={() => (full = false)}>Done</Button>
			{/if}
		</div>
	{/if}
</div>
</div>

<style>
	/* Hallmark · genre: modern-minimal · component: auto-recorder
	 * design-system: design.md
	 */
	.rec {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
	}
	.stage {
		min-width: 0;
	}

	/* ─── full screen ───────────────────────────────────────────────────────
	   The field was sharing a phone with a form, and it is the one thing here
	   that cannot afford to: fifteen seconds of thumb-tracking is the input the
	   whole feature rests on, and it was happening on a 358px-wide picture.

	   In portrait this buys back the form's padding. The real gain is LANDSCAPE,
	   where the field goes from 358px to most of an 844px viewport and the rail
	   moves alongside it — which is why the side-rail breakpoint below is in rem
	   and lands on a phone turned sideways. */
	.shell.full {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: var(--bg-page);
		/* Safe-area insets, not a flat pad: full screen puts the controls against
		   the bottom of a phone, which is where the home indicator lives. */
		padding: max(var(--space-3), env(safe-area-inset-top, 0))
			max(var(--space-3), env(safe-area-inset-right, 0))
			max(var(--space-3), env(safe-area-inset-bottom, 0))
			max(var(--space-3), env(safe-area-inset-left, 0));
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		/* The recorder is the only thing on screen; nothing behind it should
		   scroll under a thumb that misses the field. */
		overflow: hidden;
	}
	.shell.full .rec {
		flex: 1;
		min-height: 0;
		/* stretch, not start. The side-rail breakpoint below sets `align-items:
		   start`, which leaves the stage shrink-to-content tall — so `max-height:
		   100%` on the SVG resolved against `auto` and never bound, and the field
		   rendered 524px tall inside a 390px viewport. */
		align-items: stretch;
	}
	.shell.full .stage {
		min-height: 0;
		min-width: 0;
		display: grid;
		place-items: center;
	}
	/* The SVG owns `width: 100%; height: auto` for the in-form case. Here it has
	   to fit a box in BOTH axes instead, so it is capped on both and left to
	   size itself — preserveAspectRatio does the rest. Reaching in with
	   :global() scoped under this component's own class is the same thing Table
	   does to the rows a page hands it. */
	.shell.full .stage :global(svg.field) {
		width: auto;
		height: auto;
		max-width: 100%;
		max-height: 100%;
	}
	/* The controls own a share of the screen and scroll inside it. Before this
	   they were `flex: none` with no bound, so in full screen a recording with
	   several intervals pushed the row of buttons past the bottom edge with
	   nothing to scroll — the field had taken the space and `overflow: hidden` on
	   the shell did the rest. */
	.shell.full .controls {
		flex: 0 1 auto;
		min-height: 0;
		overflow-y: auto;
		margin-top: 0;
		padding-bottom: env(safe-area-inset-bottom, 0);
	}

	/* ─── landscape full screen: the controls go BESIDE the field ────────────
	   The field wants an aspect of 1.55 and a phone on its side is 2.16, so
	   height is what binds — and a row of controls under it costs the field its
	   whole width. Stacked, full screen rendered a SMALLER field than the form
	   did: 449px against 472px, which is the opposite of the point.

	   Beside, the field gets the full height and about 600px of width. */
	@media (orientation: landscape) {
		.shell.full {
			flex-direction: row;
			align-items: stretch;
		}
		.shell.full .rec {
			flex: 1;
			min-width: 0;
		}
		.shell.full .controls {
			width: 11rem;
			flex: none;
			overflow-y: auto;
			align-content: start;
			padding-left: var(--space-2);
		}
		.shell.full .controls .row {
			flex-direction: column;
			align-items: stretch;
		}
	}

	.rail {
		display: grid;
		gap: var(--space-2);
		/* The rail is what a thumb aims at under time pressure. It gets air above
		   it so a miss lands on carpet rather than on the wrong control. */
		padding-top: var(--space-1);
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		/* Four actions now. Without this the rail is as wide as its widest label
		   times four and overflows a phone rather than sharing the width. */
		min-width: 0;
	}

	/* The plan asks for the rail to swap sides for whichever hand holds the phone.
	   On a phone it is a row under the field, so "handed" reverses the order; the
	   column layout below is where the side actually matters. */
	.rec.left .rail {
		direction: rtl;
	}

	/* The label and its key on one line, centred, with the text allowed to shrink.
	   Stacked they made a tall lozenge whose height changed with whether the key
	   hint was showing, so the rail's rows were different sizes on a laptop and a
	   phone. `min-width: 0` is what stops "Disrupted" from forcing the button
	   wider than its grid track and pushing the rail off a full-screen edge. */
	.act {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: calc(var(--tap-min) * 1.25);
		padding: 0 var(--space-2);
		border: 2px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		font: inherit;
		font-weight: 600;
		/* touch-action, or holding a button scrolls the page on a phone and the
		   interval never closes. */
		touch-action: none;
		user-select: none;
	}
	/* The label WRAPS rather than truncating.
	   "Off path" was already the short name — it replaced "Disrupted" because a
	   truncated control is one a scout has to remember instead of read — and on a
	   375px phone it still came out "Off pa…", which is the same bug with a
	   shorter word in it. There is no name for this action that survives a quarter
	   of a phone's width on one line, so it gets two: the button is 55px tall for
	   the thumb and two lines of body text fit inside that without changing the
	   rail's height. Shrinking the type instead would have kept the baseline tidy
	   and made the control harder to hit, which is the wrong trade on the one
	   surface that is used under a fifteen-second clock. */
	.act .what {
		min-width: 0;
		overflow-wrap: break-word;
		hyphens: none;
		line-height: 1.15;
		text-align: center;
	}
	.act:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.act.on {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	/* The key is shown ON the control rather than explained beside it — the
	   readers build robots and a legend is one more thing between them and the
	   match. Hidden where there is no keyboard to press it. */
	.act kbd {
		font: inherit;
		font-size: var(--fs-xs);
		font-weight: 400;
		opacity: 0.65;
		border: 1px solid currentColor;
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
		line-height: 1.4;
	}
	@media (pointer: coarse) {
		.act kbd {
			display: none;
		}
	}
	.act.fault.on {
		background: var(--warning);
		border-color: var(--warning);
		color: var(--on-alliance);
	}

	/* The controls are a stack of unlike things — a readout, a scrubber, a list,
	   a row of buttons — so they get a full step between them rather than the
	   half-step that suits items of one kind. Everything in here was touching. */
	.controls {
		margin-top: var(--space-4);
		display: grid;
		gap: var(--space-3);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.say {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
	.say.hint {
		color: var(--text-faint);
		font-size: var(--fs-xs);
	}
	.say.live {
		font-size: var(--fs-xl);
		line-height: 1.1;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.scrubber {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}
	.scrubber input {
		flex: 1;
		min-width: 0;
		min-height: var(--tap-min);
	}
	.clock {
		font-variant-numeric: tabular-nums;
		min-width: 3.5em;
		text-align: right;
	}

	/* The rung question interrupts the flow, so it is set off as its own panel
	   rather than sitting flush against the readout above it. */
	.rungs {
		display: flex;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-elev);
	}
	.rung {
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 2px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		font: inherit;
		font-weight: 600;
	}
	.rung:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.rung.on {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.rung.skip {
		font-weight: 400;
		color: var(--text-muted);
	}

	.lvl {
		margin-left: var(--space-1);
		color: var(--text-muted);
		font-weight: 400;
	}

	/* A key badge sitting inside a Button. It is authored HERE, as Button's
	   children, so it already carries this component's scope hash — no :global()
	   is needed and Svelte will not scope a selector written after one anyway. */
	kbd.on-btn {
		font: inherit;
		font-size: var(--fs-xs);
		font-weight: 400;
		margin-left: var(--space-2);
		opacity: 0.75;
		border: 1px solid currentColor;
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
	}
	@media (pointer: coarse) {
		kbd.on-btn {
			display: none;
		}
	}

	.ivs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.ivs li {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: var(--fs-xs);
		/* A rule between rows, not a gap alone: with two buttons on each line the
		   list reads as one run-on paragraph without it. */
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.ivs li:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}
	.what {
		font-weight: 600;
		color: var(--text-primary);
	}
	.when {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.drop {
		margin-left: auto;
		min-height: var(--tap-min);
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-muted);
		font: inherit;
		font-size: var(--fs-xs);
	}
	.drop:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (min-width: 40rem) {
		.rec {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: start;
		}
		.rec.left {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.rec.left .stage {
			order: 2;
		}
		.rec.left .rail {
			order: 1;
			direction: ltr;
		}
		.rail {
			grid-auto-flow: row;
			grid-auto-columns: auto;
			/* A floor, not a fixed width: the rail sits beside the field and a fixed
			   width takes room the field needs on a phone turned sideways. */
			min-width: 7rem;
			max-width: 11rem;
			align-content: center;
		}
	}
</style>
