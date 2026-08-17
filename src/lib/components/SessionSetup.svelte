<script>
	import { session } from '$lib/session.svelte.js';
	import { base } from '$app/paths';
	import { auth } from '$lib/auth.svelte.js';
	import EventPicker from './EventPicker.svelte';

	let eventCode = $state(session.eventCode);
	let scoutName = $state(session.scoutName);
	let saving = $state(false);

	// A signed-in device already knows who is holding it — auth fills scoutName
	// from the profile the moment it loads. Asking again is asking someone to
	// retype something the app just told them, and every retype is a chance to
	// spell it differently from the manager's assignment sheet.
	const knowsMe = $derived(auth.signedIn && Boolean(auth.displayName));

	async function save(e) {
		e.preventDefault();
		saving = true;
		try {
			// Signed in, the picker already stored the event — do not overwrite it
			// with this form's stale copy of the field it no longer renders.
			await session.update(
				auth.signedIn
					? { scoutName: scoutName.trim() }
					: { eventCode: eventCode.trim().toLowerCase(), scoutName: scoutName.trim() }
			);
		} finally {
			saving = false;
		}
	}
</script>

<main class="setup">
	<h1>Set up scouting</h1>

	<form onsubmit={save}>
		{#if auth.signedIn}
			<!-- Signed in, the event is a row the server can name, so this is a list
			     rather than a guess. Choosing one fills session.eventCode, which is
			     the condition this whole gate is shown on — so the app un-gates the
			     moment an event is picked and there is nothing further to submit. -->
			<div class="field">
				<EventPicker />
			</div>
		{:else}
			<label class="field">
				<span class="label">Event code</span>
				<small class="help">
					Whatever your team agreed on. Entries are saved on this phone; sign in
					to send them to your team.
				</small>
				<input bind:value={eventCode} required autocomplete="off" autocapitalize="none" placeholder="2026xxxx" />
			</label>
		{/if}

		{#if knowsMe}
			<p class="as">Scouting as <strong>{auth.displayName}</strong></p>
		{:else}
			<label class="field">
				<span class="label">Your name</span>
				<small class="help">
					Match what the manager typed when assigning you teams — or
					<a href="{base}/">sign in</a> and it fills itself.
				</small>
				<input bind:value={scoutName} required autocomplete="name" placeholder="Your name" />
			</label>
		{/if}

		{#if !auth.signedIn || !knowsMe}
			<button type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Start scouting'}
			</button>
		{/if}
	</form>
</main>

<style>
	.setup {
		max-width: 28rem;
		margin: var(--space-6) auto;
		padding: var(--space-6) var(--space-5);
	}
	h1 { margin: 0 0 var(--space-5); }
	.as {
		margin: 0 0 var(--space-5);
		color: var(--text-muted);
	}
	.as strong { color: var(--text-primary); }
	a { color: var(--accent); }
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-5);
	}
	.label { font-weight: 600; }
	.help { color: var(--text-faint); font-size: var(--fs-sm); }
	input {
		font: inherit;
		padding: var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	button {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font: inherit;
		font-weight: 600;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
