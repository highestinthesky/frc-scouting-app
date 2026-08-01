<script>
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { clearEntries } from '$lib/db.js';
	import { syncState, resync } from '$lib/sync.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import { auth } from '$lib/auth.svelte.js';

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

	async function signOut() {
		const ok = await dialog.confirm({
			title: 'Sign out of this device?',
			body:
				'Entries already recorded stay on the phone and sync when you sign ' +
				'back in.\n\nSign in again before your next event — the app needs a ' +
				'connection for that, and a venue is a poor place to discover it.',
			confirmLabel: 'Sign out'
		});
		if (!ok) return;
		await auth.signOut();
	}

	async function clearAll() {
		const ok = await dialog.confirm({
			title: 'Clear every entry on this device?',
			body:
				'This cannot be undone.\n\n' +
				'Entries already synced to your team are unaffected — this only ' +
				'empties this phone. Export a CSV first if you want a copy.',
			confirmLabel: 'Clear entries',
			danger: true
		});
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
		<h2>Account</h2>
		{#if auth.signedIn && auth.profile}
			<p class="acct">
				<strong>{auth.displayName}</strong>
				<span class="uname">{auth.profile.username}</span>
				<span class="tag">{auth.profile.role}</span>
			</p>
			<div class="acct-actions">
				{#if auth.isManager}
					<a class="acct-link" href="{base}/accounts/">Manage accounts</a>
				{/if}
				<Button onclick={signOut}>Sign out</Button>
			</div>
		{:else}
			<p class="muted">
				Not signed in. <a href="{base}/login/">Sign in</a> or
				<a href="{base}/register/">create an account</a> with an invite code.
			</p>
		{/if}
	</section>

	<section>
		<h2 id="role-label">Role</h2>
		<!-- A group of mutually-exclusive options is a radiogroup, not a row of
		     buttons. Without this a screen reader reads two unrelated buttons
		     and never says which one is active. -->
		<div class="roles" role="radiogroup" aria-labelledby="role-label">
			<button
				type="button"
				role="radio"
				aria-checked={role.isScout}
				class:selected={role.isScout}
				onclick={() => setRole('scout')}
			>
				<strong>Scout</strong>
				<small>Records matches.</small>
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={role.isManager}
				class:selected={role.isManager}
				onclick={() => setRole('manager')}
			>
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

			<Button variant="primary" type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</Button>
			{#if savedMsg}<small class="muted ok">{savedMsg}</small>{/if}
		</form>
	</section>

	<section>
		<h2>Schedule</h2>
		<p class="muted">
			Assignments and match schedule live on the
			<a href="{base}/scouting/">Schedule</a> tab.
		</p>
	</section>

	<section>
		<h2>Sync</h2>
		<p class="status {syncState.status}">
			{statusLabel()}{#if syncState.pendingCount > 0} · {syncState.pendingCount} pending{/if}
		</p>
		<div class="sync-actions">
			<Button
				variant="primary"
				onclick={resync}
				disabled={!session.eventCode || syncState.status === 'offline'}
			>Sync now</Button>
			{#if syncState.lastSyncedAt}
				<small class="muted">Last sync: {new Date(syncState.lastSyncedAt).toLocaleTimeString()}</small>
			{/if}
		</div>
	</section>

	<section>
		<h2 id="theme-label">Appearance</h2>
		<div class="theme-row" role="radiogroup" aria-labelledby="theme-label">
			{#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [value, label] (value)}
				<button
					type="button"
					role="radio"
					aria-checked={theme.value === value}
					class="theme-btn"
					class:selected={theme.value === value}
					onclick={() => theme.set(value)}
				>{label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h2>Danger zone</h2>
		<p class="muted">Wipes every entry on this device. Synced copies are unaffected.</p>
		<Button variant="danger" onclick={clearAll}>Clear all entries</Button>
		{#if clearMsg}<small class="muted ok">{clearMsg}</small>{/if}
	</section>
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 * The first full page migrated onto the system. Raw rem values replaced
	 * with named tokens, both pickers given the 44px floor, and the CTA voice
	 * delegated to Button.svelte.
	 */

	main {
		/* Narrower than the data pages: this is forms and prose, and a long
		   measure is harder to scan than a short one. */
		max-width: 32rem;
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-4) 0;
	}
	.back {
		font-size: var(--fs-xl);
		text-decoration: none;
		color: var(--accent);
		/* A back arrow is the most-tapped control on a sub-page and was the
		   smallest thing on it. */
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		letter-spacing: -0.02em;
	}
	h2 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted a { color: var(--accent); }
	.ok { color: var(--accent); margin-left: var(--space-2); }
	.help { color: var(--text-faint); font-size: var(--fs-xs); }

	/* ── choice groups ──────────────────────────────────────────────────
	   Role and Appearance are the same control at two densities: a row of
	   mutually-exclusive options. Shared geometry, different content. */
	.roles,
	.theme-row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.roles button,
	.theme-btn {
		flex: 1 1 0;
		min-height: var(--tap-min);
		background: var(--bg-card);
		color: var(--text-primary);
		border: 2px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		font: inherit;
		transition: border-color var(--dur-short) var(--ease-out);
	}
	.roles button:focus-visible,
	.theme-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	/* Selected is carried by border AND background AND text colour, not colour
	   alone — the same rule the alliance colours follow. */
	.roles button.selected,
	.theme-btn.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}

	.roles button {
		min-width: 12rem;
		text-align: left;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
	}
	.roles button strong { display: block; font-size: var(--fs-md); }
	.roles button small {
		display: block;
		color: var(--text-muted);
		font-size: var(--fs-sm);
		margin-top: var(--space-1);
	}

	.theme-btn {
		min-width: 6rem;
		padding: var(--space-2) var(--space-3);
		font-weight: 600;
	}

	/* ── form ───────────────────────────────────────────────────────────── */
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label { font-weight: 600; font-size: var(--fs-md); }
	input {
		font: inherit;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}

	/* ── sync status ────────────────────────────────────────────────────── */
	.status {
		font-size: var(--fs-md);
		font-weight: 600;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-md);
		display: inline-block;
		margin-bottom: var(--space-1);
	}
	.status.idle,
	.status.offline { background: var(--bg-subtle); color: var(--text-muted); }
	.status.connected {
		background: var(--success-bg);
		color: var(--success);
		border: 1px solid var(--success-border);
	}
	.status.connecting {
		background: var(--warning-bg);
		color: var(--warning);
		border: 1px solid var(--warning-border);
	}
	.status.error { background: var(--danger-bg); color: var(--danger); }
	.acct {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0 0 var(--space-3);
	}
	.uname { color: var(--text-faint); font-size: var(--fs-sm); }
	.tag {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.acct-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
	.acct-link {
		font-weight: 600;
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		text-decoration: none;
	}
	.acct-link:hover { background: var(--bg-subtle); }

	.sync-actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}

	@media (prefers-reduced-motion: reduce) {
		.roles button,
		.theme-btn { transition-duration: 0.01ms; }
	}
</style>
