<script>
	import { onMount } from 'svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { getEntry, updateEntry, deleteEntry } from '$lib/db.js';
	import { kick as kickSync } from '$lib/sync.svelte.js';
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
			// clientId, and remoteId are left as they were on the original row so
			// dedupe/sync continue to identify it.
			//
			// Caveat: the wireless sync layer is INSERT-only today; cloud rows
			// won't reflect this edit until a re-import. Fixing that needs a
			// dedicated UPDATE path on the sync side, deferred until edit
			// behavior is exercised at a real event.
			await updateEntry(entry.id, {
				matchNumber: Number(values.matchNumber),
				teamNumber: Number(values.teamNumber),
				allianceColor: values.allianceColor,
				observations
			});

			kickSync();
			await goto(`${base}/`);
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
		await goto(`${base}/`);
	}
</script>

<svelte:head>
	<title>Edit entry · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a href="{base}/" class="back" aria-label="Back to entries">←</a>
		<h1>Edit entry</h1>
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if notFound}
		<div class="not-found">
			<p>That entry doesn't exist on this device.</p>
			<a class="back-link" href="{base}/">Back to entries</a>
		</div>
	{:else}
		<form onsubmit={submit} novalidate>
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
				<button type="button" class="danger" onclick={removeEntry}>Delete</button>
				<a href="{base}/" class="cancel">Cancel</a>
				<button type="submit" class="primary" disabled={saving}>
					{saving ? 'Saving…' : 'Save changes'}
				</button>
			</div>

			<p class="hint muted">
				Originally recorded {new Date(entry.createdAt).toLocaleString()} by {entry.scoutName}.
			</p>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1.5rem auto;
		padding: 0 1rem 4rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; }
	h2 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: 1.5rem 0 0.75rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.35rem;
	}
	.muted { color: var(--text-faint); }
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
	}
	.not-found {
		margin-top: 2rem;
		text-align: center;
	}
	.back-link {
		display: inline-block;
		margin-top: 1rem;
		color: var(--accent);
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
	.cancel {
		color: var(--text-muted);
		text-decoration: none;
		padding: 0.5rem 0.75rem;
	}
	.actions button {
		font: inherit;
		font-weight: 600;
		padding: 0.7rem 1.2rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.actions button.primary { background: var(--accent); color: white; border: none; }
	.actions button.primary:disabled { opacity: 0.6; cursor: progress; }
	.actions button.danger {
		background: var(--bg-card);
		color: var(--danger);
		border-color: var(--danger);
		margin-right: auto;
	}
	.actions button.danger:hover { background: var(--danger-bg); }
	.hint {
		margin-top: 1rem;
		font-size: 0.85rem;
		text-align: right;
	}
</style>
