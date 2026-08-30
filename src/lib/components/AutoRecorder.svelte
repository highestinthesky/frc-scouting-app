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
	import { SAMPLE_HZ, ACTIONS, encodeTrack, decodeTrack, positionAt, trackDuration, cycleStats } from '$lib/auto-track.js';
	import { startZone } from '$lib/field.js';

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
	const scrubIndex = $derived(Math.min(samples.length - 1, Math.round(scrub / STEP_MS)));

	function emit() {
		onchange?.(encodeTrack({ start, samples, intervals, hz: SAMPLE_HZ }));
	}

	function place(pos) {
		here = pos;
		if (phase === 'place') {
			start = pos;
			emit();
		} else if (phase === 'live') {
			// Live drag only moves the robot; the sampler is what writes it down, at
			// a fixed cadence. Recording on every pointer event instead would give a
			// track whose density depends on how fast the scout's thumb moved, and
			// the timestamps would stop being derivable from the index.
		} else if (phase === 'correct') {
			// Correcting rewrites the sample under the scrub head. This is the whole
			// point of the pass: the live drag got the shape, and this buys back the
			// two hundred milliseconds of human lag on the parts that matter.
			if (scrubIndex >= 0 && scrubIndex < samples.length) {
				samples[scrubIndex] = pos;
				samples = samples;
			} else if (samples.length === 0) {
				start = pos;
			}
			emit();
		}
	}

	function begin() {
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
		scrub = 0;
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
		}
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
		elapsed = 0;
		scrub = 0;
		phase = 'place';
		emit();
	}

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const remaining = $derived(Math.max(0, Math.ceil((AUTO_MS - elapsed) / 1000)));
	const activeNow = $derived(Object.keys(held));
	const LABELS = { collect: 'Collecting', score: 'Scoring', fault: 'Disrupted' };
</script>

<div class="rec" class:left={handed === 'left'}>
	<div class="stage">
		<AutoField
			mode={phase === 'live' ? 'record' : phase === 'correct' ? 'correct' : 'record'}
			position={phase === 'correct' ? atScrub : here}
			trail={phase === 'place' ? [] : samples}
			{flipped}
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
					{LABELS[a]}
				</button>
			{/each}
		</div>
	{/if}
</div>

<div class="controls">
	{#if phase === 'place'}
		<p class="say">
			{#if start}Starting {zone ?? 'position'} set.{:else}Drag the robot to where it starts.{/if}
		</p>
		<div class="row">
			<Button variant="primary" disabled={!start} onclick={begin}>Start recording</Button>
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>Flip field</Button>
			<Button variant="ghost" onclick={() => (handed = handed === 'right' ? 'left' : 'right')}>
				Buttons {handed === 'right' ? 'left' : 'right'}
			</Button>
		</div>
	{:else if phase === 'live'}
		<p class="say live" aria-live="polite">{remaining}s</p>
		<div class="row">
			<Button variant="ghost" onclick={finish}>Stop early</Button>
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
			<p class="say hint">Drag the robot to correct where it was at this moment.</p>
		{/if}

		{#if intervals.length}
			<ul class="ivs">
				{#each intervals as iv, i}
					<li>
						<span class="what {iv.a}">{LABELS[iv.a]}</span>
						<span class="when">{(iv.t0 / 1000).toFixed(1)}–{(iv.t1 / 1000).toFixed(1)}s</span>
						<button type="button" class="drop" onclick={() => dropInterval(i)}>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="row">
			<Button variant="ghost" onclick={discard}>Record again</Button>
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>Flip field</Button>
		</div>
	{/if}
</div>

<style>
	/* Hallmark · genre: modern-minimal · component: auto-recorder
	 * design-system: design.md
	 */
	.rec {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}
	.stage {
		min-width: 0;
	}

	.rail {
		display: grid;
		gap: var(--space-2);
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
	}

	/* The plan asks for the rail to swap sides for whichever hand holds the phone.
	   On a phone it is a row under the field, so "handed" reverses the order; the
	   column layout below is where the side actually matters. */
	.rec.left .rail {
		direction: rtl;
	}

	.act {
		min-height: calc(var(--tap-min) * 1.4);
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
	.act:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.act.on {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.act.fault.on {
		background: var(--warning);
		border-color: var(--warning);
		color: var(--on-alliance);
	}

	.controls {
		margin-top: var(--space-3);
		display: grid;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
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
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.scrubber {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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

	.ivs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.ivs li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-xs);
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
			min-width: 9rem;
		}
	}
</style>
