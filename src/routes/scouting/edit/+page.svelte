<script>
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { getEntry, updateEntry, deleteEntry } from '$lib/db.js';
	import { kick as kickSync } from '$lib/sync.svelte.js';
	import { auth, AUTH_ENFORCED } from '$lib/auth.svelte.js';
	import {
		IDENTITY_FIELDS,
		METRIC_FIELDS,
		NOTE_FIELDS,
		OBSERVATION_FIELDS,
		ALL_FIELDS
	} from '$lib/form-config.js';
	import Field from '$lib/components/Field.svelte';

	// Edit form state. `entry` is the existing row we loaded; `values` mirrors
	// it field-by-field so the form binds without mutating the loaded record.
	let entry = $state(null);
	let values = $state(blank());
	let loading = $state(true);
	let notFound = $state(false);
	let saving = $state(false);
	let error = $state('');
	const canEdit = $derived(
		!AUTH_ENFORCED ||
			!entry?.remoteId ||
			auth.isManager ||
			(Boolean(entry?.submittedBy) && entry.submittedBy === auth.profile?.id)
	);

	function blank() {
		const v = {};
		for (const f of ALL_FIELDS) v[f.key] = f.type === 'boolean' ? false : '';
		return v;
	}

	function fillFromEntry(e) {
		const v = blank();
		v.matchNumber = e.matchNumber;
		v.teamNumber = e.teamNumber;
		v.allianceColor = e.allianceColor;
		const obs = e.observations ?? {};
		for (const f of OBSERVATION_FIELDS) {
			if (f.type === 'boolean') v[f.key] = obs[f.key] === true;
			else v[f.key] = obs[f.key] ?? '';
		}
		return v;
	}

	onMount(async () => {
		const idStr = page.url.searchParams.get('id');
		const id = idStr ? Number(idStr) : NaN;
		if (!Number.isFinite(id)) {
			notFound = true;
			loading = false;
			return;
		}
		const found = await getEntry(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		entry = found;
		values = fillFromEntry(found);
		loading = false;
	});

	function validate() {
		for (const f of ALL_FIELDS) {
			if (f.required && (values[f.key] === '' || values[f.key] == null)) {
				return `Missing: ${f.label}`;
			}
		}
		return '';
	}

	async function submit(e) {
		e.preventDefault();
		if (!canEdit) {
			error = 'Only the original submitter or a manager can edit this entry.';
			return;
		}
		const v = validate();
		if (v) {
			error = v;
			return;
		}
		error = '';
		saving = true;
		try {
			const observations = {};
			for (const f of OBSERVATION_FIELDS) observations[f.key] = values[f.key] ?? '';

			// Patch only the user-editable fields. createdAt, eventCode, scoutName,
			// clientId and remoteId stay as they were so dedupe and sync continue
			// to identify the row.
			//
			// updateEntry() flags the row pendingSync, and the sync layer pushes
			// it as an UPDATE against its existing cloud row. Teammates pick the
			// change up on their next pull.
			await updateEntry(entry.id, {
				matchNumber: Number(values.matchNumber),
				teamNumber: Number(values.teamNumber),
				allianceColor: values.allianceColor,
				observations
			});

			kickSync();
			await goto(`${base}/scouting/`);
		} catch (err) {
			error = err.message ?? String(err);
		} finally {
			saving = false;
		}
	}

	async function removeEntry() {
		if (!entry) return;
		const ok = await dialog.confirm({
			title: 'Delete this entry?',
			body: `Q${entry.matchNumber} · Team ${entry.teamNumber}\n\nIt is removed from this device. A copy already synced to your team stays with them.`,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		await deleteEntry(entry.id);
		await goto(`${base}/scouting/`);
	}
</script>

<svelte:head>
	<title>Edit entry · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a href="{base}/scouting/" class="back" aria-label="Back to entries">←</a>
		<h1>Edit entry</h1>
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if notFound}
		<div class="not-found">
			<p>That entry doesn't exist on this device.</p>
			<a class="back-link" href="{base}/scouting/">Back to entries</a>
		</div>
	{:else}
		{#if !canEdit}
			<p class="read-only" role="status">
				Read only — this entry belongs to another scout. Its original submitter or a manager can
				make corrections.
			</p>
		{/if}
		<form onsubmit={submit} novalidate>
			<fieldset disabled={!canEdit}>
			<section>
				<h2>Match</h2>
				{#each IDENTITY_FIELDS as f (f.key)}
					<Field field={f} bind:value={values[f.key]} />
				{/each}
			</section>

			<section>
				<h2>Counts</h2>
				{#each METRIC_FIELDS as f (f.key)}
					<Field field={f} bind:value={values[f.key]} />
				{/each}
			</section>

			<section>
				<h2>Notes</h2>
				{#each NOTE_FIELDS as f (f.key)}
					<Field field={f} bind:value={values[f.key]} scopeTeam={Number(values.teamNumber)} />
				{/each}
			</section>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			<div class="actions">
				<!-- Wrapper carries the margin: a parent cannot style a child
				     component's element through a class prop. -->
				<div class="push-left">
					<Button variant="danger" onclick={removeEntry}>Delete</Button>
				</div>
				<a href="{base}/scouting/" class="cancel">Cancel</a>
				<Button variant="primary" type="submit" disabled={saving}>
					{saving ? 'Saving…' : 'Save changes'}
				</Button>
			</div>

			<p class="hint muted">
				Originally recorded {new Date(entry.createdAt).toLocaleString()} by {entry.scoutName}.
			</p>
			</fieldset>
		</form>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 32rem;
		margin: var(--space-5) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-6));
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.back {
		font-size: var(--fs-xl);
		text-decoration: none;
		color: var(--accent);
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}
	.back:hover { background: var(--bg-subtle); }
	.back:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	h2 {
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: var(--space-5) 0 var(--space-3);
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--space-1);
	}
	.muted { color: var(--text-faint); }
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-top: var(--space-4);
	}
	.read-only {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		background: var(--warning-bg);
		color: var(--warning);
		line-height: 1.45;
	}
	fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.not-found { margin-top: var(--space-6); text-align: center; }
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		margin-top: var(--space-4);
		color: var(--accent);
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		justify-content: flex-end;
		margin-top: var(--space-5);
		flex-wrap: wrap;
	}
	.cancel {
		color: var(--text-muted);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
	}
	.cancel:hover { background: var(--bg-subtle); color: var(--text-primary); }
	.cancel:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	.push-left { margin-right: auto; }
	.hint { margin-top: var(--space-4); font-size: var(--fs-sm); text-align: right; }
</style>
