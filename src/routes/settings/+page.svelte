<script>
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { session } from '$lib/session.svelte.js';
	import { clearEntries } from '$lib/db.js';
	import { syncState, resync } from '$lib/sync.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import EventPicker from '$lib/components/EventPicker.svelte';

	let scoutName = $state(session.scoutName);
	let saving = $state(false);

	/**
	 * Does what this device records as differ from the account it is signed into?
	 *
	 * Only meaningful while scout_name is still a join key. Compared through
	 * scout-identity's normalisation rather than raw, because "Ning" and "ning"
	 * are one person and warning about that would be noise.
	 */
	const nameDiverges = $derived(
		auth.signedIn &&
			Boolean(auth.displayName) &&
			Boolean(session.scoutName?.trim()) &&
			session.scoutName.trim().toLowerCase() !== auth.displayName.trim().toLowerCase()
	);

	async function adoptAccountName() {
		saving = true;
		try {
			await session.update({ scoutName: auth.displayName });
			scoutName = auth.displayName;
			savedMsg = 'This device now records as your account name.';
		} finally {
			saving = false;
		}
	}
	let savedMsg = $state('');
	let clearMsg = $state('');

	async function saveSession(e) {
		e.preventDefault();
		saving = true;
		savedMsg = '';
		try {
			// The event is the picker's to set — this form only owns the name now.
			await session.update({ scoutName: scoutName.trim() });
			savedMsg = 'Saved.';
		} finally {
			saving = false;
		}
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
		if (!session.eventCode) return 'No event chosen';
		// Name the reason rather than showing a status that will never advance.
		if (syncState.reason === 'signed-out') return 'Paused — sign in to sync';
		if (syncState.reason === 'no-such-event') return 'Paused — not on this event';
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
		<a class="back" href="{base}/scouting/" aria-label="Back">←</a>
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
			<!-- "Manage accounts" used to sit here as a bare <a> beside a real
			     <Button>, so the two were visibly different sizes. It is not restyled
			     — it moved. Managing accounts is running the team, which is Studio's
			     job, and Settings is left with the one control that belongs to this
			     device. -->
			<div class="acct-actions">
				<Button onclick={signOut}>Sign out</Button>
			</div>
		{:else if auth.orphaned}
			<p class="muted">
				Signed in as <strong>{auth.authEmail}</strong>, but account setup is incomplete.
				<a href="{base}/register/">Redeem an invite</a> to finish.
			</p>
			<Button onclick={signOut}>Sign out</Button>
		{:else}
			<p class="muted">
				Not signed in. <a href="{base}/">Sign in</a> or
				<a href="{base}/register/">create an account</a> with an invite code.
			</p>
		{/if}
	</section>

	<section>
		<h2>Identity</h2>
		<form onsubmit={saveSession}>
			<!-- Wrapped in the page's own .field rather than passing a class to the
			     component: the scoping hash belongs to this file, so it lands on the
			     div and never on the picker's internals. See CLAUDE.md. -->
			<div class="field">
				<EventPicker />
			</div>

			<!-- Signed in, the account owns the name. 0023 makes the invite carry the
			     spelling the manager typed, so the profile and the assignments agree
			     by construction — and a free-text box here is the one place they can
			     be pulled apart again.
			     It is not silently overwritten. CLAUDE.md: the name is still a join
			     key, so replacing one a device already had would detach it from
			     everything addressed to the old spelling. A divergence is SHOWN and
			     fixed on request, which is the difference between repairing it and
			     doing it to someone. -->
			{#if auth.signedIn}
				<div class="field">
					<span class="label">Your name</span>
					<p class="named">{auth.displayName || '(not set on your account)'}</p>
					{#if nameDiverges}
						<small class="help warn">
							This device still records as <strong>{session.scoutName}</strong>.
							Assignments addressed to your account name will not reach it.
						</small>
						<Button type="button" disabled={saving} onclick={adoptAccountName}>
							Use my account name
						</Button>
					{:else}
						<small class="help">
							From your account. Your manager set it, so assignments reach you.
						</small>
					{/if}
				</div>
			{:else}
				<label class="field">
					<span class="label">Your name</span>
					<small class="help">Match what the manager typed when assigning you teams.</small>
					<input bind:value={scoutName} autocomplete="name" />
				</label>
			{/if}

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

	/* The PAGE is as wide as its sibling tab; the COLUMN inside it is not.
	   Settings sat at --w-form (34rem) while /scouting sat at --w-list (60rem),
	   so switching between two tabs in the same bar jumped the content by 26rem
	   and read as a mistake. Both widths were individually right and the pairing
	   was wrong: width is a decision about the content, and the content here is
	   a narrow column of fields inside a full-width page — not a narrow page.
	   Same fix Accounts got in v0.74. */
	section {
		/* The column of fields, at the width a field should be read at. */
		max-width: var(--w-form);
	}
	main {
		max-width: var(--w-list);
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
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
