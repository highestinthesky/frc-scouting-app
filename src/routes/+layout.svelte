<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { syncState, init as syncInit, changeSession } from '$lib/sync.svelte.js';
	import { isUuid } from '$lib/supabase.js';
	import { setSessionId, getSessionId } from '$lib/db.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';

	let { children } = $props();

	// Magic-link join: if the URL carries ?join=<uuid>, hold the candidate
	// here so the modal can render a confirmation prompt.
	let pendingJoin = $state(/** @type {string | null} */ (null));
	let joining = $state(false);

	onMount(async () => {
		await Promise.all([session.load(), role.load()]);
		await syncInit();

		// Inspect the URL once on first load. If there's a join token, show
		// a confirmation rather than blindly switching the team's data scope.
		const candidate = page.url.searchParams.get('join');
		if (candidate && isUuid(candidate)) {
			const current = await getSessionId();
			// If we're already in this session, nothing to do — just clean the URL.
			if (current === candidate) {
				clearJoinParam();
			} else {
				pendingJoin = candidate;
			}
		} else if (candidate) {
			// Malformed token — strip it so a refresh doesn't keep tripping the prompt.
			clearJoinParam();
		}
	});

	function clearJoinParam() {
		const url = new URL(window.location.href);
		url.searchParams.delete('join');
		window.history.replaceState({}, '', url.toString());
	}

	async function acceptJoin() {
		if (!pendingJoin) return;
		joining = true;
		try {
			await setSessionId(pendingJoin);
			await changeSession(pendingJoin);
			pendingJoin = null;
			clearJoinParam();
		} finally {
			joining = false;
		}
	}

	function declineJoin() {
		pendingJoin = null;
		clearJoinParam();
	}

	function isActive(path) {
		// Compare against pathname with the deploy base stripped, so a single
		// /manager check works whether we're at "/manager" (dev) or
		// "/frc-scouting-app/manager" (GitHub Pages).
		const full = page.url.pathname;
		const p = base && full.startsWith(base) ? full.slice(base.length) || '/' : full;
		if (path === '/') return p === '/' || p === '';
		return p === path || p.startsWith(path + '/') || p === path.replace(/\/$/, '');
	}

	// Pre-compute the colour and tooltip for the sync dot. Reactive on syncState.
	const syncDot = $derived.by(() => {
		const s = syncState.status;
		if (s === 'connected') return { className: 'ok', title: 'Synced' };
		if (s === 'connecting') return { className: 'pending', title: 'Connecting…' };
		if (s === 'offline') return { className: 'offline', title: 'Offline — entries will sync when you reconnect.' };
		if (s === 'error') return { className: 'err', title: syncState.error || 'Sync error' };
		return { className: 'idle', title: 'No session — set one in Settings to share with your team.' };
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !session.loaded || !role.loaded}
	<p class="boot">Loading…</p>
{:else if !session.isConfigured}
	<SessionSetup />
{:else}
	<header class="app-bar">
		<div class="app-bar-inner">
			<strong class="event">{session.eventCode}</strong>
			<span class="sep">·</span>
			<span class="name">{session.scoutName}</span>
			<span class="sync-dot {syncDot.className}" title={syncDot.title} aria-label={syncDot.title}>
				{#if syncState.pendingCount > 0}<span class="pending-count">{syncState.pendingCount}</span>{/if}
			</span>
			<span class="role-badge" class:manager={role.isManager}>
				{role.value}
			</span>
		</div>
	</header>

	<nav class="tabs">
		<a href="{base}/" class:active={isActive('/')}>
			Entries
		</a>
		{#if role.isManager}
			<a href="{base}/manager/" class:active={isActive('/manager')}>
				Manager
			</a>
		{/if}
		<a href="{base}/settings/" class:active={isActive('/settings')}>
			Settings
		</a>
	</nav>

	{@render children()}
{/if}

{#if pendingJoin}
	<div class="join-overlay" role="dialog" aria-modal="true" aria-labelledby="join-title">
		<div class="join-card">
			<h2 id="join-title">Join shared session?</h2>
			<p class="muted">
				This link will switch your scouting data to a team session. Entries you
				create will be visible to anyone else who has joined the same session.
			</p>
			<p class="uuid"><code>{pendingJoin}</code></p>
			<div class="join-actions">
				<button class="ghost" onclick={declineJoin} disabled={joining}>Cancel</button>
				<button class="primary" onclick={acceptJoin} disabled={joining}>
					{joining ? 'Joining…' : 'Join session'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #fafafa;
		color: #1a1a1a;
	}
	.boot {
		text-align: center;
		margin-top: 4rem;
		color: #777;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.app-bar {
		background: #0b3d91;
		color: white;
		padding: 0.55rem 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.app-bar-inner {
		max-width: 42rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
	}
	.event { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
	.sep { opacity: 0.6; }
	.name { opacity: 0.95; }
	.role-badge {
		background: rgba(255, 255, 255, 0.18);
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.role-badge.manager {
		background: #ffb000;
		color: #0b3d91;
		font-weight: 700;
	}

	.sync-dot {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: #999;
	}
	.sync-dot.ok { background: #4ade80; }
	.sync-dot.pending { background: #facc15; }
	.sync-dot.offline { background: #999; }
	.sync-dot.err { background: #f87171; }
	.sync-dot.idle { background: rgba(255, 255, 255, 0.35); }
	.pending-count {
		position: absolute;
		transform: translate(0.6rem, -0.4rem);
		background: #facc15;
		color: #422;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0 0.3rem;
		border-radius: 999px;
	}

	.tabs {
		background: white;
		border-bottom: 1px solid #e0e0e0;
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		padding: 0 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.tabs a {
		padding: 0.65rem 1rem;
		text-decoration: none;
		color: #555;
		font-weight: 600;
		font-size: 0.9rem;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.tabs a.active {
		color: #0b3d91;
		border-bottom-color: #0b3d91;
	}
	.tabs a:hover { color: #0b3d91; }

	.join-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.join-card {
		background: white;
		border-radius: 0.6rem;
		padding: 1.25rem 1.25rem 1rem;
		max-width: 28rem;
		width: 100%;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.join-card h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
	.join-card .muted { color: #555; font-size: 0.92rem; margin: 0 0 0.75rem; }
	.join-card .uuid {
		background: #f3f4f6;
		border-radius: 0.4rem;
		padding: 0.55rem 0.7rem;
		margin: 0 0 1rem;
		word-break: break-all;
		font-size: 0.82rem;
	}
	.join-actions { display: flex; gap: 0.6rem; justify-content: flex-end; }
	.join-actions button {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.join-actions .ghost { background: white; border-color: #ccc; color: #444; }
	.join-actions .ghost:hover { background: #f5f5f5; }
	.join-actions .primary { background: #0b3d91; color: white; }
	.join-actions .primary:disabled { opacity: 0.6; cursor: progress; }
</style>
