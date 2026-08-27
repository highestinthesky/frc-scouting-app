<script>
	import Select from '../Select.svelte';
	import Button from '$lib/components/Button.svelte';
	import Panel from './Panel.svelte';
	// Manager: compose a reminder (broadcast or to one scout) and manage the
	// ones already out there. The banner itself lives in the layout.

	let {
		reminderTarget = $bindable(),
		reminderMatch = $bindable(),
		reminderText = $bindable(),
		reminderScouts,
		recentReminders,
		busy,
		onSend,
		onRemove
	} = $props();
</script>

<Panel title="Send reminder">

	<div class="reminder-form">
		<Select
			label="Recipient"
			bind:value={reminderTarget}
			options={[{ value: '', label: 'Everyone' }, ...reminderScouts.map((n) => ({ value: n, label: n }))]}
		/>

		<label class="field reminder-match">
			<span class="label">Match (optional)</span>
			<input
				type="number"
				bind:value={reminderMatch}
				placeholder="e.g. 15"
				inputmode="numeric"
			/>
		</label>

		<label class="field reminder-msg">
			<span class="label">Message</span>
			<input
				type="text"
				bind:value={reminderText}
				placeholder="e.g. Q15 starts in 5 min — get to position"
				maxlength="200"
			/>
		</label>

		<!-- Wrapped because a parent cannot style a child component's element:
		     Svelte scopes .send to THIS component, while the button carries
		     Button.svelte's hash. Positioning the wrapper avoids reaching in
		     with :global(). -->
		<div class="send">
			<Button variant="primary" disabled={busy || !reminderText.trim()} onclick={onSend}>
				{busy ? '…' : 'Send reminder'}
			</Button>
		</div>
	</div>

	{#if recentReminders.length > 0}
		<h3 class="reminder-active-head">Active reminders</h3>
		<ul class="reminder-list">
			{#each recentReminders as r (r.id)}
				<li class="reminder-row">
					<div class="rr-body">
						<span class="rr-target">
							{r.scout_name ? `→ ${r.scout_name}` : '→ everyone'}
						</span>
						{#if r.match_number}<span class="rr-match">Q{r.match_number}</span>{/if}
						<span class="rr-msg">{r.message}</span>
					</div>
					<button
						type="button"
						class="rr-x"
						aria-label="Delete reminder"
						onclick={() => onRemove(r.id)}
					>✕</button>
				</li>
			{/each}
		</ul>
	{/if}
</Panel>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label { font-weight: 600; font-size: var(--fs-md); }
	input {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		/* Padding alone left these at 37px. */
		min-height: var(--tap-min);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	/* ── manager: send reminder ─────────────────────────────────── */
	.reminder-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-2);
		align-items: end;
	}
	.reminder-form .field { margin-bottom: 0; }
	.reminder-form .reminder-msg { grid-column: 1 / -1; }
	.send { grid-column: 1 / -1; justify-self: start; }
	.reminder-active-head {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--fs-sm);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.reminder-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.reminder-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}
	.rr-body { flex: 1 1 0; display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: baseline; }
	.rr-target { color: var(--text-muted); font-size: var(--fs-xs); }
	.rr-match { font-weight: 700; color: var(--accent); }
	.rr-msg { color: var(--text-primary); }
	.rr-x {
		background: transparent;
		border: none;
		font-size: var(--fs-md);
		color: var(--text-faint);
		cursor: pointer;
		padding: 0 var(--space-1);
		/* Horizontal padding alone measured 18x20 against design.md's 44px
		   floor. A borderless glyph button still has to be hittable. */
		min-height: var(--tap-min);
		min-width: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.rr-x:hover { color: var(--danger); }
	@media (max-width: 28rem) {
		.reminder-form { grid-template-columns: minmax(0, 1fr); }
	}
</style>
