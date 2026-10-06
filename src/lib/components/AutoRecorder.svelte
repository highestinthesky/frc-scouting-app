<script>
	// Auto, recorded by a thumb.
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
	//   live     the season's length of auto. Drag, hold the action buttons. This
	//            is the only timed part.
	//   correct  scrub, fix, trim, answer. Or throw it away and place again.
	//
	// Everything is skippable and everything is undoable. A required field here
	// would manufacture false data at exactly the moment the real data was
	// unavailable, which is Decision 4 pointed at the input instead of the reader.
	import { onDestroy } from 'svelte';
	import AutoField from './AutoField.svelte';
	import Button from './Button.svelte';
	import {
		SAMPLE_HZ,
		encodeTrack,
		decodeTrack,
		positionAt,
		trackDuration,
		cycleStats,
		describeAnswers
	} from '$lib/auto-track.js';
	import { currentSeason } from '$lib/seasons/index.js';
	import { screen } from '$lib/screen.svelte.js';

	/**
	 * @type {{
	 *   value?: object|null,
	 *   allianceColor?: string|null,
	 *   onchange?: (track: object|null) => void
	 * }}
	 */
	let { value = null, allianceColor = null, onchange } = $props();

	// ─── the season ────────────────────────────────────────────────────────────
	//
	// The game being recorded — its field, its length of auto, its actions and
	// their keys — is the season's, and this file names none of it. A new
	// recording is made on the current season. A track the form already holds is
	// opened on the season it was RECORDED on, because its positions are
	// fractions of that field and its intervals are that game's words; reviewing
	// it on another would draw a plausible path in the wrong places. "Record
	// again" is a new recording, so it returns to the current season.
	//
	// `$state.raw`, not `$state`: a Season is frozen, and is only ever replaced
	// whole. A deep proxy over a frozen object breaks the proxy invariants, and
	// the field compares actions by identity (`season.endgame`), which a proxy
	// would also break.
	let season = $state.raw(currentSeason());

	/** The length of auto. The recorder stops itself. */
	const autoMs = $derived(season.autoMs);
	// Reviewing keeps the cadence written on the track. Changing an answer must
	// not change the timestamps of the positions that were already recorded.
	let hz = $state(SAMPLE_HZ);
	const STEP_MS = $derived(1000 / hz);
	/** The most samples a recording can hold. Derived, so it cannot disagree. */
	const MAX_SAMPLES = $derived(Math.round(autoMs / STEP_MS));

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

	// While the recorder owns the screen, reminders wait. See screen.svelte.js.
	$effect(() => {
		screen.recorder = full || phase === 'live';
		return () => {
			screen.recorder = false;
		};
	});
	/**
	 * Which action's questions are being asked: `'pending'` for the endgame while
	 * the recording is still running and its mark has not been closed yet, an
	 * index into `intervals` afterwards, or null.
	 *
	 * Two forms because the mark does not exist yet at the moment the endgame's
	 * questions are asked. The endgame stays open until the whistle (see
	 * `release`), so during the recording there is nothing to write to — the
	 * answers are parked here and attached when finish() closes it.
	 *
	 * @type {null|'pending'|number}
	 */
	let askFor = $state(null);
	/**
	 * Answers for an endgame that has not been closed into an interval yet, keyed
	 * by question. An unanswered question is ABSENT, never null or zero.
	 *
	 * @type {Record<string, number|string|boolean>}
	 */
	let pendingAnswers = $state({});
	/**
	 * Whether the open sheet is the post-whistle sweep, which walks every interval
	 * with a question still open. Only the sweep's Done moves on to the next one;
	 * a sheet the scout opened on one interval with "Answers" closes on Done,
	 * because that scout asked about that interval and nothing else.
	 */
	let sweeping = false;
	/**
	 * The form holds a track this build cannot read — a season it does not have,
	 * or a version it does not know. Shown, never placed over: the placement
	 * step's first drag would emit a new track and silently replace the stored
	 * one. Only "Record again" discards it, and says so by being pressed.
	 */
	let unreadable = $state(false);

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
				season = d.season;
				hz = d.hz;
				start = d.start;
				here = d.start;
				samples = d.samples.map((s) => ({ x: s.x, y: s.y }));
				intervals = d.intervals.map((iv) => ({ ...iv }));
				phase = 'correct';
			} else {
				unreadable = true;
			}
		}
	});

	const zone = $derived(season.field.startZone(start, allianceColor));
	const preview = $derived(
		decodeTrack(encodeTrack({ start, samples, intervals, hz }, season))
	);
	const stats = $derived(preview ? cycleStats(preview) : null);
	const duration = $derived(preview ? trackDuration(preview) : 0);

	/** Where the robot is at the scrub position, for the correction pass. */
	const atScrub = $derived(preview ? positionAt(preview, scrub) : null);

	function emit() {
		onchange?.(encodeTrack({ start, samples, intervals, hz }, season));
	}

	function place(pos) {
		if (unreadable) return;
		if (phase === 'place') {
			// A start the season's field rules out — inside an obstacle, or outside
			// the robot's own alliance zone — is a placement that could not have
			// happened, and a start position is the single most-asked question of
			// this whole feature — so it is constrained at the input rather than
			// corrected in the reading.
			const p = season.field.clampToStart(pos, allianceColor);
			const first = !start;
			here = p;
			start = p;
			// Full screen opens on the FIRST placement, not when the recording
			// starts. It used to open at `begin`, which meant the field changed size
			// and position — measured at 468x228 to 1104x535, and 468px to the left —
			// at the exact instant the match did. A scout holding the robot when they
			// pressed space had the whole coordinate system move under their hand.
			//
			// Placing is the right moment: it is before the match, there is no clock
			// on it, and a scout who has put the robot down has committed to
			// recording. Everything after it happens at one scale.
			if (first) full = true;
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
		// advances — a recording that decodes at half its length, its motion at
		// twice the speed, with nothing about it looking wrong.
		if (timer) clearInterval(timer);
		samples = [];
		intervals = [];
		held = {};
		askFor = null;
		sweeping = false;
		pendingAnswers = {};
		elapsed = 0;
		here = start;
		phase = 'live';
		startedAt = performance.now();
		// Capture t = 0 before the first drag or delayed timer can move it.
		sampleToNow();
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
	function sampleToNow() {
		elapsed = Math.min(performance.now() - startedAt, autoMs);
		// Held at the last known position. A robot that is not being dragged has
		// not vanished — it is standing still, which is a real thing a robot does
		// in auto and a real thing to record. Filling the gap this way is also the
		// honest reading of a throttled tick: the robot was somewhere, and nobody
		// was asked where.
		const at = here ?? start ?? { x: 0.1, y: 0.5 };
		const want = Math.min(MAX_SAMPLES, Math.floor(elapsed / STEP_MS) + 1);
		while (samples.length < want) samples.push(at);
		samples = samples;
	}

	function tick() {
		if (phase !== 'live') return;
		sampleToNow();
		// `autoMs` is read here, on every tick, rather than captured when the timer
		// started: it is the season's, and the season is state.
		if (elapsed >= autoMs) finish();
	}

	function finish() {
		if (phase !== 'live') return;
		// Stop/Escape can arrive between ticks, including before the first one or
		// after a hidden tab has throttled the timer. Fill to the clock before
		// closing held actions, so neither positions nor action tails are lost.
		sampleToNow();
		if (timer) clearInterval(timer);
		timer = null;
		// Clamped, for the same reason the sampler fills to a clock: a throttled
		// tick can arrive well past the whistle, and a recording of auto is the
		// season's length of auto by definition. Stopping early is the case where
		// this is simply the elapsed time.
		elapsed = Math.min(elapsed, autoMs);
		// Any button still down when the whistle goes is closed at the whistle
		// rather than dropped. A scout holding "scoring" as auto ends recorded
		// something true, and discarding it would lose the longest interval on the
		// track precisely when it mattered.
		const now = Math.round(elapsed);
		for (const [a, t0] of Object.entries(held)) {
			// The endgame's answers were given while it was still open; they belong
			// to the mark that is only now being created. Only answered questions
			// are in `pendingAnswers`, so nothing unanswered is written as a value.
			const iv = a === season.endgame?.key ? { a, t0, t1: now, ...pendingAnswers } : { a, t0, t1: now };
			intervals.push(iv);
		}
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
		// Anything with questions nobody finished answering gets asked here, where
		// there is no clock on it at all: the endgame if it was left half-answered,
		// and every other action whose questions could not be asked mid-match
		// without taking the screen while there was still a field to watch.
		// Unanswered means ANY question outstanding. One at a time, in order; the
		// sheet's Done moves to the next — this sweep, and only this one.
		askFor = nextUnanswered(-1);
		sweeping = askFor !== null;
		pendingAnswers = {};
		emit();
	}

	function press(action) {
		if (phase !== 'live' || held[action] != null) return;
		held = { ...held, [action]: Math.round(performance.now() - startedAt) };
		// The endgame is the end of the robot's auto, so it is the one action that
		// is not a hold, and the one whose questions are asked at once. See
		// `release` and `askFor`.
		if (action === season.endgame?.key && season.endgame.questions?.length) askFor = 'pending';
	}

	function release(action) {
		// Letting go of the endgame does not end it.
		//
		// A robot that has started its endgame has finished its auto — it is where
		// it will finish, and it is not going anywhere else. So the mark stays open
		// and finish() closes it at the whistle, the same way any held action is
		// closed. That is what frees the scout's hands for its questions, which is
		// the whole reason the popup is allowed to take the screen.
		//
		// It also has to work this way for the data. encodeTrack drops any
		// interval with t1 <= t0, so an endgame that ended the recording the
		// instant it began would be silently discarded — the one action the scout
		// most wants recorded, thrown away for being instantaneous.
		if (action === season.endgame?.key) return;
		if (held[action] == null) return;
		const t0 = held[action];
		const t1 = Math.round(performance.now() - startedAt);
		const { [action]: _drop, ...rest } = held;
		held = rest;
		if (t1 > t0) {
			intervals.push({ a: action, t0: Math.min(t0, autoMs), t1: Math.min(t1, autoMs) });
			intervals = intervals;
		}
	}

	// ─── the answers ───────────────────────────────────────────────────────────
	//
	// An action may carry questions only a scout can answer — how high, whether
	// it worked. The answer cannot be recorded while the action is still
	// happening, so the endgame's arrive the moment it is pressed (the robot's
	// auto is over; there is nothing left to watch), and everyone else's wait
	// for the correction pass, where there is no clock on them.
	//
	// Every one is skippable. A scout who saw a robot do it but could not tell
	// how high has recorded something true; forcing a number would turn it into
	// something false, which is Decision 4 pointed at the input.

	/**
	 * Whether a question has an answer on `mark`.
	 *
	 * The value is READ first, and that order is the point. An interval here is a
	 * Svelte `$state` proxy, and `Object.hasOwn` on a key the proxy has never
	 * seen subscribes to nothing — measured: the sheet answered a question and
	 * went on showing "Not sure" selected, because the button never heard. A
	 * property read always subscribes. No option's value is ever `undefined`, so
	 * an undefined read is unanswered; `hasOwn` after it only keeps a question
	 * keyed like an Object.prototype method from reading as answered.
	 *
	 * @param {object} mark
	 * @param {string} key
	 */
	const answered = (mark, key) => mark[key] !== undefined && Object.hasOwn(mark, key);

	/** @param {{a: string}} iv */
	function hasUnanswered(iv) {
		const qs = season.actionByKey[iv.a]?.questions ?? [];
		return qs.some((q) => !answered(iv, q.key));
	}

	/** The first interval after index `after` with a question still open, or null. */
	function nextUnanswered(after) {
		for (let i = after + 1; i < intervals.length; i += 1) {
			if (hasUnanswered(intervals[i])) return i;
		}
		return null;
	}

	/** The action whose questions the sheet is asking, or null. */
	const asking = $derived(
		askFor === 'pending'
			? season.endgame
			: typeof askFor === 'number'
				? (season.actionByKey[intervals[askFor]?.a] ?? null)
				: null
	);
	/** What has been answered so far, wherever the answers currently live. */
	const answers = $derived(
		askFor === 'pending' ? pendingAnswers : typeof askFor === 'number' ? (intervals[askFor] ?? {}) : {}
	);

	/** @param {string} key */
	const isAnswered = (key) => answered(answers, key);

	/**
	 * Answer one question.
	 *
	 * `value` of null is the deliberate "not sure", and it DELETES rather than
	 * storing a zero or a false. A level nobody could read is not level zero and
	 * an outcome nobody judged is not a failure; both would be lies in the same
	 * shape as blank-is-not-zero.
	 *
	 * @param {string} key
	 * @param {number|string|boolean|null} value
	 */
	function answer(key, value) {
		if (askFor === 'pending') {
			const { [key]: _drop, ...rest } = pendingAnswers;
			pendingAnswers = value == null ? rest : { ...rest, [key]: value };
			return;
		}
		const iv = typeof askFor === 'number' ? intervals[askFor] : null;
		if (!iv) return;
		// Replaced, not mutated. A `delete` on a `$state` proxy leaves the key on
		// the object underneath, and everything that renders this interval — the
		// sheet, the list's answers — should see one new interval rather than
		// depend on which property reads a proxy happens to track.
		const { [key]: _drop, ...rest } = iv;
		intervals[askFor] = value == null ? rest : { ...rest, [key]: value };
		emit();
	}

	/** "Answers" on one interval: ask its questions, and only its. */
	function openAnswers(i) {
		sweeping = false;
		askFor = i;
	}

	/**
	 * The sheet's Done. During the post-whistle sweep, on to the next interval
	 * still waiting; otherwise close. Advancing after a sheet the scout opened
	 * by hand would walk them into a question about some other interval they
	 * never asked to see.
	 */
	function doneAsking() {
		if (sweeping && typeof askFor === 'number') {
			askFor = nextUnanswered(askFor);
			if (askFor === null) sweeping = false;
			return;
		}
		askFor = null;
		sweeping = false;
	}

	function dropInterval(i) {
		intervals.splice(i, 1);
		intervals = intervals;
		emit();
	}

	function discard() {
		start = null;
		here = null;
		samples = [];
		intervals = [];
		held = {};
		askFor = null;
		sweeping = false;
		pendingAnswers = {};
		elapsed = 0;
		scrub = 0;
		phase = 'place';
		unreadable = false;
		// A new recording is made on the current season, whatever the one being
		// thrown away was recorded on.
		season = currentSeason();
		hz = SAMPLE_HZ;
		emit();
	}

	// ─── keys, for the half of the team on a laptop ────────────────────────────
	//
	// A drag-only control with hold-to-record buttons is a two-hand job, and on a
	// desktop one of those hands is on the mouse. Each action's key is the
	// season's (`hotkey`); why those letters is written beside them there.
	//
	// Bound on the window rather than the component: the pointer is captured by
	// the SVG during a drag, so a listener on the recorder would only fire when
	// focus happened to be inside it — which, mid-drag, it is not.
	/** hotkey -> action key. */
	const KEYS = $derived(Object.fromEntries(season.actions.map((a) => [a.hotkey, a.key])));

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
		// Enter is across the keyboard from the action keys and under the hand that is on
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
		// focus. The recorder owns the keyboard for the length of auto.
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

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const remaining = $derived(Math.max(0, Math.ceil((autoMs - elapsed) / 1000)));
	// Marks, not names: the field draws the endgame's chip from its answers — a
	// different picture per level, and another for one that failed — so it needs the answers and not just "the endgame is happening".
	// During the recording those answers live in `pendingAnswers`; the mark
	// itself does not exist until the whistle.
	const activeNow = $derived(
		Object.keys(held).map((a) => (a === season.endgame?.key ? { a, ...pendingAnswers } : { a }))
	);
</script>

<div class="shell" class:full>
<div class="rec" class:left={handed === 'left'}>
	<div class="stage">
		<!-- `phase` and `mode` deliberately disagree in the last state: the pass
		     still corrects — trim an action, answer its questions, turn the track end for end
		     — but the FIELD is read-only, because those are the corrections that do
		     not invent a position. -->
		<AutoField
			{season}
			mode={phase === 'correct' || unreadable ? 'review' : 'record'}
			position={phase === 'correct' ? atScrub : here}
			trail={phase === 'place' ? [] : samples}
			{flipped}
			{rotated}
			active={activeNow}
			onmove={place}
		/>
	</div>

	<!-- Rendered whenever the recorder owns the screen, not only while it is
	     recording, and hidden rather than removed outside that.
	     Taking it out of the grid gave the stage its row back, so the field grew
	     the moment the whistle went and shrank again when it ended — the scale
	     "snapping" twice per recording. Reserving the space costs a strip that is
	     empty for a few seconds either side and buys a picture that never moves. -->
	{#if full || phase === 'live'}
		<div class="rail" class:idle={phase !== 'live'} aria-label="Actions" aria-hidden={phase !== 'live'}>
			{#each season.actions as a (a.key)}
				<button
					type="button"
					class="act tone-{a.tone}"
					class:on={held[a.key] != null}
					onpointerdown={() => press(a.key)}
					onpointerup={() => release(a.key)}
					onpointerleave={() => release(a.key)}
					onpointercancel={() => release(a.key)}
				>
					<span class="what">{a.label}</span>
					<kbd>{a.hotkey.toUpperCase()}</kbd>
				</button>
			{/each}
		</div>
	{/if}
</div>

<div class="controls">
	{#if unreadable}
		<p class="say">Recorded on a field this build does not have.</p>
		<div class="row">
			<Button variant="ghost" onclick={discard}>Record again</Button>
		</div>
	{:else if phase === 'place'}
		<p class="say">
			{#if start}{zone ?? 'Start position'}{:else}Drag the robot to its start.{/if}
		</p>
		<div class="row">
			<Button variant="primary" disabled={!start} onclick={begin}>
				Start recording<kbd class="on-btn">space</kbd>
			</Button>
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>
				Wall {flipped ? 'left' : 'right'}
			</Button>
			<!-- "Exit", not "Exit full screen", and the difference is 52px of layout.
			     At 375px the three buttons here measured 149 + 106 + 145 against 351
			     of row, so the third wrapped — and the controls block was then a row
			     taller in this phase than during the recording, which is where the
			     field's 7% jump at the whistle came from. The full phrase stays as
			     the accessible name; only the visible label is short. -->
			<Button
				variant="ghost"
				onclick={() => (full = !full)}
				aria-label={full ? 'Exit full screen' : 'Enter full screen'}
			>
				{full ? 'Exit' : 'Full screen'}
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
					{@const action = season.actionByKey[iv.a]}
					<li>
						<span class="what">{action?.label ?? iv.a}{#each describeAnswers(action, iv) as said}
								<span class="lvl">{said}</span>{/each}</span>
						<!-- The endgame runs to the whistle by construction, so its span is a
						     fact about the recording and not about the robot. What was
						     observed is the moment it began. -->
						<span class="when">
							{#if action === season.endgame}began {(iv.t0 / 1000).toFixed(1)}s{:else}{(
									iv.t0 / 1000
								).toFixed(1)}–{(iv.t1 / 1000).toFixed(1)}s{/if}
						</span>
						{#if action?.questions?.length}
							<button type="button" class="drop" onclick={() => openAnswers(i)}>
								Answers
							</button>
						{/if}
						<button type="button" class="drop" onclick={() => dropInterval(i)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Two controls used to live here and both could only do harm.
		     "Wall left/right" turns the PICTURE round, which is for aiming a thumb
		     at a field you are looking at. The recording is over; there is nothing
		     left to aim, and the two ends now carry their alliance's own colour, so
		     the orientation is legible without touching anything.
		     "Flip recording" turned the TRACK 180 degrees. For a manager comparing
		     six tracks that is the repair for a scout who read the field backwards.
		     In the scout's own hands it is never right: clampToStart() pinned this
		     start to their own alliance's end, so a flip always lands it on the
		     opponent's — a recording that could not have happened. It lives on the
		     match page, where a mirrored track is actually visible against five
		     others. -->
		<div class="row">
			<Button variant="ghost" onclick={discard}>Record again</Button>
			{#if full}
				<Button variant="ghost" onclick={() => (full = false)}>Done</Button>
			{/if}
		</div>
	{/if}
</div>
</div>

<!-- ─── the answers sheet ────────────────────────────────────────────────────
     For the endgame it opens at the press. A robot that has started its endgame
     has finished its auto. That is what earns this
     the whole screen: there is nothing left on the field to watch, so the
     questions only a scout can answer get asked while the answer is still in
     their head, instead of being reconstructed at a table afterwards. For every
     other action it waits for the whistle, one interval after another.

     Every question is skippable, and "Not sure" is a real answer rather than a
     way out. A level nobody could read is not level zero, and an outcome nobody
     judged is not a failure — forcing either would manufacture the exact false data
     the recording exists to avoid.

     No heading: the questions are the heading. -->
{#if asking?.questions?.length}
	<div class="sheet" role="dialog" aria-modal="true" aria-label={asking.label}>
		<div class="sheet-in">
			{#each asking.questions as q (q.key)}
				<p class="q">{q.ask}</p>
				<div class="opts" role="group" aria-label={q.ask}>
					{#each q.options as o (o.value)}
						<button
							type="button"
							class="opt"
							class:on={isAnswered(q.key) && answers[q.key] === o.value}
							onclick={() => answer(q.key, o.value)}
						>
							{o.label}
						</button>
					{/each}
					<button
						type="button"
						class="opt skip"
						class:on={!isAnswered(q.key)}
						onclick={() => answer(q.key, null)}
					>
						Not sure
					</button>
				</div>
			{/each}

			<Button variant="primary" full onclick={doneAsking}>Done</Button>
		</div>
	</div>
{/if}

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
	   that cannot afford to: auto's worth of thumb-tracking is the input the
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
		/* The field's row takes the slack, the rail's row takes its content. With
		   both rows `auto` the slack was shared between them, and a season whose
		   field is squarer than 2026's leaves slack on a phone held upright: its
		   rail buttons were measured at 133px tall at 375x812 — a third of the
		   screen of buttons, pushed away from the field. */
		grid-template-rows: minmax(0, 1fr) auto;
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
	/* The controls take what they need and no more than this.
	   `flex: 0 1 auto` alone means "as tall as the content", and the review pass's
	   content has no ceiling — one interval per row, six or eight of them, and the
	   field was pushed from 626px to 432px by a list. Capping it bounds how much
	   the picture can change when the recording ends, and the overflow that was
	   already declared here finally has something to do.

	   Not zero change: the field IS smaller during review than during recording,
	   and that is the right way round. Holding the review pass's height open
	   through the recording would spend the screen on an empty box at the
	   one moment the field is the input. */
	.shell.full .controls {
		flex: 0 1 auto;
		min-height: 0;
		max-height: 40%;
		overflow-y: auto;
		margin-top: 0;
		padding-bottom: env(safe-area-inset-bottom, 0);
	}

	/* ─── a phone on its side: the controls go BESIDE the field ──────────────
	   The field wants an aspect of 1.55 and a phone on its side is 2.16, so
	   height is what binds — and a row of controls under it costs the field its
	   whole width. Stacked, full screen rendered a SMALLER field than the form
	   did: 449px against 472px, which is the opposite of the point.

	   Beside, the field gets the full height and about 600px of width.

	   The height bound is not decoration. This was keyed on `orientation:
	   landscape` alone, and A DESKTOP IS LANDSCAPE — so a 1440x900 screen got the
	   layout designed for a 390px-tall phone: the scrubber, the interval list and
	   every button squeezed into an 11rem column that ran 876px tall and put half
	   of itself past the bottom of the screen. 30rem is the line between a phone
	   turned sideways (24.4rem tall) and anything with room to stack. */
	@media (orientation: landscape) and (max-height: 30rem) {
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

	/* Present but inert outside the recording. `visibility` rather than `display`
	   on purpose: it keeps the grid row, which is the entire reason it is here. */
	.rail.idle {
		visibility: hidden;
		pointer-events: none;
	}
	.rail {
		display: grid;
		gap: var(--space-2);
		/* The rail is what a thumb aims at under time pressure. It gets air above
		   it so a miss lands on carpet rather than on the wrong control. */
		padding-top: var(--space-1);
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		/* As many columns as the season has actions. Without this the rail is as
		   wide as its widest label times their number and overflows a phone rather
		   than sharing the width. */
		min-width: 0;
		/* One row of equal shares: it does not grow past ~6 actions on a short phone. */
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
	   phone. `min-width: 0` is what stops a long label from forcing the button
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
		/* Holding an action IS a long-press, and iOS answers a long-press on text
		   with a selection and a loupe. WebKit does not support the unprefixed
		   property at all (measured on iOS 18.7: CSS.supports is false), so
		   without the prefix this line did nothing on the phones it was written
		   for. The callout is the share/copy menu the same press summons. */
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
	/* Action labels stay on one line; narrow layouts omit keyboard hints. */
	.act .what {
		min-width: 0;
		white-space: nowrap;
		color: inherit;
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
	@media (max-width: 39.9375rem) {
		.rail { grid-auto-flow: row; grid-template-columns: repeat(auto-fit, minmax(min(4rem, 100%), 1fr)); }
		.act { padding: 0 var(--space-1); gap: var(--space-1); font-size: var(--fs-sm); }
		.act kbd, kbd.on-btn { display: none; }
	}
	/* The tone is the season's, per action. Only a warning has its own on-state;
	   `accent` and `success` both light up in the accent. */
	.act.tone-warning.on {
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
	/* The readout reserves the height of its own tallest state.
	   `.say.live` is --fs-xl and the others are --fs-sm, so without this the
	   controls block changed height at the whistle for the text alone — the same
	   jump the row above was making, ten pixels smaller. Reserving it here costs
	   nothing: this line is never the reason the field is short. */
	.say {
		margin: 0;
		min-height: calc(var(--fs-xl) * 1.1);
		display: flex;
		align-items: center;
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

	/* The answers sheet. Fixed to the viewport rather than placed in the controls:
	   it is asked WHILE the recording is still running, and the recorder may or
	   may not be in full screen at the time, so it cannot be a child of either
	   layout. z-index clears the full-screen shell's 50. */
	.sheet {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: max(var(--space-4), env(safe-area-inset-top, 0))
			max(var(--space-4), env(safe-area-inset-right, 0))
			max(var(--space-4), env(safe-area-inset-bottom, 0))
			max(var(--space-4), env(safe-area-inset-left, 0));
		/* Opaque, not a scrim. The field behind it has nothing left to show — the
		   robot has finished its auto — and a translucent panel over a drawn field is
		   the hardest thing to read on this screen. */
		background: var(--bg-page);
	}
	.sheet-in {
		width: min(var(--w-form), 100%);
		max-height: 100%;
		overflow-y: auto;
		display: grid;
		gap: var(--space-3);
	}
	.q {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 700;
		color: var(--text-primary);
	}
	.opts {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	/* Thumb-sized and then some. This is answered once, under no clock, and
	   usually one-handed while the other hand is still holding the phone. */
	.opt {
		flex: 1 1 auto;
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
	.opt:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.opt.on {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	/* "Not sure" reads as the lighter answer without becoming a way out: it is
	   selectable and it selects, because it is the honest answer more often than
	   any single option is. */
	.opt.skip {
		font-weight: 400;
		color: var(--text-muted);
	}
	.opt.skip.on {
		color: var(--on-accent);
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

	/* The list scrolls in its own box rather than growing without limit. It is
	   the only part of the review pass whose height depends on what the scout
	   did, so it is the only part that can push the field around. */
	.ivs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
		max-height: 9rem;
		overflow-y: auto;
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
		/* Beside the field there is one row. A second, empty one would still be
		   given a gap, taken out of the field's height. */
		.shell.full .rec {
			grid-template-rows: minmax(0, 1fr);
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
