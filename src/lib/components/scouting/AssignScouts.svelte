<script>
	// The assignment editor. Rows are {scout_name, teamsText} so a manager can
	// type a comma-separated team list; the route parses to numbers on save.
	// assignRows is a $state array owned by the route — mutating a row's fields
	// through the proxy propagates back without an explicit binding.

	import { relativeTime } from '$lib/format.js';
	import Button from '$lib/components/Button.svelte';

	let {
		assignRows,
		busy,
		qmList,
		draftRestored,
		draftSavedAt,
		pendingOverrideCount,
		now,
		onAddRow,
		onRemoveRow,
		onAutoAssign,
		onSave,
		onDiscardDraft
	} = $props();
</script>

<section>
	<h2>Assign scouts</h2>
	<p class="muted">One row per scout. Saving replaces the whole list.</p>

	{#if draftRestored}
		<p class="draft-note">
			Restored unsaved changes{#if draftSavedAt} from {relativeTime(draftSavedAt, now)}{/if}.
			<button type="button" class="draft-discard" onclick={onDiscardDraft}>Discard</button>
		</p>
	{/if}
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
		Tap <strong>Auto-assign</strong> after assigning members to evenly distribute 
		scouting taks across the team. There should be no schedule conflicts. 
		You can edit the result before saving. Remember to publish. 
	</p>

	{#if pendingOverrideCount > 0}
		<p class="muted small pending-note">
			{pendingOverrideCount} per-match override{pendingOverrideCount === 1 ? '' : 's'}
			staged — saved along with the assignments.
		</p>
	{/if}

	<div class="actions-row">
		<Button onclick={onAddRow}>+ Add scout</Button>
		<Button
			disabled={busy || !qmList.length}
			onclick={onAutoAssign}
			title={qmList.length ? '' : 'Fetch the schedule from TBA first'}
		>✨ Auto-assign</Button>
		<Button variant="primary" disabled={busy} onclick={onSave}>
			{busy ? 'Saving…' : 'Save assignments'}
		</Button>
	</div>
</section>

<style>
	.draft-note {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		font-size: var(--fs-sm);
		background: var(--warning-bg);
		color: var(--warning);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
	}
	.draft-discard {
		font: inherit;
		font-weight: 600;
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.pending-note { color: var(--accent); }
	h2 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	input {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	.actions-row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}
	/* ── manager: assignment editor ─────────────────────────────────── */
	.assign-row {
		display: grid;
		grid-template-columns: 1fr 2fr auto;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.scout-name, .team-list {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		min-width: 0;
	}
	.row-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: var(--fs-lg);
		cursor: pointer;
		padding: 0 var(--space-2);
	}
	.row-x:hover { color: var(--danger); }
</style>
