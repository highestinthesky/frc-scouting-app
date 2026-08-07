<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
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
	import { auth, AUTH_ENFORCED } from '$lib/auth.svelte.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';
	import ReminderBanner from '$lib/components/ReminderBanner.svelte';
	import Dialog from '$lib/components/Dialog.svelte';

	let { children } = $props();

	onMount(async () => {
		await Promise.all([session.load(), role.load(), theme.load(), auth.init()]);
		await syncInit();
		await reminders.init();
	});

	// ── route guarding ──────────────────────────────────────────────────────
	//
	// Accounts are additive right now: migration 0008 creates them, but no
	// policy requires one yet. So this redirects when someone is signed OUT and
	// accounts exist to sign in to — it does not yet lock the app.
	//
	// Note what is being asked: "has this device ever signed in", not "is the
	// token valid this second". Validity is the sync layer's problem. Guarding
	// on validity is how a scout in a dead corner gets bounced to a login
	// screen mid-match, which is the failure this whole design avoids.
	const PUBLIC_ROUTES = ['/login', '/register'];
	const onLoginRoute = $derived(isActive('/login'));
	const onRegisterRoute = $derived(isActive('/register'));
	const onPublicRoute = $derived(PUBLIC_ROUTES.some((r) => isActive(r)));

	$effect(() => {
		if (auth.loading) return;
		// A signed-in user never needs /login. A complete account never needs
		// /register either, but an orphaned auth user MUST be allowed to stay
		// there and retry the invite redemption that failed after signUp().
		if (auth.signedIn && (onLoginRoute || (onRegisterRoute && !auth.orphaned))) {
			goto(`${base}/`, { replaceState: true });
			return;
		}
		// Signed out: only redirect once accounts are actually required. While
		// AUTH_ENFORCED is false the app works exactly as it did, and /login is
		// reachable but optional — that is what lets accounts be tested before
		// anyone depends on them.
		if (AUTH_ENFORCED && !auth.signedIn && !onPublicRoute) {
			goto(`${base}/login/`, { replaceState: true });
		}
	});

	// Before cutover, the local role/name and manager passphrase remain the
	// operational authority. After cutover, the account profile becomes the
	// only identity and role source. Keeping this branch next to the flag avoids
	// a half-cutover where the badge and manager navigation disagree.
	const shellIdentity = $derived.by(() =>
		AUTH_ENFORCED
			? {
					name: auth.displayName || auth.profile?.username || '',
					role: auth.role ?? 'scout',
					isManager: auth.isManager
				}
			: { name: session.scoutName, role: role.value, isManager: role.isManager }
	);

	// Re-scope the sync layer whenever the user changes their event code in
	// Identity. Empty/missing event code pauses sync; otherwise the layer
	// derives a session id deterministically from the code and (re)connects.
	$effect(() => {
		if (session.loaded) syncSetEventCode(session.eventCode);
	});

	// Apply the theme by writing an EXPLICIT data-theme on the document root —
	// "dark" or "light", never absent. The stylesheet has a single dark block
	// keyed on that attribute, so "system" has to be resolved here rather than
	// by a second copy of the palette inside a prefers-color-scheme query.
	//
	// While the setting is "system" this also has to follow the OS, since the
	// user can flip it with the app open and no media query is watching for us
	// any more.
	$effect(() => {
		if (typeof document === 'undefined' || !theme.loaded) return;
		const root = document.documentElement;

		if (theme.value !== 'system') {
			root.setAttribute('data-theme', theme.value);
			return;
		}

		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	function isActive(path) {
		// Compare against pathname with the deploy base stripped, so a single
		// /insights check works whether we're at "/insights" (dev) or
		// "/frc-scouting-app/insights" (GitHub Pages).
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

{#if !session.loaded || !role.loaded || auth.loading}
	<p class="boot">Loading…</p>
{:else if onPublicRoute}
	{@render children()}
{:else if AUTH_ENFORCED && auth.orphaned}
	<!-- Signed in, but no profile: the invite was never redeemed, or a manager
	     revoked access. Say so plainly rather than showing an empty app. -->
	<main class="gate">
		<h1>No access</h1>
		<p>
			This account isn't part of a team yet. If a manager gave you an invite
			code, finish signing up. If your access was revoked, ask them to invite
			you again.
		</p>
		<div class="gate-actions">
			<a class="gate-link" href="{base}/register/">Enter an invite code</a>
			<button type="button" class="gate-out" onclick={() => auth.signOut()}>Sign out</button>
		</div>
	</main>
{:else if !session.isConfigured}
	<SessionSetup />
{:else}
	<header class="app-bar">
		<div class="app-bar-inner">
			<strong class="event">{session.eventCode}</strong>
			<span class="sep">·</span>
			<span class="name">{shellIdentity.name}</span>
			<span class="sync-dot {syncDot.className}" title={syncDot.title} aria-label={syncDot.title}>
				{#if syncState.pendingCount > 0}<span class="pending-count">{syncState.pendingCount}</span>{/if}
			</span>
			<span class="role-badge" class:manager={shellIdentity.isManager}>
				{shellIdentity.role}
			</span>
		</div>
	</header>

	<!-- Bottom-docked on phones, top strip from 40rem up. See design.md
	     § Three deviations — a scout holds this one-handed. -->
	<nav class="tabs" aria-label="Main">
		<a href="{base}/" class:active={isActive('/')} aria-current={isActive('/') ? 'page' : undefined}>
			Home
		</a>
		<a href="{base}/scouting/" class:active={isActive('/scouting')} aria-current={isActive('/scouting') ? 'page' : undefined}>
			Scouting
		</a>
		{#if shellIdentity.isManager}
			<a href="{base}/insights/" class:active={isActive('/insights')} aria-current={isActive('/insights') ? 'page' : undefined}>
				Insights
			</a>
		{/if}
		<a href="{base}/settings/" class:active={isActive('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
			Settings
		</a>
	</nav>

	{#if !AUTH_ENFORCED && auth.orphaned}
		<div class="account-warning" role="status">
			<strong>Account setup is incomplete.</strong>
			Legacy event-code access still works on this release, but this account will not work after
			cutover until you <a href="{base}/register/">redeem an invite</a>.
		</div>
	{/if}

	<ReminderBanner />

	{@render children()}
{/if}

<!-- One instance for the whole app; pages drive it via $lib/dialog.svelte.js.
     Outside the {#if} so it works before the session has loaded. -->
<Dialog />

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
		/* Was #ccc — 1.61:1 on a card. An input's border is the only thing
		   that says "input", which WCAG 1.4.11 puts at 3:1. Now 3.23 / 3.10. */
		--border-strong: #8f8f8f;
		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #f4ebfa;
		--on-accent: #ffffff;
		--alliance-red: #c0392b;
		--alliance-blue: #2c5cb0;
		/* Ink for text sitting ON an alliance fill. Light mode's alliances are
		   dark, so white reads (5.44 / 6.43). Dark mode lightens them to
		   #f1746a / #6fa8ec, where white collapses to 2.82 / 2.47 — both well
		   under AA. Flipping the ink instead of the fill keeps red red. */
		--on-alliance: #ffffff;
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

		/* App-bar palette. Deliberately NOT redefined in the dark block: the bar
		   is identity, not a surface, and stays team purple in both themes. The
		   status dots sit on that fixed purple, so they are fixed too — a token
		   that flipped with the theme would be wrong against an unflipping
		   background. Named rather than inlined so the set is visible in one
		   place instead of scattered through six rules. */
		--bar-bg: #5f24a2;
		--bar-ink: #ffffff;
		--bar-chip-bg: rgba(255, 255, 255, 0.18);
		--bar-badge-bg: #ffb000;
		--bar-badge-ink: #5f24a2;
		--dot-ok: #4ade80;
		--dot-pending: #facc15;
		--dot-offline: #999999;
		--dot-err: #f87171;
		--dot-idle: rgba(255, 255, 255, 0.35);
		--pending-ink: #442222;
	}
	/* Dark palette — defined ONCE. There used to be a second copy inside an
	   @media (prefers-color-scheme: dark) block, and the two had already
	   drifted: --on-alliance existed in one and not the other, so a scout on
	   OS-level dark got white text on a light-blue pill while a scout who
	   picked dark in Settings got the correct ink. "system" is now resolved to
	   an explicit data-theme in JS (and pre-paint in app.html), which makes
	   one block sufficient. */
	:global(:root[data-theme='dark']) {
		--bg-page: #0e0e10;
		--bg-card: #1a1a1c;
		--bg-subtle: #1f1f22;
		--bg-elev: #232326;
		--text-primary: #e8e8e8;
		--text-muted: #a0a0a3;
		--text-faint: #8a8a8a;
		--border: #2a2a2d;
		--border-strong: #6a6a70; /* was #38383b at 1.49:1; now 3.23 / 3.59 */
		--accent: #b18de0;
		--accent-hover: #c5a8eb;
		--accent-soft: #2a1e3d;
		/* Dark mode lightens the accent, so the ink on top has to darken with
		   it. White was 2.71:1 on --accent and 2.06:1 on --accent-hover — every
		   primary button in the app, unreadable, in the theme people use in a
		   dark gym. #1a1a1c gives 6.42 / 8.42. */
		--on-accent: #1a1a1c;
		--alliance-red: #f1746a;
		--alliance-blue: #6fa8ec;
		--on-alliance: #101014; /* 6.73 on red, 7.67 on blue */
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
	/* ── access gate ────────────────────────────────────────────────────── */
	.gate {
		max-width: 26rem;
		margin: var(--space-6) auto;
		padding: 0 var(--space-4);
		font-family: system-ui, -apple-system, sans-serif;
	}
	.gate h1 { margin: 0 0 var(--space-3); font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.gate p { color: var(--text-muted); line-height: 1.5; margin: 0 0 var(--space-5); }
	.gate-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }
	.gate-link,
	.gate-out {
		font: inherit;
		font-weight: 600;
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-decoration: none;
	}
	.gate-link { background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
	.gate-out {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
	}
	.account-warning {
		max-width: 72rem;
		margin: var(--space-3) auto 0;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		background: var(--warning-bg);
		color: var(--warning);
		font-family: system-ui, -apple-system, sans-serif;
		font-size: var(--fs-sm);
		line-height: 1.45;
	}
	.account-warning a { color: inherit; font-weight: 700; }

	/* Full-screen boot state — a deliberate optical centre, not spacing on the
	   scale, so it is written as a multiple of the largest token. */
	.boot {
		text-align: center;
		margin-top: calc(2 * var(--space-6));
		color: var(--text-faint);
		font-family: system-ui, -apple-system, sans-serif;
	}
	/* The app bar is identity, not navigation — who you are and whether your
	   work is safe. It stays purple in both themes: it's the one surface
	   carrying the team's colour, and a scout glancing down should recognise
	   the app before they read a word of it. */
	.app-bar {
		background: var(--bar-bg);
		color: var(--bar-ink);
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
		background: var(--bar-chip-bg);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.role-badge.manager {
		background: var(--bar-badge-bg);
		color: var(--bar-badge-ink);
		font-weight: 700;
	}

	.sync-dot {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--dot-offline);
	}
	.sync-dot.ok { background: var(--dot-ok); }
	.sync-dot.pending { background: var(--dot-pending); }
	.sync-dot.offline { background: var(--dot-offline); }
	.sync-dot.err { background: var(--dot-err); }
	.sync-dot.idle { background: var(--dot-idle); }
	.pending-count {
		position: absolute;
		transform: translate(0.6rem, -0.4rem);
		background: var(--dot-pending);
		color: var(--pending-ink);
		font-size: var(--fs-xs);
		font-weight: 700;
		padding: 0 var(--space-1);
		border-radius: var(--radius-pill);
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
