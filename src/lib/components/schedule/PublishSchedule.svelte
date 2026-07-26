<script>
	// Manager: fetch the match list from The Blue Alliance, then publish it so
	// scouts can pull it. The TBA event key is deliberately separate from the
	// team's sync event code — blank falls back to the code.
	import { session } from '$lib/session.svelte.js';
	import { relativeTime } from '$lib/format.js';

	let {
		tbaEventKey = $bindable(),
		tbaApiKey = $bindable(),
		busy,
		cached,
		qmList,
		now,
		onFetch,
		onPublish,
		onClearCache
	} = $props();
</script>

<section>
	<h2>Publish schedule</h2>
	<p class="muted">
		Fetch from The Blue Alliance, then publish so scouts can pull it.
	</p>

	<label class="field">
		<span class="label">TBA event key</span>
		<small class="help">
			e.g. <strong>2027nyny</strong>. Blank uses <code>{session.eventCode}</code>.
		</small>
		<input
			type="text"
			bind:value={tbaEventKey}
			placeholder={session.eventCode}
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
		/>
	</label>

	<p class="key-summary">
		Your code: <strong>{session.eventCode}</strong>
		<span class="key-sep">·</span>
		TBA key: <strong>{(tbaEventKey || '').trim() || session.eventCode}</strong>
	</p>

	<label class="field">
		<span class="label">TBA API key</span>
		<small class="help">
			Free at <strong>thebluealliance.com/account</strong> → Read API Keys.
		</small>
		<input
			type="password"
			bind:value={tbaApiKey}
			placeholder="Paste your TBA read API key"
			autocomplete="off"
			autocapitalize="none"
		/>
	</label>

	<div class="actions-row">
		<button class="primary" disabled={busy || !tbaApiKey} onclick={onFetch}>
			{busy ? '…' : '1. Fetch from TBA'}
		</button>
		<button
			class="primary"
			disabled={busy || !cached}
			onclick={onPublish}
		>
			{busy ? '…' : '2. Publish to teammates'}
		</button>
		<button class="secondary-btn" disabled={busy || !cached} onclick={onClearCache}>
			Clear local cache
		</button>
	</div>

	{#if cached}
		<p class="muted small">
			Local cache: {qmList.length} qual matches · fetched
			{relativeTime(cached.cachedAt, now)}
			({new Date(cached.cachedAt).toLocaleString()})
			{#if cached.fetchedBy} by {cached.fetchedBy}{/if}
		</p>
	{:else}
		<p class="muted small">No schedule fetched yet.</p>
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
	.muted.small { font-size: 0.82rem; }
	code {
		background: var(--bg-subtle);
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
	.help { color: var(--text-faint); font-size: 0.82rem; }
	.key-summary {
		margin: 0 0 0.9rem;
		padding: 0.4rem 0.6rem;
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.key-summary strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
	.key-sep { opacity: 0.5; margin: 0 0.35rem; }
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
</style>
