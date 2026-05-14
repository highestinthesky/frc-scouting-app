<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import {
		syncState,
		init as syncInit,
		setEventCode as syncSetEventCode
	} from '$lib/sync.svelte.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';

	let { children } = $props();

	onMount(async () => {
		await Promise.all([session.load(), role.load(), theme.load()]);
		await syncInit();
	});

	// Re-scope the sync layer whenever the user changes their event code in
	// Identity. Empty/missing event code pauses sync; otherwise the layer
	// derives a session id deterministically from the code and (re)connects.
	$effect(() => {
		if (session.loaded) syncSetEventCode(session.eventCode);
	});

	// Apply theme by setting `data-theme` on the document root. "system" leaves
	// the attribute unset and lets the prefers-color-scheme media query handle
	// it; explicit light/dark wins over system preference.
	$effect(() => {
		if (typeof document === 'undefined' || !theme.loaded) return;
		const root = document.documentElement;
		if (theme.value === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', theme.value);
	});

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
		if (s === 'offline')
			return { className: 'offline', title: 'Offline — entries will sync when you reconnect.' };
		if (s === 'error') return { className: 'err', title: syncState.error || 'Sync error' };
		return { className: 'idle', title: 'No event code — set one in Settings to share with your team.' };
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
		<a href="{base}/schedule/" class:active={isActive('/schedule')}>
			Schedule
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

<style>
	/* ── Theme variables ───────────────────────────────────────────────
	   Light is the default. Dark applies whenever the OS prefers dark
	   *unless* the user explicitly chose light, OR whenever the user
	   explicitly chose dark via Settings → data-theme="dark".

	   Components consume these vars instead of hardcoding hex values. The
	   accent (navy brand) stays the same in both themes for the app bar;
	   everything else flips. */
	:global(:root) {
		--bg-page: #fafafa;
		--bg-card: #ffffff;
		--bg-subtle: #f5f5f5;
		--bg-elev: #ffffff;
		--text-primary: #1a1a1a;
		--text-muted: #555;
		--text-faint: #888;
		--border: #e0e0e0;
		--border-strong: #ccc;
		--accent: #0b3d91;
		--accent-hover: #0a3480;
		--accent-soft: #f0f4fc;
		--on-accent: #ffffff;
		--danger: #c0392b;
		--danger-bg: #fdecea;
		--success: #047857;
		--success-bg: #ecfdf5;
		--success-border: #6ee7b7;
		--warning: #92400e;
		--warning-bg: #fffbeb;
		--warning-border: #fcd34d;
		--banner-info-bg: #e8effc;
		--banner-info-border: #bccbea;
		--banner-red-bg: #fef2f2;
		--banner-red-border: #fca5a5;
		--banner-blue-bg: #eff6ff;
		--banner-blue-border: #93c5fd;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--bg-page: #0e0e10;
			--bg-card: #1a1a1c;
			--bg-subtle: #1f1f22;
			--bg-elev: #232326;
			--text-primary: #e8e8e8;
			--text-muted: #a0a0a3;
			--text-faint: #6e6e72;
			--border: #2a2a2d;
			--border-strong: #38383b;
			--accent: #6a9bf0;
			--accent-hover: #84afff;
			--accent-soft: #1a2a4a;
			--danger: #f7857a;
			--danger-bg: #3a1a18;
			--success: #6ee7b7;
			--success-bg: #0f2a23;
			--success-border: #1d5a45;
			--warning: #fcd34d;
			--warning-bg: #2a200a;
			--warning-border: #5a4318;
			--banner-info-bg: #1a2a4a;
			--banner-info-border: #2c4480;
			--banner-red-bg: #3a1a18;
			--banner-red-border: #5a2a22;
			--banner-blue-bg: #1a2a4a;
			--banner-blue-border: #2c4480;
		}
	}
	:global(:root[data-theme='dark']) {
		--bg-page: #0e0e10;
		--bg-card: #1a1a1c;
		--bg-subtle: #1f1f22;
		--bg-elev: #232326;
		--text-primary: #e8e8e8;
		--text-muted: #a0a0a3;
		--text-faint: #6e6e72;
		--border: #2a2a2d;
		--border-strong: #38383b;
		--accent: #6a9bf0;
		--accent-hover: #84afff;
		--accent-soft: #1a2a4a;
		--danger: #f7857a;
		--danger-bg: #3a1a18;
		--success: #6ee7b7;
		--success-bg: #0f2a23;
		--success-border: #1d5a45;
		--warning: #fcd34d;
		--warning-bg: #2a200a;
		--warning-border: #5a4318;
		--banner-info-bg: #1a2a4a;
		--banner-info-border: #2c4480;
		--banner-red-bg: #3a1a18;
		--banner-red-border: #5a2a22;
		--banner-blue-bg: #1a2a4a;
		--banner-blue-border: #2c4480;
	}

	:global(body) {
		margin: 0;
		background: var(--bg-page);
		color: var(--text-primary);
	}
	:global(input), :global(textarea), :global(select) {
		color: var(--text-primary);
		background: var(--bg-card);
	}
	.boot {
		text-align: center;
		margin-top: 4rem;
		color: var(--text-faint);
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
		background: var(--bg-card);
		border-bottom: 1px solid var(--border);
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		padding: 0 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.tabs a {
		padding: 0.65rem 1rem;
		text-decoration: none;
		color: var(--text-muted);
		font-weight: 600;
		font-size: 0.9rem;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.tabs a.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.tabs a:hover { color: var(--accent); }
</style>
