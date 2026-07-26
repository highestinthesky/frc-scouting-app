<script>
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

<section>
	<h2>Send reminder</h2>
	<p class="muted">Banner shows until dismissed, or 2 hours.</p>

	<div class="reminder-form">
		<label class="field">
			<span class="label">Recipient</span>
			<select bind:value={reminderTarget}>
				<option value="">Everyone</option>
				{#each reminderScouts as name}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</label>

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

		<button class="primary" disabled={busy || !reminderText.trim()} onclick={onSend}>
			{busy ? '…' : 'Send reminder'}
		</button>
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
</section>

<style>
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
	input {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	button.primary {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary {
		background: var(--accent);
		color: var(--on-accent);
		border: none;
	}
	button.primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	/* ── manager: send reminder ─────────────────────────────────── */
	.reminder-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		align-items: end;
	}
	.reminder-form .field { margin-bottom: 0; }
	.reminder-form .reminder-msg { grid-column: 1 / -1; }
	.reminder-form select {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.reminder-form .primary { grid-column: 1 / -1; justify-self: start; }
	.reminder-active-head {
		margin: 1rem 0 0.4rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.reminder-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.reminder-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		font-size: 0.85rem;
	}
	.rr-body { flex: 1 1 0; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: baseline; }
	.rr-target { color: var(--text-muted); font-size: 0.78rem; }
	.rr-match { font-weight: 700; color: var(--accent); }
	.rr-msg { color: var(--text-primary); }
	.rr-x {
		background: transparent;
		border: none;
		font-size: 1rem;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0 0.3rem;
	}
	.rr-x:hover { color: var(--danger); }
	@media (max-width: 28rem) {
		.reminder-form { grid-template-columns: 1fr; }
	}
</style>
