<script>
	// The assignment editor. Rows are {scout_name, teamsText} so a manager can
	// type a comma-separated team list; the route parses to numbers on save.
	// assignRows is a $state array owned by the route — mutating a row's fields
	// through the proxy propagates back without an explicit binding.

	let { assignRows, busy, qmList, onAddRow, onRemoveRow, onAutoAssign, onSave } = $props();
</script>

<section>
	<h2>Assign scouts</h2>
	<p class="muted">One row per scout. Saving replaces the whole list.</p>
	{#each assignRows as r, i}
		<div class="assign-row">
			<input
				class="scout-name"
				placeholder="Scout name"
				bind:value={r.scout_name}
			/>
			<input
				class="team-list"
				placeholder="e.g. 1234, 5678, 9012"
				bind:value={r.teamsText}
				inputmode="numeric"
			/>
			<button
				type="button"
				class="row-x"
				aria-label="Remove row"
				onclick={() => onRemoveRow(i)}
			>
				×
			</button>
		</div>
	{/each}
	<p class="muted small">
		Short on time? Add your scouts' names (leave the team lists blank) and
		tap <strong>Auto-assign</strong> — it spreads every team at the event
		evenly across them and avoids putting two teams from the same match on
		one scout. You can edit the result before saving.
	</p>
	<div class="actions-row">
		<button class="secondary-btn" onclick={onAddRow}>+ Add scout</button>
		<button
			class="secondary-btn"
			disabled={busy || !qmList.length}
			onclick={onAutoAssign}
			title={qmList.length ? '' : 'Fetch the schedule from TBA first'}
		>✨ Auto-assign</button>
		<button class="primary" disabled={busy} onclick={onSave}>
			{busy ? 'Saving…' : 'Save assignments'}
		</button>
	</div>
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
	.muted.small { font-size: 0.82rem; }
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
	button.primary,
	button.secondary-btn {
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
	button.secondary-btn {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
	}
	button.secondary-btn:hover { background: var(--bg-subtle); }
	button.secondary-btn:disabled { opacity: 0.6; cursor: progress; }
	.actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}
	/* ── manager: assignment editor ─────────────────────────────────── */
	.assign-row {
		display: grid;
		grid-template-columns: 1fr 2fr auto;
		gap: 0.4rem;
		margin-bottom: 0.45rem;
	}
	.scout-name, .team-list {
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
		min-width: 0;
	}
	.row-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.4rem;
	}
	.row-x:hover { color: var(--danger); }
</style>
