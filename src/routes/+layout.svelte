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
	import { reminders } from '$lib/reminders.svelte.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';
	import ReminderBanner from '$lib/components/ReminderBanner.svelte';

	let { children } = $props();

	onMount(async () => {
		await Promise.all([session.load(), role.load(), theme.load()]);
		await syncInit();
		await reminders.init();
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

	<!-- Bottom-docked on phones, top strip from 40rem up. See design.md
	     § Three deviations — a scout holds this one-handed. -->
	<nav class="tabs" aria-label="Main">
		<a href="{base}/" class:active={isActive('/')} aria-current={isActive('/') ? 'page' : undefined}>
			Entries
		</a>
		<a href="{base}/schedule/" class:active={isActive('/schedule')} aria-current={isActive('/schedule') ? 'page' : undefined}>
			Schedule
		</a>
		{#if role.isManager}
			<a href="{base}/manager/" class:active={isActive('/manager')} aria-current={isActive('/manager') ? 'page' : undefined}>
				Manager
			</a>
		{/if}
		<a href="{base}/settings/" class:active={isActive('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
			Settings
		</a>
	</nav>

	<ReminderBanner />

	{@render children()}
{/if}

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 * deviations: system fonts (no webfont — venue wifi) · bottom-docked nav
	 *             on phones (no N1–N13 archetype is thumb-reachable) ·
	 *             brand purple retained over the genre accents
	 * pre-emit critique: P5 H4 E4 S5 R5 V4
	 * contrast: AA pass, both themes, worst case 4.54 (--text-faint)
	 */

	/* ── Theme variables ───────────────────────────────────────────────
	   Light is the default. Dark applies whenever the OS prefers dark
	   *unless* the user explicitly chose light, OR whenever the user
	   explicitly chose dark via Settings → data-theme="dark".

	   Components consume these vars instead of hardcoding hex values. The
	   accent (purple brand) stays the same in both themes for the app bar;
	   everything else flips. */
	:global(:root) {
		--bg-page: #fafafa;
		--bg-card: #ffffff;
		--bg-subtle: #f5f5f5;
		--bg-elev: #ffffff;
		--text-primary: #1a1a1a;
		--text-muted: #555;
		--text-faint: #707070;
		--border: #e0e0e0;
		--border-strong: #ccc;
		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #f4ebfa;
		--on-accent: #ffffff;
		--alliance-red: #c0392b;
		--alliance-blue: #2c5cb0;
		--danger: #c0392b;
		--danger-bg: #fdecea;
		--success: #047857;
		--success-bg: #ecfdf5;
		--success-border: #6ee7b7;
		--warning: #92400e;
		--warning-bg: #fffbeb;
		--warning-border: #fcd34d;
		--banner-info-bg: #ece1f5;
		--banner-info-border: #d4c2e8;
		--banner-red-bg: #fef2f2;
		--banner-red-border: #fca5a5;
		--banner-blue-bg: #eff6ff;
		--banner-blue-border: #93c5fd;

		/* ── structural tokens (theme-independent) ──────────────────────
		   Spacing, radius, type-scale and elevation. These are the single
		   source of truth the design system is migrating onto so spacing
		   and corners stop drifting page-to-page. New UI should consume
		   these instead of hardcoding rem values. */
		--space-1: 0.25rem;
		--space-2: 0.5rem;
		--space-3: 0.75rem;
		--space-4: 1rem;
		--space-5: 1.5rem;
		--space-6: 2rem;
		--radius-sm: 0.3rem;
		--radius-md: 0.4rem;
		--radius-lg: 0.6rem;
		--radius-pill: 999px;
		--fs-xs: 0.75rem;
		--fs-sm: 0.85rem;
		--fs-md: 0.95rem;
		--fs-lg: 1.1rem;
		--fs-xl: 1.5rem;
		--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
		--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.12);

		/* Minimum tap target. 44px is the floor for a thumb on a moving
		   phone; design.md § Touch targets treats it as non-negotiable. */
		--tap-min: 2.75rem;
		--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
		--dur-short: 240ms;
		/* Height the bottom nav occupies on phones, so pages can reserve it. */
		--nav-bottom-h: calc(3.25rem + env(safe-area-inset-bottom, 0px));
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--bg-page: #0e0e10;
			--bg-card: #1a1a1c;
			--bg-subtle: #1f1f22;
			--bg-elev: #232326;
			--text-primary: #e8e8e8;
			--text-muted: #a0a0a3;
			--text-faint: #8a8a8a;
			--border: #2a2a2d;
			--border-strong: #38383b;
			--accent: #b18de0;
			--accent-hover: #c5a8eb;
			--accent-soft: #2a1e3d;
			--alliance-red: #f1746a;
			--alliance-blue: #6fa8ec;
			--danger: #f7857a;
			--danger-bg: #3a1a18;
			--success: #6ee7b7;
			--success-bg: #0f2a23;
			--success-border: #1d5a45;
			--warning: #fcd34d;
			--warning-bg: #2a200a;
			--warning-border: #5a4318;
			--banner-info-bg: #2a1e3d;
			--banner-info-border: #4a3a6e;
			--banner-red-bg: #3a1a18;
			--banner-red-border: #5a2a22;
			--banner-blue-bg: #16233a;
			--banner-blue-border: #2c4a7a;
		}
	}
	:global(:root[data-theme='dark']) {
		--bg-page: #0e0e10;
		--bg-card: #1a1a1c;
		--bg-subtle: #1f1f22;
		--bg-elev: #232326;
		--text-primary: #e8e8e8;
		--text-muted: #a0a0a3;
		--text-faint: #8a8a8a;
		--border: #2a2a2d;
		--border-strong: #38383b;
		--accent: #b18de0;
		--accent-hover: #c5a8eb;
		--accent-soft: #2a1e3d;
		--alliance-red: #f1746a;
		--alliance-blue: #6fa8ec;
		--danger: #f7857a;
		--danger-bg: #3a1a18;
		--success: #6ee7b7;
		--success-bg: #0f2a23;
		--success-border: #1d5a45;
		--warning: #fcd34d;
		--warning-bg: #2a200a;
		--warning-border: #5a4318;
		--banner-info-bg: #2a1e3d;
		--banner-info-border: #4a3a6e;
		--banner-red-bg: #3a1a18;
		--banner-red-border: #5a2a22;
		--banner-blue-bg: #16233a;
		--banner-blue-border: #2c4a7a;
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
	/* The app bar is identity, not navigation — who you are and whether your
	   work is safe. It stays purple in both themes: it's the one surface
	   carrying the team's colour, and a scout glancing down should recognise
	   the app before they read a word of it. */
	.app-bar {
		background: #5f24a2;
		color: #ffffff;
		padding: var(--space-2) var(--space-4);
		padding-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		font-family: system-ui, -apple-system, sans-serif;
	}
	.app-bar-inner {
		max-width: 42rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-md);
	}
	.event {
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}
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
		color: #5f24a2; /* fixed dark purple on the static yellow chip — adapts poorly to dark mode otherwise */
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

	/* ── Primary navigation ────────────────────────────────────────────
	   Phone-first: docked to the bottom of the viewport, where a thumb
	   reaches without the phone changing hands. A top tab strip is the
	   furthest point from a resting thumb on a 6" screen, and this app is
	   used standing up, one-handed, while a match is running.

	   From 40rem the same markup becomes a top strip — on a laptop the
	   bottom edge is the wrong place and there's no reach problem to solve.

	   Nav stays before <main> in the DOM either way, so tab order and
	   screen-reader order are unchanged by the visual move. */
	.tabs {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 20;
		display: flex;
		justify-content: stretch;
		background: var(--bg-card);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom, 0px);
		font-family: system-ui, -apple-system, sans-serif;
	}
	.tabs a {
		flex: 1 1 0;
		min-width: 0;
		min-height: var(--tap-min);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2) var(--space-1);
		text-decoration: none;
		color: var(--text-muted);
		font-weight: 600;
		font-size: var(--fs-sm);
		/* The active marker rides the top edge here — it points back at the
		   content, not off the bottom of the screen. */
		border-top: 3px solid transparent;
		margin-top: -1px;
		transition: color var(--dur-short) var(--ease-out);
	}
	.tabs a.active {
		color: var(--accent);
		border-top-color: var(--accent);
		background: var(--accent-soft);
	}
	.tabs a:hover { color: var(--accent); }
	.tabs a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* Pages reserve the bar's height themselves, via --nav-bottom-h in their
	   own `main` rule. A :global(main) rule here would look like it handled
	   it and quietly lose: Svelte scoping makes a page's `main` selector
	   (0,1,1) which outranks :global(main) at (0,0,1). Better that each page
	   states the reservation than that the layout pretends to. */

	@media (min-width: 40rem) {
		.tabs {
			position: static;
			justify-content: center;
			border-top: none;
			border-bottom: 1px solid var(--border);
			padding: 0 var(--space-4);
			padding-bottom: 0;
		}
		.tabs a {
			flex: 0 0 auto;
			padding: var(--space-3) var(--space-4);
			border-top: none;
			border-bottom: 3px solid transparent;
			margin-top: 0;
			margin-bottom: -1px;
		}
		.tabs a.active {
			border-bottom-color: var(--accent);
			background: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tabs a { transition-duration: 0.01ms; }
	}
</style>
