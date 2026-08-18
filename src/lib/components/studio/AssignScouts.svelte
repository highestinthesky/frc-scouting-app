<script>
	// The assignment editor. Rows are {scout_name, teamsText} so a manager can
	// type a comma-separated team list; the route parses to numbers on save.
	// assignRows is a $state array owned by the route — mutating a row's fields
	// through the proxy propagates back without an explicit binding.

	import { relativeTime } from '$lib/format.js';
	import { resolveScout } from '$lib/scout-identity.js';
	import Button from '$lib/components/Button.svelte';
	import Panel from './Panel.svelte';

	let {
		assignRows,
		roster = [],
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

	// Names offered as a datalist rather than a select, so typing still works.
	// Not every scout has an account yet, an offline manager has no roster at
	// all, and the pre-cutover app has to keep working for both — a picker that
	// refused unknown names would break the case it is meant to help.
	//
	// "First Last" is the value because that is the form resolveScout() matches,
	// so a picked name resolves to the account it came from. The username rides
	// along as the option label to tell two people with the same name apart.
	const rosterNames = $derived(
		(roster ?? [])
			.map((p) => ({
				value: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username,
				hint: p.username
			}))
			.filter((n) => n.value)
			.sort((a, b) => a.value.localeCompare(b.value))
	);

	// Which rows are joined to a real account. This is the onboarding progress
	// bar: with 20+ scouts registering over a fortnight, "who has signed up yet"
	// is the question a manager asks daily, and the assignment editor already
	// holds both halves of the answer.
	const linked = $derived(
		assignRows.filter((r) => r.scout_name?.trim() && resolveScout(r.scout_name, roster)).length
	);
	const named = $derived(assignRows.filter((r) => r.scout_name?.trim()).length);
</script>

<Panel title="Assign scouts">

	{#if draftRestored}
		<p class="draft-note">
			Restored unsaved changes{#if draftSavedAt} from {relativeTime(draftSavedAt, now)}{/if}.
			<button type="button" class="draft-discard" onclick={onDiscardDraft}>Discard</button>
		</p>
	{/if}
	<datalist id="scout-roster">
		{#each rosterNames as n}
			<option value={n.value}>{n.hint}</option>
		{/each}
	</datalist>

	{#each assignRows as r, i}
		<div class="assign-row">
			<div class="name-cell">
				<input
					class="scout-name"
					placeholder="Scout name"
					list="scout-roster"
					autocomplete="off"
					bind:value={r.scout_name}
				/>
				{#if r.scout_name?.trim() && resolveScout(r.scout_name, roster)}
					<span class="linked" title="Matches an account — assignments will carry it">✓</span>
				{/if}
			</div>
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
	{#if rosterNames.length > 0}
		<p class="muted small"><strong>{linked}</strong> of {named} linked to an account.</p>
	{/if}

	

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
</Panel>

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
	.name-cell { position: relative; display: flex; align-items: center; min-width: 0; }
	.name-cell .scout-name { width: 100%; padding-right: var(--space-5); }
	.linked {
		position: absolute;
		right: var(--space-2);
		color: var(--success);
		font-size: var(--fs-sm);
		pointer-events: none;
	}
	.assign-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
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
