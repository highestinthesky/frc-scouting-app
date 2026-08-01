<script>
	import { session } from '$lib/session.svelte.js';

	let eventCode = $state(session.eventCode);
	let scoutName = $state(session.scoutName);
	let saving = $state(false);

	async function save(e) {
		e.preventDefault();
		saving = true;
		try {
			await session.update({
				eventCode: eventCode.trim().toLowerCase(),
				scoutName: scoutName.trim()
			});
		} finally {
			saving = false;
		}
	}
</script>

<main class="setup">
	<h1>Set up scouting</h1>

	<form onsubmit={save}>
		<label class="field">
			<span class="label">Event code</span>
			<small class="help">Whatever your team agreed on.</small>
			<input bind:value={eventCode} required autocomplete="off" autocapitalize="none" placeholder="2026xxxx" />
		</label>

		<label class="field">
			<span class="label">Your name</span>
			<input bind:value={scoutName} required autocomplete="name" placeholder="Your name" />
		</label>

		<button type="submit" disabled={saving}>
			{saving ? 'Saving…' : 'Start scouting'}
		</button>
	</form>
</main>

<style>
	.setup {
		max-width: 28rem;
		margin: var(--space-6) auto;
		padding: var(--space-6) var(--space-5);
		font-family: system-ui, -apple-system, sans-serif;
	}
	h1 { margin: 0 0 var(--space-5); }
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
