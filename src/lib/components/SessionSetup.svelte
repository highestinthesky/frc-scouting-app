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
	<p class="muted">Just once per device. You can change these later.</p>

	<form onsubmit={save}>
		<label class="field">
			<span class="label">Event code</span>
			<small class="help">e.g. <code>2026cala</code> or whatever the event uses on TBA.</small>
			<input bind:value={eventCode} required autocomplete="off" autocapitalize="none" placeholder="2026xxxx" />
		</label>

		<label class="field">
			<span class="label">Your name</span>
			<small class="help">So managers know who scouted what.</small>
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
	h1 { margin: 0 0 0.25rem; }
	.muted { color: #666; margin-bottom: 1.5rem; }
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 1.25rem;
	}
	.label { font-weight: 600; }
	.help { color: #777; font-size: 0.85rem; }
	code {
		background: #f0f0f0;
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}
	input {
		font: inherit;
		padding: 0.6rem 0.7rem;
		border: 1px solid #ccc;
		border-radius: 0.4rem;
	}
	input:focus {
		outline: 2px solid #0b3d91;
		outline-offset: 1px;
		border-color: #0b3d91;
	}
	button {
		width: 100%;
		padding: 0.8rem 1rem;
		font: inherit;
		font-weight: 600;
		background: #0b3d91;
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
