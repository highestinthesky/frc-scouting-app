<script>
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { clearEntries } from '$lib/db.js';

	let eventCode = $state(session.eventCode);
	let scoutName = $state(session.scoutName);
	let saving = $state(false);
	let savedMsg = $state('');
	let clearMsg = $state('');

	async function saveSession(e) {
		e.preventDefault();
		saving = true;
		savedMsg = '';
		try {
			await session.update({
				eventCode: eventCode.trim().toLowerCase(),
				scoutName: scoutName.trim()
			});
			savedMsg = 'Saved.';
		} finally {
			saving = false;
		}
	}

	async function setRole(newRole) {
		await role.set(newRole);
	}

	async function clearAll() {
		const ok = confirm(
			'Delete every entry stored on this device? This cannot be undone. ' +
			'Make sure you exported first.'
		);
		if (!ok) return;
		await clearEntries();
		clearMsg = 'All entries cleared.';
	}
</script>

<svelte:head>
	<title>Settings · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/" aria-label="Back">←</a>
		<h1>Settings</h1>
	</header>

	<section>
		<h2>Role</h2>
		<p class="muted">Choose what this device is being used for.</p>
		<div class="roles">
			<button class:selected={role.isScout} onclick={() => setRole('scout')}>
				<strong>Scout</strong>
				<small>Records matches, exports a single file.</small>
			</button>
			<button class:selected={role.isManager} onclick={() => setRole('manager')}>
				<strong>Manager</strong>
				<small>Imports scout files, sees aggregated entries, re-exports.</small>
			</button>
		</div>
	</section>

	<section>
		<h2>Session</h2>
		<form onsubmit={saveSession}>
			<label class="field">
				<span class="label">Event code</span>
				<input bind:value={eventCode} autocomplete="off" autocapitalize="none" />
			</label>

			<label class="field">
				<span class="label">Your name</span>
				<input bind:value={scoutName} autocomplete="name" />
			</label>

			<button type="submit" class="primary" disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
			{#if savedMsg}<small class="muted ok">{savedMsg}</small>{/if}
		</form>
	</section>

	<section>
		<h2>Danger zone</h2>
		<p class="muted">
			Wipes every entry stored on this device. Settings are kept. Use this
			after exporting and confirming the file works on the manager side.
		</p>
		<button class="danger" onclick={clearAll}>Clear all entries</button>
		{#if clearMsg}<small class="muted ok">{clearMsg}</small>{/if}
	</section>

	<section>
		<h2>About</h2>
		<p class="muted">
			FRC Scout is a local-only app. Everything you enter stays on this
			device until you export a file. The compact <code>.scout</code> file
			can be sent over AirDrop, email, Discord, etc.
		</p>
	</section>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0 1rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: #0b3d91;
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #666;
	}
	.muted { color: #777; font-size: 0.9rem; margin: 0 0 0.6rem; }
	.ok { color: #0b3d91; margin-left: 0.5rem; }
	code {
		background: #f0f0f0;
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}

	.roles {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.roles button {
		flex: 1 1 0;
		min-width: 12rem;
		text-align: left;
		padding: 0.85rem 1rem;
		background: white;
		border: 2px solid #ccc;
		border-radius: 0.5rem;
		cursor: pointer;
		font: inherit;
	}
	.roles button.selected {
		border-color: #0b3d91;
		background: #f0f4fc;
	}
	.roles button strong { display: block; font-size: 1rem; }
	.roles button small {
		display: block;
		color: #555;
		font-size: 0.85rem;
		margin-top: 0.2rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 1rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
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
	button.primary {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		background: #0b3d91;
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button.primary:disabled { opacity: 0.6; cursor: progress; }
	button.danger {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		background: white;
		color: #c0392b;
		border: 1px solid #c0392b;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button.danger:hover { background: #fdecea; }
</style>
