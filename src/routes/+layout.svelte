<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import {
		syncState,
		init as syncInit,
		setEventCode as syncSetEventCode
	} from '$lib/sync.svelte.js';
	import { reminders } from '$lib/reminders.svelte.js';
	import { auth, AUTH_ENFORCED } from '$lib/auth.svelte.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';
	import ScoutEventPrompt from '$lib/components/ScoutEventPrompt.svelte';
	import ReminderFlyby from '$lib/components/ReminderFlyby.svelte';
	import SyncPanel from '$lib/components/SyncPanel.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Button from '$lib/components/Button.svelte';

	let { children } = $props();

	// Forced password change. Handed-over passwords are known to the manager who
	// handed them over, so the app is unusable until one is replaced. Gated in
	// the layout rather than nudged on a page, because a nudge is declinable and
	// this is the whole point of the temporary password being temporary.
	let newPw = $state('');
	let newPw2 = $state('');
	let pwBusy = $state(false);
	let pwErr = $state('');

	async function choosePassword(e) {
		e.preventDefault();
		pwErr = '';
		if (newPw.length < 8) {
			pwErr = 'Use a password with at least 8 characters.';
			return;
		}
		if (newPw !== newPw2) {
			pwErr = 'Those two do not match.';
			return;
		}
		pwBusy = true;
		try {
			await auth.setOwnPassword(newPw);
			newPw = '';
			newPw2 = '';
		} catch (error) {
			pwErr = error?.message ?? String(error);
		} finally {
			pwBusy = false;
		}
	}

	onMount(async () => {
		await Promise.all([session.load(), theme.load(), auth.init()]);
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
	// Login is the landing page now, so '/' itself is public and renders without
	// the app chrome. Home moved to /home.
	const PUBLIC_ROUTES = ['/', '/register'];
	const onLoginRoute = $derived(isActive('/'));
	const onRegisterRoute = $derived(isActive('/register'));
	const onPublicRoute = $derived(PUBLIC_ROUTES.some((r) => isActive(r)));

	/**
	 * Routes that are about the device, not an event.
	 *
	 * Practice exists to be used BEFORE kickoff, when no scout is on any event and
	 * the device has nothing to set up yet. Behind the session-setup gate it would
	 * be unreachable for exactly the people it is for. Only that gate is lifted:
	 * the sign-in guard above still applies, and so does every account state
	 * below it (password change, orphaned). A signed-out device never gets here.
	 */
	const NEEDS_NO_EVENT = ['/practice'];
	const needsNoEvent = $derived(NEEDS_NO_EVENT.some((r) => isActive(r)));

	/**
	 * Studio runs without the app shell.
	 *
	 * It is a separate application that happens to share a deployment, and the
	 * global tab bar was a trapdoor out of it: one tap dropped you into Home with
	 * nothing offering a way back. A surface with its own navigation does not want
	 * a second navigation arguing with it.
	 *
	 * The shell is hidden rather than the route being moved out, because a second
	 * deployment would need its own auth — "signed into the scouting app but not
	 * the studio" is not a problem to have at a competition. Studio's own sidebar
	 * carries the way out.
	 */
	const inStudio = $derived(isActive('/studio'));

	$effect(() => {
		if (auth.loading || !session.loaded) return;
		// A signed-in user never needs /login. A complete account never needs
		// /register either, but an orphaned auth user MUST be allowed to stay
		// there and retry the invite redemption that failed after signUp().
		if (auth.signedIn && (onLoginRoute || (onRegisterRoute && !auth.orphaned))) {
			// Home, not /scouting. Signing in and landing on a list of what you have
			// already recorded answers a question nobody asked; Home answers "am I
			// up, and has anyone told me anything".
			goto(`${base}/home/`, { replaceState: true });
			return;
		}
		// Signed out: the login screen is where you land. A device that has never
		// signed in gets sent there from anywhere else, so the account is the
		// first thing anyone sees rather than a thing they have to go looking for
		// in Settings.
		//
		// It is a nudge, not a lock, and the difference is the whole invariant:
		// recording never depends on auth. A scout who cannot sign in at the
		// venue — forgotten password, no signal, a phone that never registered —
		// must still be able to record. "Log in later" on that screen sets
		// loginDeferred and they are not asked again.
		//
		// AUTH_ENFORCED ignores the deferral entirely. After the cutover there is
		// no offline path left to defer to, so the escape hatch stops working
		// rather than needing to be found and cleared on every device.
		if (!auth.signedIn && !onPublicRoute && (AUTH_ENFORCED || !session.loginDeferred)) {
			goto(`${base}/`, { replaceState: true });
		}
	});

	// The account is the only identity and role source. This used to be a
	// two-branch derivation keyed on AUTH_ENFORCED, kept so the badge and the
	// manager navigation could not disagree during a half-cutover. There is no
	// half any more: the passphrase is gone and role rides the profile.
	const shellIdentity = $derived.by(() => ({
		name: auth.displayName || auth.profile?.username || '',
		role: auth.role ?? 'scout',
		isManager: auth.isManager
	}));

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

	// Studio's palette is scoped to a data-studio attribute on the document root,
	// not to a class on Studio's own wrapper, and the reason is `body`: its
	// background comes from `:global(body) { background: var(--bg-page) }`, which
	// resolves at `body` — outside anything Studio renders. Scoped to the wrapper,
	// the page would have carried a dark panel on a light overscroll edge.
	//
	// app.html sets the same attribute before first paint, so a hard load of
	// /studio does not flash the scout palette. This effect is what keeps it
	// correct across client-side navigation, which the pre-paint script never sees.
	$effect(() => {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		if (inStudio) root.setAttribute('data-studio', '');
		else root.removeAttribute('data-studio');
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

	// The sync dot's colour/tooltip derivation lived here and is gone with it.
	// Two reasons, and the second is the bug: a `title` needs a mouse to hover, so
	// on a phone it communicated nothing — and the derivation never read
	// syncState.reason, so a signed-out scout was told "No event code — set one in
	// Settings" about an event they had already chosen. SyncPanel says the true
	// thing, in words, and is tappable.
</script>

{#if !session.loaded || auth.loading}
	<p class="boot">Loading…</p>
{:else if onPublicRoute}
	{@render children()}
{:else if auth.mustChangePassword}
	<!-- Signed in, but on a password somebody else chose and still knows. -->
	<main class="gate">
		<h1>Choose a password</h1>
		<p>
			Replace your temporary password before continuing.
		</p>
		<form class="pw-form" onsubmit={choosePassword}>
			<label class="field">
				<span class="label">New password</span>
				<small class="help">At least 8 characters.</small>
				<input type="password" bind:value={newPw} autocomplete="new-password" required />
			</label>
			<label class="field">
				<span class="label">Again</span>
				<input type="password" bind:value={newPw2} autocomplete="new-password" required />
			</label>
			{#if pwErr}<p class="pw-err" role="alert">{pwErr}</p>{/if}
			<Button variant="primary" type="submit" full disabled={pwBusy}>
				{pwBusy ? 'Saving…' : 'Save password'}
			</Button>
		</form>
	</main>
{:else if AUTH_ENFORCED && auth.orphaned}
	<!-- Signed in, but no profile: the invite was never redeemed, or a manager
	     revoked access. Say so plainly rather than showing an empty app. -->
	<main class="gate">
		<h1>No access</h1>
		<p>
			Enter an invite code from your manager to restore access.
		</p>
		<div class="gate-actions">
			<a class="gate-link" href="{base}/register/">Enter an invite code</a>
			<button type="button" class="gate-out" onclick={() => auth.signOut()}>Sign out</button>
		</div>
	</main>
{:else if auth.signedIn && auth.role === 'scout' && !needsNoEvent && (!session.eventCode || syncState.reason === 'no-such-event')}
	<ScoutEventPrompt />
{:else if !session.isConfigured && !(needsNoEvent && auth.signedIn)}
	<SessionSetup />
{:else if inStudio}
	<!-- No app bar, no tab bar, no reminder banner. Studio owns its whole
	     viewport and supplies its own chrome and its own exit. -->
	{@render children()}
{:else}
	<div class="app-chrome"><div class="app-shell">
	<header class="app-bar">
		<div class="app-bar-inner">
			<!-- Context, not controls: this group is allowed to shrink and truncate.
			     The controls after it are not, because a tap target that shrinks is a
			     tap target that gets missed. -->
			<div class="who">
				{#if session.eventCode}
					<strong class="event">{session.eventCode}</strong>
					<span class="sep">·</span>
				{/if}
				<span class="name">{shellIdentity.name}</span>
			</div>
			<SyncPanel />
			{#if shellIdentity.isManager}
				<!-- Same window, not target=_blank. From an iOS home-screen install a
				     new tab opens in an in-app Safari sheet whose storage is not the
				     app's, so the manager arrived in Studio signed out; a native
				     webview has no tabs at all and hands the link to Safari, with the
				     same result. The new tab used to be the way back, and "Leave
				     Studio" in Studio's own rail is that way now. -->
				<a class="studio-btn" href="{base}/studio/">Studio</a>
			{/if}
		</div>
	</header>

	<!-- Bottom-docked on phones, top strip from 40rem up. See design.md
	     § Three deviations — a scout holds this one-handed. -->
	<!-- Two tabs. Studio is not a peer of these — it is a different application,
	     so it is a button in the bar above rather than a tab here.
	     Scouting was the third and is gone: it answered "what have I recorded",
	     which turned out to be one section of Home rather than a place. Three of
	     the five things it showed were already on Home, and a tab whose page is
	     mostly another tab's page is a tab that makes a scout check both. -->
	<nav class="tabs" aria-label="Main">
		<a href="{base}/home/" class:active={isActive('/home')} aria-current={isActive('/home') ? 'page' : undefined}>
			Home
		</a>
		<a href="{base}/settings/" class:active={isActive('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
			Settings
		</a>
	</nav>
	</div></div>

	{#if !AUTH_ENFORCED && auth.orphaned}
		<div class="account-warning" role="status">
			<strong>Account setup is incomplete.</strong>
			Legacy event-code access still works on this release, but this account will not work after
			cutover until you <a href="{base}/register/">redeem an invite</a>.
		</div>
	{/if}

	<ReminderFlyby />

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
	 *             brand purple retained as a restrained accent
	 * pre-emit critique: P5 H5 E5 S5 R5 V4
	 * contrast: AA pass · four palettes · 190 automated assertions
	 */

	/* ── Theme variables ───────────────────────────────────────────────
	   Light is the default. Dark applies whenever the OS prefers dark
	   *unless* the user explicitly chose light, OR whenever the user
	   explicitly chose dark via Settings → data-theme="dark".

	   Components consume these vars instead of hardcoding hex values. The
	   purple accent and neutral surfaces each have a light and dark value. */
	/* ─── the focus ring, once, for everything ──────────────────────────────
	 *
	 * Eight component files had interactive elements and no :focus-visible at
	 * all, so a keyboard user tabbed through them with nothing to see. Adding a
	 * rule to each is how they drift: the next component is written without one
	 * and nobody notices, because the failure is invisible to a mouse.
	 *
	 * Wrapped in :where() so it has ZERO specificity. Any component that wants a
	 * different ring — Button, Select, SyncPanel, the reminder cards — overrides
	 * it simply by having a rule at all, which is what they already do.
	 *
	 * :focus-visible, not :focus, so a mouse click does not draw it. Never
	 * animated: the ring has to appear the instant focus lands, and a transition
	 * on it reads as lag on the one affordance that must not feel laggy.
	 */
	:global(:where(a, button, summary, input, select, textarea, [tabindex]):focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	/* ─── the box model ────────────────────────────────────────────────────────
	 *
	 * The app ran on the default content-box until v0.75, and the cost was not
	 * theoretical: a <button> and an <a> with the SAME class rendered at
	 * different heights, because the UA stylesheet gives form controls
	 * border-box and leaves everything else content-box.
	 *
	 * Measured on /studio/insights, in one toolbar, side by side:
	 *
	 *     Compare      <a class="btn">        62px
	 *     Picklist     <a class="btn">        62px
	 *     Export CSV   <button class="btn">   44px
	 *
	 * Same rule, same tokens — min-height: var(--tap-min) plus padding — and an
	 * 18px difference nobody wrote. Button's href prop promises that the element
	 * changes and the styling does not, and that promise was not keepable while
	 * the two elements measured their own size differently.
	 *
	 * :where() so it has ZERO specificity and any component that genuinely needs
	 * content-box can say so without fighting it. Applied to ::before/::after too,
	 * because a pseudo-element inherits nothing here.
	 */
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		color-scheme: light;
		--bg-page: #f6f5f2;
		--bg-card: #ffffff;
		--bg-subtle: #eeede9;
		--bg-elev: #f0efec;
		--text-primary: #252525;
		--text-muted: #595750;
		--text-faint: #6b6862;
		--border: #dedcd6;

		--border-strong: #8a877f;
		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #f1ebf7;
		--on-accent: #ffffff;
		--alliance-red: #c0392b;
		--alliance-blue: #2c5cb0;

		--on-alliance: #ffffff;
		--danger: #c0392b;
		--danger-bg: #fdecea;
		--success: #047857;
		--success-bg: #ecfdf5;
		--success-border: #6ee7b7;
		--warning: #92400e;
		--warning-bg: #fffbeb;
		--warning-border: #fcd34d;
		--banner-info-bg: #f1edf5;
		--banner-info-border: #ded4e9;
		--banner-red-bg: #fef2f2;
		--banner-red-border: #fca5a5;
		--banner-blue-bg: #eff6ff;
		--banner-blue-border: #93c5fd;

		--space-1: 0.25rem;
		--space-2: 0.5rem;
		--space-3: 0.75rem;
		--space-4: 1rem;
		--space-5: 1.5rem;
		--space-6: 2rem;
		--radius-sm: 0.25rem;
		--radius-md: 0.375rem;
		--radius-lg: 0.5rem;
		--radius-pill: 999px;
		--fs-xs: 0.75rem;
		--fs-sm: 0.875rem;
		--fs-md: 0.9375rem;
		--fs-lg: 1.125rem;
		--fs-xl: 1.625rem;

		--fs-control: 1rem;

		--fs-display: clamp(1.875rem, 4.5vw, 2.5rem);
		--shadow-sm: 0 1px 3px rgba(37, 37, 37, 0.04);
		--shadow-md: 0 12px 36px rgba(37, 37, 37, 0.12);
		--overlay-scrim: rgba(0, 0, 0, 0.5);

		--tap-min: 2.75rem;
		--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
		--dur-short: 150ms;

		--nav-bottom-h: calc(3.25rem + env(safe-area-inset-bottom, 0px));

		--app-bar-h: calc(2.75rem + var(--space-2) * 2 + env(safe-area-inset-top, 0px));

		--safe-top: env(safe-area-inset-top, 0px);

		--w-form: 34rem;
		--w-read: 42rem;
		--w-list: 60rem;
		--w-board: 78rem;

		--bar-bg: #ffffff;
		--bar-ink: #252525;
		--bar-chip-bg: #eeede9;

		--bar-edge: #8a877f;
		--bar-badge-bg: #f1ebf7;
		--bar-badge-ink: #5f24a2;
		--dot-ok: #047857;
		--dot-pending: #a16207;
		--dot-offline: #6b6862;
		--dot-err: #c0392b;
		--dot-idle: #8a877f;
		--pending-ink: #ffffff;
		--font-body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		--font-display: var(--font-body);
		--font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
		--fs-page: clamp(1.625rem, 3vw, 2rem);
		--space-7: 3rem;
		--space-8: 4rem;
	}
	/* Dark palette — defined ONCE. There used to be a second copy inside an
	   @media (prefers-color-scheme: dark) block, and the two had already
	   drifted: --on-alliance existed in one and not the other, so a scout on
	   OS-level dark got white text on a light-blue pill while a scout who
	   picked dark in Settings got the correct ink. "system" is now resolved to
	   an explicit data-theme in JS (and pre-paint in app.html), which makes
	   one block sufficient. */
	:global(:root[data-theme='dark']) {
		color-scheme: dark;
		--bg-page: #151517;
		--bg-card: #1d1d20;
		--bg-subtle: #27272a;
		--bg-elev: #29292d;
		--text-primary: #f0eeea;
		--text-muted: #bbb8b2;
		--text-faint: #a09d98;
		--border: #38383c;
		--border-strong: #7f7d84;
		--accent: #bba1e1;
		--accent-hover: #cdb8eb;
		--accent-soft: #30283c;

		--on-accent: #1d1d20;
		--alliance-red: #f1746a;
		--alliance-blue: #6fa8ec;
		--on-alliance: #101014;
		--danger: #f7857a;
		--danger-bg: #3a1a18;
		--success: #6ee7b7;
		--success-bg: #0f2a23;
		--success-border: #1d5a45;
		--warning: #fcd34d;
		--warning-bg: #2a200a;
		--warning-border: #5a4318;
		--banner-info-bg: #30283c;
		--banner-info-border: #4d415e;
		--banner-red-bg: #3a1a18;
		--banner-red-border: #5a2a22;
		--banner-blue-bg: #16233a;
		--banner-blue-border: #2c4a7a;
		--bar-bg: #1d1d20;
		--bar-ink: #f0eeea;
		--bar-chip-bg: #27272a;
		--bar-edge: #7f7d84;
		--bar-badge-bg: #30283c;
		--bar-badge-ink: #bba1e1;
		--dot-ok: #6ee7b7;
		--dot-pending: #facc15;
		--dot-offline: #999999;
		--dot-err: #f87171;
		--dot-idle: #a09d98;
		--pending-ink: #442222;
		--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
		--shadow-md: 0 12px 36px rgba(0, 0, 0, 0.35);
	}

	/* Studio shares the neutral canvas and purple accent. Chart series retain
	   separate semantic colors; navigation does not borrow their palette. */
	:global(:root[data-studio]) {
		--studio-purple: #5f24a2;
		--studio-blue: #0087f8;
		--studio-cyan: #00c7fa;
		--studio-aqua: #49fce2;

		--studio-violet: #5f24a2;

		--bg-page: #f6f5f2;
		--bg-card: #ffffff;
		--bg-subtle: #eeede9;

		--bg-elev: #f0efec;

		--text-primary: #252525;
		--text-muted: #595750;
		--text-faint: #6b6862;

		--border: #dedcd6;

		--border-strong: #8a877f;

		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #f1ebf7;
		--on-accent: #ffffff;

		--alliance-red: #b3261e;
		--alliance-blue: #1f4f9c;
		--on-alliance: #ffffff;

		--danger: #b3261e;
		--danger-bg: #fdecea;
		--success: #0f6d4f;
		--success-bg: #e6f5ef;
		--success-border: #9ad3ba;
		--warning: #8a5a00;
		--warning-bg: #fdf4e3;
		--warning-border: #e6c489;
		--banner-info-bg: #f1edf5;
		--banner-info-border: #ded4e9;
		--banner-red-bg: #fdecea;
		--banner-red-border: #f0b3ae;
		--banner-blue-bg: #e8f0fc;
		--banner-blue-border: #a8c4e8;

		--studio-fill: #5f24a2;
		--on-studio-fill: #ffffff;

		--studio-series-1: #662db4;
		--studio-series-2: #0064bd;
		--studio-series-3: #026b88;
		--studio-series-4: #016b5c;

		--shadow-sm: 0 1px 3px rgba(37, 37, 37, 0.04);
		--shadow-md: 0 12px 36px rgba(37, 37, 37, 0.12);
	}

	:global(:root[data-studio][data-theme='dark']) {
		--on-studio-fill: #ffffff;

		--studio-purple: #662db4;
		--studio-blue: #0087f8;
		--studio-cyan: #00c7fa;
		--studio-aqua: #49fce2;

		--studio-violet: #bba1e1;

		--bg-page: #151517;
		--bg-card: #1d1d20;
		--bg-subtle: #27272a;
		--bg-elev: #29292d;

		--text-primary: #f0eeea;
		--text-muted: #bbb8b2;
		--text-faint: #a09d98;

		--border: #38383c;

		--border-strong: #7f7d84;

		--accent: #bba1e1;
		--accent-hover: #cdb8eb;
		--accent-soft: #30283c;
		--on-accent: #1d1d20;

		--alliance-red: #ff8078;
		--alliance-blue: #7db2f2;
		--on-alliance: #0a0912;

		--danger: #ff8f84;
		--danger-bg: #33141a;
		--success: #5fe3b4;
		--success-bg: #0d2b2c;
		--success-border: #1e5a4e;
		--warning: #fbc94a;
		--warning-bg: #2e2413;
		--warning-border: #5c4a1c;
		--banner-info-bg: #30283c;
		--banner-info-border: #4d415e;
		--banner-red-bg: #33141a;
		--banner-red-border: #5e2a2a;
		--banner-blue-bg: #141d38;
		--banner-blue-border: #2c4472;

		--studio-series-1: #bba1e1;
		--studio-series-2: #8cb7e5;
		--studio-series-3: #8dc9b6;
		--studio-series-4: #d0b797;

		--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
		--shadow-md: 0 12px 36px rgba(0, 0, 0, 0.35);
		--studio-fill: #5f24a2;
	}

	:global(body) {
		margin: 0;
		background: var(--bg-page);
		color: var(--text-primary);
		/* Declared ONCE, here, because it was declared eighteen times and three
		   pages still missed it: /studio/event, /studio/coverage and
		   /studio/insights rendered entirely in Times, in production. Every copy
		   sat on a page's own `main`, so the app looked right everywhere anyone
		   had remembered — and a Studio page that never grew a `main` rule had no
		   font at all. Inherited from body, a page cannot forget it. */
		font-family: var(--font-body);
		font-size: var(--fs-md);
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}
	:global(input), :global(textarea), :global(select) {
		color: var(--text-primary);
		background: var(--bg-card);
	}
	/* ── access gate ────────────────────────────────────────────────────── */
	.gate {
		max-width: 26rem;
		margin: calc(var(--space-6) + var(--safe-top)) auto var(--space-6);
		padding: 0 var(--space-4);
	}
	.gate h1 { margin: 0 0 var(--space-3); font-size: var(--fs-page); letter-spacing: -0.02em; }
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
		font-size: var(--fs-sm);
		line-height: 1.45;
	}
	.account-warning a { color: inherit; font-weight: 700; }

	/* Full-screen boot state — a deliberate optical centre, not spacing on the
	   scale, so it is written as a multiple of the largest token. */
	.pw-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 22rem;
		margin: var(--space-5) auto 0;
		text-align: left;
	}
	.pw-form .field { display: flex; flex-direction: column; gap: var(--space-1); }
	.pw-form .label { font-weight: 600; }
	.pw-form .help { color: var(--text-faint); font-size: var(--fs-sm); }
	.pw-form input {
		font: inherit;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.pw-err { color: var(--danger); font-size: var(--fs-sm); margin: 0; }
	.boot {
		text-align: center;
		margin-top: calc(2 * var(--space-6) + var(--safe-top));
		color: var(--text-faint);
	}

	.app-bar {
		background: var(--bar-bg);
		color: var(--bar-ink);
		padding: var(--space-2) var(--space-4);
		padding-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
	}
	.app-bar-inner {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-md);
		/* Without this a flex item refuses to shrink below its content, which is
		   what pushed the bar 37px past a 412px viewport and scrolled the whole
		   page sideways. Same failure as the bare `1fr` grid tracks. */
		min-width: 0;
	}

	/* The identity group absorbs the squeeze. It truncates; the controls do not. */
	.who {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		overflow: hidden;
		white-space: nowrap;
	}
	.who .name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.event {
		flex: none;
	}
	.event {
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}
	.sep { opacity: 0.6; }
	.name { opacity: 0.95; }
	/* Visually hidden, still announced. The pop-out glyph is aria-hidden, so
	   without this a screen reader gets no warning that the link leaves the app. */
	/* Below this the bar is carrying an event, a name, sync state and a way into
	   Studio. The badge is the only one of those that is purely decorative. */

	/* The one ACTION in the bar, and it has to look like one.
	   It was a translucent pill in --bar-chip-bg that turned YELLOW on hover —
	   the exact colour of the MANAGER badge sitting beside it. So the bar carried
	   two lozenges of similar weight, one a label and one a link, and hovering
	   the link made it look like the label. Outlined instead: a button reads as a
	   button, the badge stays the only filled thing, and hover fills with the
	   bar's own ink rather than borrowing another element's colour. */
	.studio-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap-min);
		padding: var(--space-1) var(--space-3);
		margin-left: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--bar-edge);
		background: transparent;
		color: var(--bar-ink);
		font-size: var(--fs-sm);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		transition:
			background-color var(--dur-short) var(--ease-out),
			color var(--dur-short) var(--ease-out);
	}
	.studio-btn:hover {
		background: var(--bar-ink);
		color: var(--bar-bg);
		border-color: var(--bar-ink);
	}
	@media (prefers-reduced-motion: reduce) {
		.studio-btn {
			transition-duration: 0.01ms;
		}
	}
	.studio-btn:focus-visible {
		outline: 2px solid var(--bar-ink);
		outline-offset: 2px;
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
	:global(html), :global(body) { overflow-x: clip; }
	:global(h1), :global(h2), :global(h3) {
		font-style: normal;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(input:not([type='range']):not([type='checkbox']):not([type='radio'])),
	:global(textarea), :global(select) {
		font: inherit;
		font-size: var(--fs-control);
		max-width: 100%;
	}
	:global(button), :global(a) { -webkit-tap-highlight-color: transparent; }
	:global(code), :global(pre) { font-family: var(--font-mono); }
	.app-chrome { background: var(--bg-card); border-bottom: 1px solid var(--border); }
	.app-shell { width: 100%; }
	.app-bar-inner { gap: var(--space-3); }
	.who { font-size: var(--fs-sm); }
	.event { letter-spacing: 0; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.studio-btn { margin-left: 0; }
	.tabs a { white-space: nowrap; }
	.tabs a.active { background: var(--bg-card); }
	@media (min-width: 40rem) {
		.app-shell { display: flex; align-items: center; padding: 0 max(var(--space-6), env(safe-area-inset-right, 0px)) 0 max(var(--space-6), env(safe-area-inset-left, 0px)); }
		.app-bar { flex: 1; padding-left: 0; padding-right: var(--space-4); min-width: 0; }
		.tabs { align-self: stretch; border-bottom: none; padding: 0; gap: var(--space-1); }
		.tabs a { padding: var(--space-2) var(--space-3); }
	}
	@media (max-width: 22rem) {
		.app-bar-inner { gap: var(--space-2); }
		.who .name, .who .sep { display: none; }
	}

</style>
