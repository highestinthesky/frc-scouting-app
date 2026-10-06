<script>
	// The event, in the app bar, as a control — for a manager.
	//
	// Before the shell merged, a manager chose the event in Settings, outside
	// Studio, and /studio/event kept a second `selectedId` that could disagree
	// with it. Now the event is chosen here, on every page, and it is the same
	// value the device records to: session.eventCode. One event per device; no
	// page keeps its own idea of which one it is on.
	//
	// Rendered for managers only. A scout does not choose — EventPicker's header
	// has the reasoning — and keeps the bold code the bar always showed, which
	// the layout renders exactly as before.
	//
	// The picker inside is EventPicker, the same component Settings renders,
	// including "+ New event". The sheet closes when the event changes, because
	// that is the answer the manager came for.

	import { session } from '$lib/session.svelte.js';
	import EventPicker from './EventPicker.svelte';
	import Sheet from './Sheet.svelte';

	let open = $state(false);

	// Read the code before anything else so the effect tracks it, then close on
	// any change after the sheet opened.
	let codeAtOpen = '';
	$effect(() => {
		const code = session.eventCode;
		if (!open) {
			codeAtOpen = code;
			return;
		}
		if (code !== codeAtOpen) open = false;
	});
</script>

<button
	type="button"
	class="switch"
	aria-haspopup="dialog"
	aria-expanded={open}
	aria-label="Event: {session.eventCode || 'none chosen'}. Change event"
	onclick={() => (open = true)}
>
	<span class="code">{session.eventCode || 'Choose event'}</span>
	<span class="caret" aria-hidden="true">▾</span>
</button>
<Sheet bind:open label="Event">
	<EventPicker />
</Sheet>

<style>
	.code {
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}
	/* The bar's one control besides sync, so it is outlined the way the Studio
	   button was: a button reads as a button against the fixed purple, and the
	   role badge stays the only filled thing. */
	.switch {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-min);
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--bar-ink);
		background: transparent;
		border: 1px solid var(--bar-edge);
		border-radius: var(--radius-md);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color var(--dur-short) var(--ease-out),
			color var(--dur-short) var(--ease-out);
	}
	.switch:hover {
		background: var(--bar-ink);
		color: var(--bar-bg);
	}
	.switch:focus-visible {
		outline: 2px solid var(--bar-ink);
		outline-offset: 2px;
	}
	.caret {
		font-size: var(--fs-xs);
		opacity: 0.85;
	}
	@media (prefers-reduced-motion: reduce) {
		.switch {
			transition-duration: 0.01ms;
		}
	}
</style>
