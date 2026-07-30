<script>
	// The app's confirm dialog. Mounted once in +layout.svelte; pages drive it
	// through $lib/dialog.svelte.js rather than mounting their own.
	//
	// Built on the native <dialog> element with showModal(), which supplies the
	// focus trap, the inert background, Escape handling and the ::backdrop
	// scrim for free. Hand-rolling those is how modals end up unusable with a
	// keyboard, and this app has a no-new-dependencies rule that rules out
	// reaching for a library.
	import { dialog } from '$lib/dialog.svelte.js';

	let el = $state(/** @type {HTMLDialogElement|null} */ (null));

	// Drive the element from store state. showModal() throws if called on an
	// already-open dialog, hence the guards.
	$effect(() => {
		if (!el) return;
		if (dialog.open && !el.open) el.showModal();
		else if (!dialog.open && el.open) el.close();
	});

	// Escape and the close button both fire `close`. Route them to the same
	// answer window.confirm() would give: no.
	function onClose() {
		if (dialog.open) dialog._dismiss();
	}

	// Click outside the card. The <dialog> element itself fills the viewport,
	// so a click landing on it rather than on a child is a backdrop click.
	function onBackdrop(event) {
		if (event.target === el) dialog._dismiss();
	}
</script>

<dialog bind:this={el} class="dlg" onclose={onClose} onclick={onBackdrop} aria-labelledby="dlg-title">
	<div class="card">
		<h2 id="dlg-title">{dialog.title}</h2>

		{#if dialog.paragraphs.length}
			<div class="body">
				{#each dialog.paragraphs as p, i (i)}
					<p>{p}</p>
				{/each}
			</div>
		{/if}

		<div class="actions">
			<!-- Cancel first in the DOM so it takes initial focus. The safe
			     option should be the one a stray Enter press lands on. -->
			<button type="button" class="btn secondary" onclick={() => dialog._dismiss()}>
				{dialog.cancelLabel}
			</button>
			<button
				type="button"
				class="btn"
				class:primary={!dialog.danger}
				class:danger={dialog.danger}
				onclick={() => dialog._accept()}
			>
				{dialog.confirmLabel}
			</button>
		</div>
	</div>
</dialog>

<style>
	/* Hallmark · genre: modern-minimal · component: dialog
	 * design-system: design.md · designed-as-app
	 * states: default · hover · focus-visible · active
	 * contrast: AA pass, both themes
	 */

	/* A closed <dialog> is hidden by the browser's own
	   `dialog:not([open]) { display: none }`, which is specificity (0,1,1).
	   Svelte scopes component styles by appending a hash class, so a plain
	   `.dlg { display: flex }` here compiles to `.dlg.svelte-xxxx` — (0,2,0),
	   which OUTRANKS the browser rule. The dialog then renders inline in the
	   page with its buttons visible, on every route, always.
	   Hence: state the hidden case explicitly, and only lay out when open. */
	.dlg:not([open]) {
		display: none;
	}

	.dlg {
		/* Reset the UA's centring box so the card owns its own geometry. */
		padding: 0;
		border: none;
		background: none;
		max-width: none;
		max-height: none;
		width: 100%;
		height: 100%;
	}

	.dlg[open] {
		/* Anchored low rather than centred: on a phone this is reachable, and
		   the buttons land near where the thumb already is. Centred from 40rem,
		   where there is no reach problem to solve. */
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.dlg::backdrop {
		background: rgb(0 0 0 / 0.5);
	}

	.card {
		width: 100%;
		max-width: 26rem;
		margin: var(--space-4);
		margin-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		padding: var(--space-5);
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		font-family: system-ui, -apple-system, sans-serif;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.body p {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-md);
		line-height: 1.45;
		color: var(--text-muted);
	}
	.body p:last-child { margin-bottom: 0; }

	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}
	.btn {
		flex: 1 1 0;
		min-height: var(--tap-min);
		font: inherit;
		font-weight: 600;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		cursor: pointer;
		transition: background-color var(--dur-short) var(--ease-out);
	}
	.btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.btn.secondary {
		background: var(--bg-card);
		color: var(--text-primary);
		border-color: var(--border-strong);
	}
	.btn.secondary:hover { background: var(--bg-subtle); }

	.btn.primary {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.btn.primary:hover { background: var(--accent-hover); }

	/* Destructive: outlined at rest, filled on hover. Per design.md — a
	   delete button should not look like the obvious thing to press. */
	.btn.danger {
		background: var(--bg-card);
		color: var(--danger);
		border-color: var(--danger);
	}
	.btn.danger:hover {
		background: var(--danger);
		color: var(--on-accent);
	}

	@media (min-width: 40rem) {
		.dlg[open] { align-items: center; }
		.card { margin-bottom: var(--space-4); }
	}

	@media (prefers-reduced-motion: reduce) {
		.btn { transition-duration: 0.01ms; }
	}
</style>
