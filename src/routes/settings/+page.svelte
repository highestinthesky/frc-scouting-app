<script>
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import {
		clearEntries,
		getSessionId,
		setSessionId,
		clearSessionId
	} from '$lib/db.js';
	import { newSessionId, isUuid } from '$lib/supabase.js';
	import { syncState, changeSession, stop as stopSync } from '$lib/sync.svelte.js';
	import { onMount } from 'svelte';

	let eventCode = $state(session.eventCode);
	let scoutName = $state(session.scoutName);
	let saving = $state(false);
	let savedMsg = $state('');
	let clearMsg = $state('');

	// Sync session state — read on mount, kept in sync with the syncState rune.
	let pasteValue = $state('');
	let pasteError = $state('');
	let copiedFlash = $state('');
	let revealUuid = $state(false);

	onMount(async () => {
		// syncState.sessionId is set by sync.init() from the layout, but if the
		// user lands directly on Settings before the layout has hydrated, fall
		// back to reading from Dexie.
		if (!syncState.sessionId) {
			const sid = await getSessionId();
			if (sid) syncState.sessionId = sid;
		}
	});

	const inviteLink = $derived.by(() => {
		if (!syncState.sessionId) return '';
		if (typeof window === 'undefined') return '';
		const url = new URL(`${window.location.origin}${base}/`);
		url.searchParams.set('join', syncState.sessionId);
		return url.toString();
	});

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

	async function startNewSession() {
		const uuid = newSessionId();
		await setSessionId(uuid);
		await changeSession(uuid);
	}

	async function joinFromPaste() {
		pasteError = '';
		const v = pasteValue.trim();
		// Accept either a raw UUID or a full invite URL containing ?join=…
		let candidate = v;
		try {
			const u = new URL(v);
			const j = u.searchParams.get('join');
			if (j) candidate = j;
		} catch (_e) {
			// Not a URL — treat input as a raw UUID.
		}
		if (!isUuid(candidate)) {
			pasteError = "That doesn't look like a session link or UUID.";
			return;
		}
		await setSessionId(candidate);
		await changeSession(candidate);
		pasteValue = '';
	}

	async function copyInvite() {
		if (!inviteLink) return;
		try {
			await navigator.clipboard.writeText(inviteLink);
			copiedFlash = 'Copied!';
			setTimeout(() => (copiedFlash = ''), 1500);
		} catch (_e) {
			copiedFlash = 'Could not copy — long-press the link to copy manually.';
		}
	}

	async function leaveSession() {
		const ok = confirm(
			'Leave the shared session? Entries already on this device stay; new ones stop syncing until you join again.'
		);
		if (!ok) return;
		await clearSessionId();
		await stopSync();
		syncState.sessionId = null;
		syncState.status = 'idle';
	}

	async function rotateSession() {
		const ok = confirm(
			'Rotate the session UUID? The old one stops working immediately for this device, and other scouts will need to rejoin via the new invite link. Use this if you think the link leaked.'
		);
		if (!ok) return;
		await startNewSession();
	}

	function statusLabel() {
		if (!syncState.sessionId) return 'No session';
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
		<h2>Identity</h2>
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
		<h2>Wireless sync</h2>
		<p class="muted">
			Optional. Join a shared session and entries are pushed to and pulled from
			the cloud automatically. Files still work as a fallback for venues with
			no network.
		</p>

		{#if !syncState.sessionId}
			<p class="status idle">Not connected to a session.</p>
			<div class="actions-row">
				<button class="primary" onclick={startNewSession}>Start a new team session</button>
			</div>
			<div class="paste-box">
				<label class="field">
					<span class="label">Or join an existing session</span>
					<small class="help">Paste an invite link a teammate sent you, or a raw session UUID.</small>
					<input
						type="text"
						bind:value={pasteValue}
						placeholder="https://…/?join=… or UUID"
						autocomplete="off"
						autocapitalize="none"
					/>
				</label>
				<button class="secondary" onclick={joinFromPaste} disabled={!pasteValue.trim()}>
					Join
				</button>
				{#if pasteError}<small class="error">{pasteError}</small>{/if}
			</div>
		{:else}
			<p class="status {syncState.status}">{statusLabel()}{#if syncState.pendingCount > 0} · {syncState.pendingCount} pending{/if}</p>
			<div class="invite">
				<label class="field">
					<span class="label">Invite link</span>
					<small class="help">Share this with anyone you want on the same data.</small>
					<input type="text" readonly value={inviteLink} onclick={(e) => e.target.select()} />
				</label>
				<div class="actions-row">
					<button class="primary" onclick={copyInvite}>Copy invite link</button>
					{#if copiedFlash}<small class="muted ok">{copiedFlash}</small>{/if}
				</div>
			</div>

			<details class="reveal">
				<summary>Show raw UUID</summary>
				<p class="uuid"><code>{syncState.sessionId}</code></p>
			</details>

			<div class="actions-row spread">
				<button class="ghost" onclick={rotateSession}>Rotate session</button>
				<button class="danger" onclick={leaveSession}>Leave session</button>
			</div>
		{/if}
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
			FRC Scout is local-first. Entries live on this device; if you join a
			wireless session they're also pushed to the cloud so teammates see them
			in seconds. Files (<code>.scout</code>) work as a fallback for venues
			with no network.
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
	.error { color: #c0392b; font-size: 0.85rem; }
	.help { color: #777; font-size: 0.82rem; }
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

	.actions-row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.actions-row.spread { justify-content: space-between; }
	button.primary,
	button.secondary,
	button.ghost,
	button.danger {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary { background: #0b3d91; color: white; }
	button.primary:disabled { opacity: 0.6; cursor: progress; }
	button.secondary { background: white; border-color: #0b3d91; color: #0b3d91; }
	button.secondary:hover { background: #f0f4fc; }
	button.secondary:disabled { opacity: 0.6; cursor: not-allowed; }
	button.ghost { background: white; border-color: #ccc; color: #444; }
	button.ghost:hover { background: #f5f5f5; }
	button.danger {
		background: white;
		color: #c0392b;
		border: 1px solid #c0392b;
	}
	button.danger:hover { background: #fdecea; }

	.status {
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.4rem 0.7rem;
		border-radius: 0.4rem;
		display: inline-block;
		margin-bottom: 0.6rem;
	}
	.status.idle { background: #f3f4f6; color: #555; }
	.status.connected { background: #ecfdf5; color: #065f46; }
	.status.connecting { background: #fefce8; color: #854d0e; }
	.status.offline { background: #f3f4f6; color: #555; }
	.status.error { background: #fef2f2; color: #991b1b; }

	.paste-box { margin-top: 0.5rem; }
	.invite input { font-family: ui-monospace, monospace; font-size: 0.85rem; }

	.reveal { margin: 0.5rem 0 0.75rem; }
	.reveal summary { font-size: 0.85rem; color: #555; cursor: pointer; }
	.uuid {
		background: #f3f4f6;
		border-radius: 0.4rem;
		padding: 0.5rem 0.65rem;
		margin: 0.4rem 0 0;
		word-break: break-all;
		font-size: 0.82rem;
	}
</style>
