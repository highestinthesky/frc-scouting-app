<script>
	// The app's button. One definition of the CTA voice from design.md, instead
	// of the same forty lines of CSS copy-pasted into nine files.
	//
	//     <Button onclick={save}>Save assignments</Button>
	//     <Button variant="primary" disabled={busy}>Publish</Button>
	//     <Button variant="danger" onclick={clearAll}>Clear entries</Button>
	//
	// Three variants, matching design.md § CTA voice:
	//
	//   primary    filled accent. One per screen region — if a section has two,
	//              one of them is not the primary action.
	//   secondary  outlined. The default, because most buttons are not the
	//              primary action and defaulting to primary is how a screen
	//              ends up with five of them.
	//   danger     outlined in --danger, filling only on hover. A destructive
	//              button should not look like the obvious thing to press.
	//
	// Not every button in the app belongs here. A ✕ in a modal header, a match
	// -number chip, a remove-row ×: those are page furniture with their own
	// shape, and forcing them through a variant prop would make this component
	// a dumping ground. They keep their own styles.

	/**
	 * @type {{
	 *   variant?: 'primary'|'secondary'|'danger',
	 *   type?: 'button'|'submit',
	 *   full?: boolean,
	 *   class?: string,
	 *   children: import('svelte').Snippet
	 * } & Record<string, any>}
	 */
	let {
		variant = 'secondary',
		// Defaults to "button" deliberately. The HTML default is "submit", which
		// inside a <form> silently submits it — a bug that only shows up when
		// someone presses Enter.
		type = 'button',
		full = false,
		// Renders an <a> instead. "Compare" and "Picklist" on Insights navigate;
		// they are links wearing a button's clothes, and building them out of a
		// <button> plus goto() breaks middle-click, open-in-new-tab and the status
		// bar preview — on the one surface where a manager has three tabs open.
		//
		// The element changes, the styling does not, which is the point: Studio
		// had four hand-rolled copies of .btn.secondary purely because Button
		// could not be an anchor.
		href = '',
		class: extra = '',
		children,
		...rest
	} = $props();
</script>

{#if href}
	<a {href} class="btn {variant} {extra}" class:full {...rest}>
		{@render children()}
	</a>
{:else}
	<button {type} class="btn {variant} {extra}" class:full {...rest}>
		{@render children()}
	</button>
{/if}

<style>
	/* Hallmark · genre: modern-minimal · component: button
	 * design-system: design.md · designed-as-app
	 * states: default · hover · focus-visible · active · disabled
	 * contrast: AA pass, both themes
	 */

	.btn {
		font: inherit;
		font-weight: 600;
		/* 44px floor. design.md treats this as non-negotiable: a 32px button
		   looks better in a screenshot and fails under a thumb in a gym. */
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background-color var(--dur-short) var(--ease-out),
			color var(--dur-short) var(--ease-out);
	}
	/* An <a> is not a <button>: it lays out inline, ignores min-height, and comes
	   with an underline. Three lines to make the two elements indistinguishable,
	   which is the whole contract of the href prop. */
	a.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
	}
	.btn.full {
		flex: 1 1 0;
		min-width: 0;
	}
	.btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.primary {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.secondary {
		background: var(--bg-card);
		color: var(--text-primary);
		border-color: var(--border-strong);
	}
	.secondary:hover:not(:disabled) {
		background: var(--bg-subtle);
	}

	.danger {
		background: var(--bg-card);
		color: var(--danger);
		border-color: var(--danger);
	}
	.danger:hover:not(:disabled) {
		background: var(--danger);
		color: var(--on-accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.btn {
			transition-duration: 0.01ms;
		}
	}
</style>
