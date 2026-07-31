<script>
	// Manager passphrase: set, verify, rotate, forget, and the event reset.
	// Three states — never set, set and known on this device, set but unknown.
	import { session } from '$lib/session.svelte.js';
	import Button from '$lib/components/Button.svelte';

	let {
		pwInput = $bindable(),
		pwInput2 = $bindable(),
		verifyInput = $bindable(),
		rotateNew = $bindable(),
		rotateNew2 = $bindable(),
		showForgotHelp = $bindable(),
		passphraseSetRemote,
		passphraseLocallyKnown,
		busy,
		onSet,
		onVerify,
		onForget,
		onRotate,
		onReset
	} = $props();
</script>

<section>
	<h2>Manager passphrase</h2>
	<p class="muted">
		Required to publish schedules and edit assignments. Scouts don't need it.
	</p>

	{#if !passphraseSetRemote}
		<p class="muted small">Not set yet for <code>{session.eventCode}</code>.</p>
		<label class="field">
			<span class="label">New passphrase</span>
			<input type="password" bind:value={pwInput} autocomplete="new-password" />
		</label>
		<label class="field">
			<span class="label">Confirm</span>
			<input type="password" bind:value={pwInput2} autocomplete="new-password" />
		</label>
		<Button variant="primary" disabled={busy || !pwInput} onclick={onSet}>Set passphrase</Button>
	{:else if passphraseLocallyKnown}
		<p class="muted small ok-inline">
			✓ Passphrase active on this device. You can publish and edit
			assignments.
		</p>
		<div class="actions-row">
			<Button onclick={onForget}>Forget on this device</Button>
			<Button variant="danger" onclick={onReset} disabled={busy}>
				Reset scheduling for this event
			</Button>
		</div>

		<details class="rotate-block">
			<summary>Change passphrase</summary>
			<p class="muted small">
				Pick a new passphrase. Other manager devices will need it before
				they can publish or edit assignments again.
			</p>
			<label class="field">
				<span class="label">New passphrase</span>
				<input type="password" bind:value={rotateNew} autocomplete="new-password" />
			</label>
			<label class="field">
				<span class="label">Confirm</span>
				<input type="password" bind:value={rotateNew2} autocomplete="new-password" />
			</label>
			<Button variant="primary" disabled={busy || !rotateNew} onclick={onRotate}>Rotate</Button>
		</details>
	{:else}
		<p class="muted small">
			A passphrase is set for this event. Enter it to publish from this
			device.
		</p>
		<label class="field">
			<span class="label">Passphrase</span>
			<input type="password" bind:value={verifyInput} autocomplete="current-password" />
		</label>
		<Button variant="primary" disabled={busy || !verifyInput} onclick={onVerify}>Verify</Button>

		<details class="forgot-block" bind:open={showForgotHelp}>
			<summary>Forgot the passphrase?</summary>
			<p class="muted small">
				There's no in-app recovery for a fully-lost passphrase. An
				admin needs to clear the event's row in Supabase Studio, after
				which the next device to set a passphrase wins.
			</p>
			<p class="muted small">
				From Supabase Studio → SQL Editor, run:
			</p>
			<pre class="sql-snippet"><code>DELETE FROM public.event_meta
WHERE event_code = '{session.eventCode}';</code></pre>
			<p class="muted small">
				Then come back here, set a fresh passphrase, and re-publish.
			</p>
		</details>
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
	.ok-inline { color: var(--success); }
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
	.actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}
	.rotate-block, .forgot-block {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--bg-subtle);
	}
	.rotate-block summary, .forgot-block summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.rotate-block[open], .forgot-block[open] {
		padding-bottom: 0.75rem;
	}
	.rotate-block[open] summary, .forgot-block[open] summary {
		margin-bottom: 0.5rem;
	}
	.sql-snippet {
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: 0.3rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.8rem;
		overflow-x: auto;
		margin: 0.4rem 0;
	}
	.sql-snippet code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: none;
		padding: 0;
	}
</style>
