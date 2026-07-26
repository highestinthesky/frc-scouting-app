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
		margin: 4rem auto;
		padding: 2rem 1.5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	h1 { margin: 0 0 1.5rem; }
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 1.25rem;
	}
	.label { font-weight: 600; }
	.help { color: var(--text-faint); font-size: 0.85rem; }
	input {
		font: inherit;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	button {
		width: 100%;
		padding: 0.8rem 1rem;
		font: inherit;
		font-weight: 600;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
