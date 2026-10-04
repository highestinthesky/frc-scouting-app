<script>
	// The recorder, run against its own countdown, with nothing kept.
	//
	// AutoRecorder has never been used by a real scout, and the first real use
	// will be a competition. A scout can learn it here, on their own phone, as
	// often as they like: this page hands the recorder `value={null}` and an
	// `onchange` that discards. It touches no IndexedDB table, writes no draft and
	// reaches no sync — there is nothing to unwind afterwards, which is what makes
	// it safe to hammer.
	//
	// The alliance is a choice rather than a given because there is no match to
	// derive it from. Changing it re-keys the recorder, so a half-finished
	// recording from the other end of the field is not carried across.
	import { currentSeason } from '$lib/seasons/index.js';
	import AutoRecorder from '$lib/components/AutoRecorder.svelte';

	const season = currentSeason();

	/** @type {'red'|'blue'} */
	let alliance = $state('red');
</script>

<svelte:head>
	<title>Practice · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<h1>Practice</h1>
		<p class="season">{season.year} {season.name}</p>
	</header>

	<div class="alliance-row" role="group" aria-label="Alliance">
		{#each [['red', 'Red'], ['blue', 'Blue']] as [value, label] (value)}
			<button
				type="button"
				class="alliance-btn"
				data-color={value}
				aria-pressed={alliance === value}
				onclick={() => (alliance = /** @type {'red'|'blue'} */ (value))}
			>{label}</button>
		{/each}
	</div>

	{#key alliance}
		<AutoRecorder allianceColor={alliance} value={null} onchange={() => {}} />
	{/key}
</main>

<style>
	/* Same column as the entry form, which is the screen this rehearses. */
	main {
		max-width: var(--w-form);
		margin: var(--space-4) auto;
		padding: var(--space-6) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}
	.page-head {
		margin: 0 0 var(--space-4);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		letter-spacing: -0.02em;
	}
	.season {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}

	.alliance-row {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.alliance-btn {
		flex: 1 1 0;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: 600;
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-short) var(--ease-out);
	}
	.alliance-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	/* Pressed is border AND fill AND text, never colour alone: the word on the
	   button is the first signal and the alliance hue only agrees with it. */
	.alliance-btn[aria-pressed='true'] {
		color: var(--on-alliance);
		border-color: var(--alliance-red);
		background: var(--alliance-red);
	}
	.alliance-btn[aria-pressed='true'][data-color='blue'] {
		border-color: var(--alliance-blue);
		background: var(--alliance-blue);
	}

	@media (prefers-reduced-motion: reduce) {
		.alliance-btn {
			transition-duration: 0.01ms;
		}
	}
</style>
