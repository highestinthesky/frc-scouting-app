<script>
	// Generic input renderer. Picks the right HTML control based on the
	// field's `type`. Used by every form so adding a new field type only
	// happens here.
	import { onMount } from 'svelte';
	import { getDistinctObservationValues, getMostUsedObservationValues } from '$lib/db.js';

	let { field, value = $bindable() } = $props();

	// Autocomplete fields lazy-load suggestions from the local DB on mount.
	// Distinct prior values for the configured observations key, alphabetised.
	let suggestions = $state([]);
	const listId = $derived(field.type === 'autocomplete' ? `suggest-${field.key}` : null);

	// Tag presets — top-used phrases from prior entries shown as one-tap pills
	// above textareas with `tagSource`. Tapping appends the phrase to the
	// current value (with a separator if there's existing content).
	let tagPills = $state([]);

	onMount(async () => {
		if (field.type === 'autocomplete' && field.suggestKey) {
			suggestions = await getDistinctObservationValues(field.suggestKey);
		}
		if (field.type === 'textarea' && field.tagSource) {
			const top = await getMostUsedObservationValues(field.tagSource, 6);
			tagPills = top.map((t) => t.value);
		}
	});

	function applyTag(phrase) {
		const current = (value ?? '').toString();
		if (!current.trim()) {
			value = phrase;
		} else if (current.includes(phrase)) {
			// Already in the textarea — don't re-append. Tapping a second time is
			// a no-op rather than a duplicate.
			return;
		} else {
			// Comma-separate so multiple phrases compose into a readable run-on.
			value = current.replace(/[\s,]+$/, '') + ', ' + phrase;
		}
	}

	// Voice dictation — Web Speech API. Available in Chrome/Edge and iOS
	// Safari 14.5+; gracefully hidden where the API isn't present so the
	// button never appears as broken.
	let speechSupported = $state(false);
	let listening = $state(false);
	let recognition = null;

	onMount(() => {
		if (typeof window === 'undefined') return;
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR) return;
		speechSupported = true;
		recognition = new SR();
		recognition.continuous = false;
		recognition.interimResults = false;
		recognition.lang = navigator.language || 'en-US';
		recognition.onresult = (e) => {
			const text = Array.from(e.results)
				.map((r) => r[0]?.transcript ?? '')
				.join(' ')
				.trim();
			if (!text) return;
			const current = (value ?? '').toString();
			value = current.trim() ? current.replace(/\s+$/, '') + ' ' + text : text;
		};
		recognition.onend = () => (listening = false);
		recognition.onerror = () => (listening = false);
	});

	function toggleListening() {
		if (!recognition) return;
		if (listening) {
			recognition.stop();
			listening = false;
		} else {
			try {
				recognition.start();
				listening = true;
			} catch (_e) {
				listening = false;
			}
		}
	}
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
		{#if tagPills.length > 0}
			<div class="tag-pills" aria-label="Quick phrases">
				{#each tagPills as phrase (phrase)}
					<button
						type="button"
						class="tag-pill"
						onclick={() => applyTag(phrase)}
						title="Tap to add this phrase"
					>
						{phrase.length > 32 ? phrase.slice(0, 30) + '…' : phrase}
					</button>
				{/each}
			</div>
		{/if}
		<div class="textarea-wrap">
			<textarea
				bind:value
				required={field.required}
				placeholder={field.placeholder}
				rows="3"
			></textarea>
			{#if speechSupported}
				<button
					type="button"
					class="mic-btn"
					class:listening
					onclick={toggleListening}
					aria-label={listening ? 'Stop dictating' : 'Dictate'}
					title={listening ? 'Stop dictating' : 'Tap to dictate'}
				>
					{listening ? '●' : '🎤'}
				</button>
			{/if}
		</div>
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
		color: var(--text-faint);
		font-size: 0.85rem;
		margin-top: -0.15rem;
	}
	input, textarea, select {
		font: inherit;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
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

	.tag-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 0.3rem;
	}
	.tag-pill {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.25rem 0.6rem;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		color: var(--text-muted);
		border-radius: 999px;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag-pill:hover {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: var(--accent);
	}

	.textarea-wrap { position: relative; }
	.mic-btn {
		position: absolute;
		right: 0.45rem;
		bottom: 0.45rem;
		font: inherit;
		font-size: 0.95rem;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-card);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		opacity: 0.85;
	}
	.mic-btn:hover { opacity: 1; }
	.mic-btn.listening {
		background: #fef2f2;
		color: #b91c1c;
		border-color: #f87171;
		animation: mic-pulse 1.2s ease-in-out infinite;
	}
	@keyframes mic-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
		50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
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
		background: var(--bg-card);
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
		background: var(--bg-card);
		border-radius: 50%;
		transition: transform 120ms ease;
	}
	.toggle.on .track { background: #0b3d91; }
	.toggle.on .thumb { transform: translateX(1.1rem); }
	.bool-label {
		font-size: 0.95rem;
		color: var(--text-primary);
	}
</style>
