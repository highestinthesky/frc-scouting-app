<script>
	// Manager: fetch the match list from The Blue Alliance, then publish it so
	// scouts can pull it. The TBA event key is deliberately separate from the
	// team's sync event code — blank falls back to the code.
	import { session } from '$lib/session.svelte.js';
	import Button from '$lib/components/Button.svelte';
	import { relativeTime } from '$lib/format.js';
	import Panel from './Panel.svelte';

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

<Panel title="Publish schedule">

	<label class="field">
		<span class="label">TBA event key</span>
		<small class="help">Blank uses <code>{session.eventCode}</code>.</small>
		<input
			type="text"
			bind:value={tbaEventKey}
			placeholder={session.eventCode}
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
		/>
	</label>

	<label class="field">
		<span class="label">TBA API key</span>
		<input
			type="password"
			bind:value={tbaApiKey}
			placeholder="Paste your TBA read API key"
			autocomplete="off"
			autocapitalize="none"
		/>
	</label>

	<div class="actions-row">
		<Button variant="primary" disabled={busy || !tbaApiKey} onclick={onFetch}>
			{busy ? '…' : 'Fetch schedule'}
		</Button>
		<Button variant="primary" disabled={busy || !cached} onclick={onPublish}>
			{busy ? '…' : 'Publish'}
		</Button>
		<Button disabled={busy || !cached} onclick={onClearCache}>Clear local cache</Button>
	</div>

	{#if cached}
		<p class="muted small">
			Fetched
			{relativeTime(cached.cachedAt, now)}
		</p>
	{:else}
		<p class="muted small">No schedule fetched yet.</p>
	{/if}
</Panel>

<style>
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	code {
		background: var(--bg-subtle);
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label { font-weight: 600; font-size: var(--fs-md); }
	.help { color: var(--text-faint); font-size: var(--fs-sm); }
	input {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		/* Padding alone left the TBA key fields at 37px. */
		min-height: var(--tap-min);
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
</style>
