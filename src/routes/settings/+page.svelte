<script>
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { clearEntries } from '$lib/db.js';
	import { syncState, resync } from '$lib/sync.svelte.js';
	import { theme } from '$lib/theme.svelte.js';

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

	function statusLabel() {
		if (!session.eventCode) return 'No event code set';
		if (syncState.status === 'connected') return 'Connected';
		if (syncState.status === 'connecting') return 'Connecting…';
		if (syncState.status === 'offline') return 'Offline';
		if (syncState.status === 'error') return `Error: ${syncState.error ?? 'unknown'}`;
		return 'Idle';
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
		<div class="roles">
			<button class:selected={role.isScout} onclick={() => setRole('scout')}>
				<strong>Scout</strong>
				<small>Records matches.</small>
			</button>
			<button class:selected={role.isManager} onclick={() => setRole('manager')}>
				<strong>Manager</strong>
				<small>Records matches, plus analysis and scheduling.</small>
			</button>
		</div>
	</section>

	<section>
		<h2>Identity</h2>
		<form onsubmit={saveSession}>
			<label class="field">
				<span class="label">Event code</span>
				<small class="help">
					Any code your team agrees on. Everyone using the same one shares data.
				</small>
				<input bind:value={eventCode} autocomplete="off" autocapitalize="none" placeholder="e.g. 2027nyc" />
			</label>

			<label class="field">
				<span class="label">Your name</span>
				<small class="help">Match what the manager typed when assigning you teams.</small>
				<input bind:value={scoutName} autocomplete="name" />
			</label>

			<button type="submit" class="primary" disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
			{#if savedMsg}<small class="muted ok">{savedMsg}</small>{/if}
		</form>
	</section>

	<section>
		<h2>Schedule</h2>
		<p class="muted">
			Assignments and match schedule live on the
			<a href="{base}/schedule/">Schedule</a> tab.
		</p>
	</section>

	<section>
		<h2>Sync</h2>
		<p class="status {syncState.status}">
			{statusLabel()}{#if syncState.pendingCount > 0} · {syncState.pendingCount} pending{/if}
		</p>
		<div class="sync-actions">
			<button
				class="primary"
				onclick={resync}
				disabled={!session.eventCode || syncState.status === 'offline'}
			>
				Sync now
			</button>
			{#if syncState.lastSyncedAt}
				<small class="muted">Last sync: {new Date(syncState.lastSyncedAt).toLocaleTimeString()}</small>
			{/if}
		</div>
	</section>

	<section>
		<h2>Appearance</h2>
		<div class="theme-row">
			<button
				class="theme-btn"
				class:selected={theme.value === 'system'}
				onclick={() => theme.set('system')}
			>System</button>
			<button
				class="theme-btn"
				class:selected={theme.value === 'light'}
				onclick={() => theme.set('light')}
			>Light</button>
			<button
				class="theme-btn"
				class:selected={theme.value === 'dark'}
				onclick={() => theme.set('dark')}
			>Dark</button>
		</div>
	</section>

	<section>
		<h2>Danger zone</h2>
		<p class="muted">Wipes every entry on this device. Synced copies are unaffected.</p>
		<button class="danger" onclick={clearAll}>Clear all entries</button>
		{#if clearMsg}<small class="muted ok">{clearMsg}</small>{/if}
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
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.9rem; margin: 0 0 0.6rem; }
	.muted a { color: var(--accent); }
	.ok { color: var(--accent); margin-left: 0.5rem; }
	.help { color: var(--text-faint); font-size: 0.82rem; }

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
		background: var(--bg-card);
		color: var(--text-primary);
		border: 2px solid var(--border-strong);
		border-radius: 0.5rem;
		cursor: pointer;
		font: inherit;
	}
	.roles button.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.roles button strong { display: block; font-size: 1rem; }
	.roles button small {
		display: block;
		color: var(--text-muted);
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
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	button.primary,
	button.danger {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary { background: var(--accent); color: white; border: none; }
	button.primary:disabled { opacity: 0.6; cursor: progress; }
	button.danger {
		background: var(--bg-card);
		color: var(--danger);
		border: 1px solid var(--danger);
	}
	button.danger:hover { background: var(--danger-bg); }

	.status {
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.4rem 0.7rem;
		border-radius: 0.4rem;
		display: inline-block;
		margin-bottom: 0.4rem;
	}
	.status.idle { background: var(--bg-subtle); color: var(--text-muted); }
	.status.connected { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.status.connecting { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
	.status.offline { background: var(--bg-subtle); color: var(--text-muted); }
	.status.error { background: var(--danger-bg); color: var(--danger); }
	.sync-actions {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.sync-actions button.primary:disabled {
		background: var(--border-strong);
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.theme-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.theme-btn {
		flex: 1 1 0;
		min-width: 6rem;
		padding: 0.6rem 0.85rem;
		background: var(--bg-card);
		color: var(--text-primary);
		border: 2px solid var(--border-strong);
		border-radius: 0.4rem;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
	}
	.theme-btn.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
</style>
