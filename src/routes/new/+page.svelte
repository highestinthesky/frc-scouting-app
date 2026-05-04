<script>
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { addEntry } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { IDENTITY_FIELDS, OBSERVATION_FIELDS, ALL_FIELDS } from '$lib/form-config.js';
	import Field from '$lib/components/Field.svelte';

	// One state object holds the value for every field, keyed by field.key.
	let values = $state(blank());
	let saving = $state(false);
	let error = $state('');

	function blank() {
		// Type-aware defaults: text-ish fields start empty, booleans default to false
		// so the toggle renders in its "no" state and the saved entry stores a real
		// boolean rather than an empty string.
		const v = {};
		for (const f of ALL_FIELDS) {
			v[f.key] = f.type === 'boolean' ? false : '';
		}
		return v;
	}

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
			// Identity fields go on the entry directly; observation fields go
			// inside an `observations` object so the schema is portable.
			const observations = {};
			for (const f of OBSERVATION_FIELDS) observations[f.key] = values[f.key] ?? '';

			await addEntry({
				eventCode: session.eventCode,
				scoutName: session.scoutName,
				matchNumber: Number(values.matchNumber),
				teamNumber: Number(values.teamNumber),
				allianceColor: values.allianceColor,
				observations
			});

			await goto(`${base}/`);
		} catch (err) {
			error = err.message ?? String(err);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>New entry · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a href="{base}/" class="back" aria-label="Back to entries">←</a>
		<h1>New entry</h1>
	</header>

	<form onsubmit={submit} novalidate>
		<section>
			<h2>Match</h2>
			{#each IDENTITY_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} />
			{/each}
		</section>

		<section>
			<h2>Observations</h2>
			{#each OBSERVATION_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} />
			{/each}
		</section>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<a href="{base}/" class="cancel">Cancel</a>
			<button type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Save entry'}
			</button>
		</div>
	</form>
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
		color: #0b3d91;
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; }
	h2 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #666;
		margin: 1.5rem 0 0.75rem;
		border-bottom: 1px solid #e5e5e5;
		padding-bottom: 0.35rem;
	}
	.error {
		background: #fdecea;
		color: #842029;
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
	.cancel {
		color: #666;
		text-decoration: none;
		padding: 0.5rem 0.75rem;
	}
	button {
		font: inherit;
		font-weight: 600;
		padding: 0.7rem 1.2rem;
		background: #0b3d91;
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
