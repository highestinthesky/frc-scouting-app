<script>
	// A modal sheet for a short list of choices: the phone nav's More, and the
	// event switcher in the app bar.
	//
	// Native <dialog> with showModal(), for the same reasons Dialog.svelte gives:
	// focus is trapped, Escape closes it, and the backdrop is the browser's. It is
	// a separate component rather than a mode of Dialog because Dialog is the
	// app's one confirm prompt, driven from a store, and a menu is not a question.
	//
	// The parent owns `open`. Closing by Escape or a backdrop tap writes it back.

	/** @type {{ open: boolean, label: string, children: import('svelte').Snippet }} */
	let { open = $bindable(false), label, children } = $props();

	let el = $state(/** @type {HTMLDialogElement|null} */ (null));

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});

	function onClose() {
		open = false;
	}

	// The <dialog> fills the viewport and the card sits inside it, so a click
	// whose target is the dialog itself landed on the backdrop.
	function onBackdrop(event) {
		if (event.target === el) open = false;
	}
</script>

<dialog bind:this={el} class="sheet" aria-label={label} onclose={onClose} onclick={onBackdrop}>
	<div class="card">
		<div class="head">
			<h2>{label}</h2>
			<button type="button" class="close" onclick={() => (open = false)} aria-label="Close">
				<span aria-hidden="true">×</span>
			</button>
		</div>
		{@render children()}
	</div>
</dialog>

<style>
	/* The browser hides a closed <dialog> with `dialog:not([open])` at (0,1,1),
	   and Svelte's scoping hash lifts any rule here to (0,2,0), so a bare
	   `.sheet { display: flex }` would render the closed sheet inline on every
	   page. State the hidden case, and lay out only when open. */
	.sheet:not([open]) {
		display: none;
	}
	.sheet {
		padding: 0;
		border: none;
		background: none;
		max-width: none;
		max-height: none;
		width: 100%;
		height: 100%;
	}
	.sheet[open] {
		/* Low on a phone, where the thumb is and where the bar it came from is. */
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.sheet::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	.card {
		width: 100%;
		max-width: var(--w-form);
		max-height: 80dvh;
		overflow-y: auto;
		margin: var(--space-4);
		margin-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		padding: var(--space-4);
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		font: inherit;
		font-size: var(--fs-xl);
		line-height: 1;
		color: var(--text-muted);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.close:hover {
		background: var(--bg-subtle);
		color: var(--text-primary);
	}

	@media (min-width: 40rem) {
		.sheet[open] {
			align-items: center;
		}
		.card {
			margin-bottom: var(--space-4);
		}
	}
</style>
