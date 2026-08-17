<script>
	// A select that belongs to this app.
	//
	// The bare `<select>` it replaces was the one control on the page drawn by the
	// operating system rather than by us: a different font, a different corner
	// radius, a different focus ring, and on macOS a different colour scheme
	// entirely. Everything around it was designed and it was not, which is exactly
	// what reads as "not natively part of the website".
	//
	// ─── still a real <select> underneath ─────────────────────────────────────
	//
	// This styles the native element rather than rebuilding one out of divs, and
	// that is deliberate. A hand-rolled listbox has to reimplement keyboard
	// navigation, type-ahead, screen-reader semantics and — on a phone — the
	// native wheel picker that scouts actually use one-handed in a gym. Every one
	// of those is a thing to get wrong, and the only part that genuinely looked
	// foreign was the closed state.
	//
	// So: the closed state is ours, the open list stays the platform's. The
	// chevron is drawn by us and marked aria-hidden because the element already
	// announces itself as a combobox.

	/**
	 * @type {{
	 *   value: any,
	 *   options: Array<{value: any, label: string, disabled?: boolean}>,
	 *   label?: string,
	 *   hint?: string,
	 *   disabled?: boolean,
	 *   invalid?: string,
	 *   id?: string,
	 *   onchange?: (e: Event) => void
	 * }}
	 */
	let {
		value = $bindable(),
		options = [],
		label = '',
		hint = '',
		disabled = false,
		invalid = '',
		id = '',
		onchange
	} = $props();

	// Stable across renders so the label's `for` keeps pointing at the same input.
	const uid = id || `sel-${Math.random().toString(36).slice(2, 9)}`;
	const hintId = `${uid}-hint`;
</script>

<div class="field" class:disabled>
	{#if label}
		<label class="label" for={uid}>{label}</label>
	{/if}
	{#if hint}
		<small class="hint" id={hintId}>{hint}</small>
	{/if}

	<div class="shell" class:invalid={Boolean(invalid)}>
		<select
			{disabled}
			id={uid}
			bind:value
			{onchange}
			aria-invalid={invalid ? 'true' : undefined}
			aria-describedby={hint ? hintId : undefined}
		>
			{#each options as opt (opt.value)}
				<option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
			{/each}
		</select>
		<span class="chevron" aria-hidden="true">
			<svg viewBox="0 0 12 8" width="12" height="8" fill="none">
				<path d="M1 1.5 6 6.5l5-5" stroke="currentColor" stroke-width="1.75"
					stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</span>
	</div>

	{#if invalid}
		<small class="err" role="alert">{invalid}</small>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text-primary);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.shell {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}

	select {
		/* The whole point: strip the platform's chrome so the control inherits this
		   app's type, radius, border and colours like every other input. */
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		min-width: 0;
		font: inherit;
		font-size: var(--fs-md);
		color: var(--text-primary);
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		/* Right padding clears the chevron: the icon's own gutter plus room for the
		   12px glyph. Composed from tokens rather than written as 2.25rem, because a
		   literal stops tracking the scale the moment the scale moves. */
		padding: var(--space-2) calc(var(--space-2) * 2 + var(--space-5)) var(--space-2) var(--space-2);
		min-height: var(--tap-min);
		cursor: pointer;
		transition:
			border-color var(--dur-short) var(--ease-out),
			background var(--dur-short) var(--ease-out);
	}

	select:hover:not(:disabled) {
		border-color: var(--accent);
	}
	/* focus-visible only, so a mouse click does not draw a ring, and never
	   animated — the ring must appear the instant focus lands. */
	select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	select:disabled {
		cursor: not-allowed;
		color: var(--text-muted);
		background: var(--bg-subtle);
		border-color: var(--border);
	}

	.shell.invalid select {
		border-color: var(--danger);
	}

	.chevron {
		position: absolute;
		right: var(--space-2);
		display: flex;
		align-items: center;
		color: var(--text-muted);
		pointer-events: none; /* clicks belong to the select underneath */
	}
	.field.disabled .chevron {
		opacity: 0.5;
	}

	.err {
		font-size: var(--fs-xs);
		color: var(--danger);
	}
</style>
