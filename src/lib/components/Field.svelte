<script>
	// Generic input renderer. Picks the right HTML control based on the
	// field's `type`. Used by every form so adding a new field type only
	// happens here.
	import { onMount } from 'svelte';
	import { getDistinctObservationValues } from '$lib/db.js';

	let { field, value = $bindable() } = $props();

	// Autocomplete fields lazy-load suggestions from the local DB on mount.
	// Distinct prior values for the configured observations key, alphabetised.
	let suggestions = $state([]);
	const listId = field.type === 'autocomplete' ? `suggest-${field.key}` : null;

	onMount(async () => {
		if (field.type === 'autocomplete' && field.suggestKey) {
			suggestions = await getDistinctObservationValues(field.suggestKey);
		}
	});
</script>

<label class="field">
	<span class="label">
		{field.label}
		{#if field.required}<span class="req">*</span>{/if}
	</span>
	{#if field.help}
		<small class="help">{field.help}</small>
	{/if}

	{#if field.type === 'number'}
		<input
			type="number"
			inputmode="numeric"
			bind:value
			required={field.required}
			placeholder={field.placeholder}
		/>
	{:else if field.type === 'text'}
		<input
			type="text"
			bind:value
			required={field.required}
			placeholder={field.placeholder}
		/>
	{:else if field.type === 'textarea'}
		<textarea
			bind:value
			required={field.required}
			placeholder={field.placeholder}
			rows="3"
		></textarea>
	{:else if field.type === 'select'}
		<select bind:value required={field.required}>
			<option value="" disabled selected>Choose…</option>
			{#each field.options as opt}
				<option value={opt}>{opt}</option>
			{/each}
		</select>
	{:else if field.type === 'pills'}
		<div class="pills" role="radiogroup" aria-label={field.label}>
			{#each field.options as opt}
				<button
					type="button"
					class="pill"
					class:selected={value === opt}
					data-color={opt}
					role="radio"
					aria-checked={value === opt}
					onclick={() => (value = opt)}
				>
					{opt}
				</button>
			{/each}
		</div>
	{:else if field.type === 'autocomplete'}
		<input
			type="text"
			bind:value
			required={field.required}
			placeholder={field.placeholder}
			list={listId}
			autocomplete="off"
		/>
		{#if listId}
			<datalist id={listId}>
				{#each suggestions as s (s)}
					<option value={s}></option>
				{/each}
			</datalist>
		{/if}
	{:else if field.type === 'boolean'}
		<div class="bool">
			<button
				type="button"
				class="toggle"
				class:on={value === true}
				role="switch"
				aria-checked={value === true}
				aria-label={field.label}
				onclick={() => (value = !(value === true))}
			>
				<span class="track"><span class="thumb"></span></span>
			</button>
			<span class="bool-label">{value === true ? 'Yes' : 'No'}</span>
		</div>
	{/if}
</label>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}
	.label {
		font-weight: 600;
		font-size: 0.95rem;
	}
	.req { color: #c0392b; }
	.help {
		color: #777;
		font-size: 0.85rem;
		margin-top: -0.15rem;
	}
	input, textarea, select {
		font: inherit;
		padding: 0.6rem 0.7rem;
		border: 1px solid #ccc;
		border-radius: 0.4rem;
		background: white;
	}
	input:focus, textarea:focus, select:focus {
		outline: 2px solid #0b3d91;
		outline-offset: 1px;
		border-color: #0b3d91;
	}
	textarea {
		resize: vertical;
		min-height: 4rem;
	}
	.pills {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.pill {
		flex: 1 1 auto;
		min-width: 5rem;
		padding: 0.7rem 1rem;
		font: inherit;
		font-weight: 600;
		text-transform: capitalize;
		background: white;
		border: 2px solid #ccc;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.pill.selected[data-color='red'] {
		background: #c0392b;
		border-color: #c0392b;
		color: white;
	}
	.pill.selected[data-color='blue'] {
		background: #2c5cb0;
		border-color: #2c5cb0;
		color: white;
	}
	.pill.selected:not([data-color='red']):not([data-color='blue']) {
		background: #0b3d91;
		border-color: #0b3d91;
		color: white;
	}

	/* Boolean toggle. Hidden semantic checkbox would be cleaner accessibility,
	   but a button with role=switch is well-supported by AT and avoids the
	   visually-hidden-input dance. */
	.bool {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.1rem;
	}
	.toggle {
		appearance: none;
		background: transparent;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		font: inherit;
	}
	.toggle:focus-visible .track {
		outline: 2px solid #0b3d91;
		outline-offset: 2px;
	}
	.track {
		position: relative;
		display: inline-block;
		width: 2.6rem;
		height: 1.5rem;
		background: #ccc;
		border-radius: 999px;
		transition: background-color 100ms ease;
	}
	.thumb {
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 1.2rem;
		height: 1.2rem;
		background: white;
		border-radius: 50%;
		transition: transform 120ms ease;
	}
	.toggle.on .track { background: #0b3d91; }
	.toggle.on .thumb { transform: translateX(1.1rem); }
	.bool-label {
		font-size: 0.95rem;
		color: #333;
	}
</style>
