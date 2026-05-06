<script>
	// Generic input renderer. Picks the right HTML control based on the
	// field's `type`. Used by every form so adding a new field type only
	// happens here.
	import {
		getDistinctObservationValuesForTeam,
		getMostUsedObservationValuesForTeam
	} from '$lib/db.js';

	/**
	 * field      — field config object from form-config.js
	 * value      — bindable: the serialized field value (string / boolean / number)
	 * scopeTeam  — current team number being scouted. When > 0, suggestions and
	 *              tag pills are filtered to only that team's prior entries.
	 *              When 0 / blank, no suggestions are shown.
	 */
	let { field, value = $bindable(), scopeTeam = 0 } = $props();

	// Autocomplete suggestions — distinct prior values for this field's key,
	// scoped to the team being scouted. Populated reactively whenever scopeTeam
	// or field changes.
	let suggestions = $state([]);
	const listId = $derived(field.type === 'autocomplete' ? `suggest-${field.key}` : null);

	// Tag pills — top-used phrases for this field, scoped to the same team.
	let tagPills = $state([]);

	// Re-run whenever scopeTeam changes (i.e. as the scout types the team #).
	// Uses an IIFE inside $effect so we can await DB calls while still tracking
	// scopeTeam as a reactive dependency.
	$effect(() => {
		const team = Number(scopeTeam); // read here so $effect tracks it
		const ftype = field.type;
		const suggestKey = field.suggestKey;
		const tagSource = field.tagSource;

		(async () => {
			if (ftype === 'autocomplete' && suggestKey) {
				suggestions = team > 0
					? await getDistinctObservationValuesForTeam(suggestKey, team)
					: [];
			}
			if (ftype === 'textarea' && tagSource) {
				if (team > 0) {
					const top = await getMostUsedObservationValuesForTeam(tagSource, team, 6);
					tagPills = top.map((t) => t.value);
				} else {
					tagPills = [];
				}
			}
		})();
	});

	// ── tag pill logic ──────────────────────────────────────────────────────

	function applyTag(phrase) {
		const current = (value ?? '').toString();
		if (!current.trim()) {
			value = phrase;
		} else if (current.includes(phrase)) {
			// Already present — tapping again is a no-op rather than a duplicate.
			return;
		} else {
			value = current.replace(/[\s,]+$/, '') + ', ' + phrase;
		}
	}

	// ── defense-entry helpers ───────────────────────────────────────────────
	//
	// The 'defense-entry' type stores a single serialized string in
	// observations.defense. Internally we track three sub-fields and
	// serialize on every change.
	//
	// Serialized format examples:
	//   "Defended 1678: pinned near loading zone"
	//   "Defended by 254: chased us the whole match"
	//   "Defended: very aggressive"
	//   "Defended by: kept bumping us"
	//   ""  (nothing filled in)

	/** Parse an existing serialized value back into sub-fields. */
	function parseDefense(str) {
		if (!str || !str.trim()) return { role: '', opponent: '', desc: '' };
		// Match: (role) (optional team#) (optional : description)
		const m = str.match(/^(Defended by|Defended)\s*(\d+)?\s*:?\s*([\s\S]*)$/);
		if (!m) return { role: '', opponent: '', desc: str };
		return {
			role: m[1] ?? '',
			opponent: m[2] ?? '',
			desc: m[3]?.trim() ?? ''
		};
	}

	/** Rebuild the serialized string from sub-fields and write to `value`. */
	function serializeDefense() {
		if (!defenseRole) { value = ''; return; }
		let s = defenseRole;
		if (defenseOpponent.trim()) s += ' ' + defenseOpponent.trim();
		if (defenseDesc.trim()) s += ': ' + defenseDesc.trim();
		value = s;
	}

	// Sub-fields initialized from any pre-existing value (edit page).
	const parsed = parseDefense(typeof value === 'string' ? value : '');
	let defenseRole     = $state(parsed.role);
	let defenseOpponent = $state(parsed.opponent);
	let defenseDesc     = $state(parsed.desc);

	// Keep sub-fields in sync when the parent resets the value externally
	// (e.g., after "Use this match" fills identity fields on new entry).
	$effect(() => {
		const v = typeof value === 'string' ? value : '';
		const p = parseDefense(v);
		// Only re-parse if the value differs from what we'd serialize ourselves —
		// avoids feedback loops where serializeDefense() triggers the effect.
		const current = (() => {
			if (!defenseRole) return '';
			let s = defenseRole;
			if (defenseOpponent.trim()) s += ' ' + defenseOpponent.trim();
			if (defenseDesc.trim()) s += ': ' + defenseDesc.trim();
			return s;
		})();
		if (v !== current) {
			defenseRole     = p.role;
			defenseOpponent = p.opponent;
			defenseDesc     = p.desc;
		}
	});
</script>

<label class="field" class:defense-field={field.type === 'defense-entry'}>
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
		<textarea
			bind:value
			required={field.required}
			placeholder={field.placeholder}
			rows="3"
		></textarea>

	{:else if field.type === 'defense-entry'}
		<!--
			Structured defense entry. Three sub-fields serialize into the single
			observations.defense string so the data model is unchanged.
		-->
		<div class="defense-entry">
			<!-- Sub-field 1: role -->
			<div class="de-row">
				<small class="de-label">Role</small>
				<div class="pills de-pills">
					{#each ['Defended', 'Defended by'] as opt}
						<button
							type="button"
							class="pill"
							class:selected={defenseRole === opt}
							onclick={() => { defenseRole = defenseRole === opt ? '' : opt; serializeDefense(); }}
						>
							{opt}
						</button>
					{/each}
				</div>
			</div>

			{#if defenseRole}
				<!-- Sub-field 2: opponent team number -->
				<div class="de-row">
					<small class="de-label">
						{defenseRole === 'Defended' ? 'Team we defended against' : 'Team that defended us'}
						<span class="de-optional">(optional)</span>
					</small>
					<input
						type="number"
						inputmode="numeric"
						class="de-team"
						bind:value={defenseOpponent}
						onchange={serializeDefense}
						oninput={serializeDefense}
						placeholder="Team #"
					/>
				</div>

				<!-- Sub-field 3: description -->
				<div class="de-row">
					<small class="de-label">Description <span class="de-optional">(optional)</span></small>
					<textarea
						class="de-desc"
						bind:value={defenseDesc}
						onchange={serializeDefense}
						oninput={serializeDefense}
						placeholder={defenseRole === 'Defended'
							? 'How did they defend? e.g. pinned in corner'
							: 'What did they do to us? e.g. chased us all match'}
						rows="2"
					></textarea>
				</div>
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

	/* ── tag pills ────────────────────────────────────────────────── */
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

	/* ── defense-entry ────────────────────────────────────────────── */
	.defense-entry {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
	}
	.de-row {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.de-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-weight: 600;
	}
	.de-optional {
		font-weight: 400;
		color: var(--text-faint);
	}
	.de-pills {
		gap: 0.4rem;
	}
	.de-team {
		max-width: 8rem;
	}
	.de-desc {
		min-height: 3rem;
	}

	/* ── pills ────────────────────────────────────────────────────── */
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
	/* Defense pills don't need to grow to full width */
	.de-pills .pill {
		flex: 0 1 auto;
		min-width: 7rem;
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

	/* ── boolean toggle ───────────────────────────────────────────── */
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
