<script>
	// Tiny inline trend line for a metric's raw readings, oldest to newest.
	//
	// No axes and no numbers — the surrounding card already states the mean,
	// median and range. This only answers "is the shape steady, climbing, or
	// falling?", which is the one thing a table of statistics hides.

	/**
	 * values          — numbers in chronological order
	 * higherIsBetter  — flips the fill colour so "good" always reads as accent
	 */
	let { values = [], higherIsBetter = true } = $props();

	const W = 90;
	const H = 24;
	const PAD = 2;

	const points = $derived.by(() => {
		if (!values || values.length < 2) return null;
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min;
		const stepX = (W - PAD * 2) / (values.length - 1);
		return values.map((v, i) => {
			const x = PAD + i * stepX;
			// A flat series has no span to scale against — park it on the midline
			// rather than dividing by zero.
			const norm = span === 0 ? 0.5 : (v - min) / span;
			const y = H - PAD - norm * (H - PAD * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
	});

	const path = $derived(points ? points.join(' ') : '');

	// Direction of the last segment, used only for the endpoint dot colour.
	const rising = $derived.by(() => {
		if (!values || values.length < 2) return null;
		const delta = values[values.length - 1] - values[values.length - 2];
		if (delta === 0) return null;
		return higherIsBetter ? delta > 0 : delta < 0;
	});

	const lastPoint = $derived(points ? points[points.length - 1].split(',') : null);
</script>

{#if path}
	<svg
		class="spark"
		viewBox="0 0 {W} {H}"
		width={W}
		height={H}
		aria-hidden="true"
		preserveAspectRatio="none"
	>
		<polyline
			points={path}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if lastPoint}
			<circle
				cx={lastPoint[0]}
				cy={lastPoint[1]}
				r="2"
				class:good={rising === true}
				class:bad={rising === false}
			/>
		{/if}
	</svg>
{:else}
	<!-- One reading is not a trend. Reserve the height so cards stay aligned. -->
	<div class="spark-empty" aria-hidden="true"></div>
{/if}

<style>
	.spark {
		display: block;
		width: 100%;
		height: 24px;
		color: var(--text-faint);
	}
	circle { fill: var(--text-faint); }
	/* was var(--ok, var(--accent)) — --ok has never existed, so an improving
	   trend rendered in brand purple next to a declining one in red. The
	   fallback made a missing token look like a design choice. */
	circle.good { fill: var(--success); }
	circle.bad { fill: var(--danger); }
	.spark-empty { height: 24px; }
</style>
