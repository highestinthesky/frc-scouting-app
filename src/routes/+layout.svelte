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
	import AppNav from '$lib/components/AppNav.svelte';
	import EventSwitch from '$lib/components/EventSwitch.svelte';
	import { navFor, activeKey } from '$lib/nav-items.js';
	import { eventData } from '$lib/event-data.svelte.js';

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
	 *
	 * Accounts is the one manager page that is about the team rather than an
	 * event, so a manager who has not picked one yet can still hand out invites.
	 * Its own gate still refuses anyone who is not a manager.
	 */
	const NEEDS_NO_EVENT = ['/practice', '/studio/accounts'];
	const needsNoEvent = $derived(NEEDS_NO_EVENT.some((r) => isActive(r)));

	/**
	 * The manager pages still live under /studio/, and that prefix still decides
	 * one thing: the Studio palette (data-studio, below and in app.html).
	 *
	 * It no longer decides the chrome. Studio ran without the app shell from
	 * v0.73 as "a separate application", and scouts never saw it — the button
	 * rendered only for managers — so the split protected nobody while costing
	 * managers an event picker outside their tools and a trip out to record a
	 * match. One shell now, with the navigation chosen by role (nav-items.js).
	 */
	const inStudio = $derived(isActive('/studio'));

	const nav = $derived(navFor({ manager: auth.showsManagerTools }));
	const navKey = $derived(activeKey(page.url.pathname, base));

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

	// A manager's view of the current event, loaded once (event-data.svelte.js).
	// Here rather than in studio/+layout.svelte because Home reads it too: its
	// tiles are a snapshot of the manager pages, so they need the same data the
	// pages show, not a second copy computed differently. Tracked state is read
	// before anything async, or the effect would never re-run.
	$effect(() => {
		const code = session.loaded ? session.eventCode : '';
		const manager = auth.isManager;
		void auth.signedIn;
		if (!manager) return;
		void eventData.load(code);
	});

	// Fresh entries whenever sync brings some in, so coverage is live rather than
	// frozen at page load. Only entries — one local read, where the Supabase half
	// is a handful of network calls.
	$effect(() => {
		syncState.inboundChanges;
		if (!auth.isManager || !session.eventCode) return;
		void eventData.refreshEntries();
	});

	const planningRevision = $derived(syncState.lastSyncedAt ? Math.floor(Date.parse(syncState.lastSyncedAt) / 30_000) : 0);
	$effect(() => {
		void planningRevision;
		if (!auth.isManager || !session.eventCode || !syncState.lastSyncedAt) return;
		void eventData.refreshRoster();
		void eventData.refreshRemote();
		void eventData.refreshSchedule();
	});

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
			You signed in with the temporary password you were given. Whoever set up
			your account knows it, so pick your own before you carry on.
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
			This account isn't part of a team yet. If a manager gave you an invite
			code, finish signing up. If your access was revoked, ask them to invite
			you again.
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
{:else}
	<!-- The app bar is the same for both roles, apart from the event: a manager
	     chooses it here (EventSwitch), a scout sees it as text, exactly as the
	     bar has always shown it. -->
	{#snippet appBar()}
		<header class="app-bar">
			<div class="app-bar-inner">
				{#if shellIdentity.isManager}
					<EventSwitch />
				{/if}
				<!-- Context, not controls: this group is allowed to shrink and truncate.
				     The controls around it are not, because a tap target that shrinks is
				     a tap target that gets missed. -->
				<div class="who">
					{#if session.eventCode && !shellIdentity.isManager}
						<strong class="event">{session.eventCode}</strong>
						<span class="sep">·</span>
					{/if}
					<span class="name">{shellIdentity.name}</span>
				</div>
				<SyncPanel />
			</div>
		</header>
	{/snippet}

	{#snippet accountWarning()}
		{#if !AUTH_ENFORCED && auth.orphaned}
			<div class="account-warning" role="status">
				<strong>Account setup is incomplete.</strong>
				Legacy event-code access still works on this release, but this account will not work after
				cutover until you <a href="{base}/register/">redeem an invite</a>.
			</div>
		{/if}
	{/snippet}

	{#if shellIdentity.isManager}
		<!-- A manager's shell: bar on top, then the nav and the page. From 48rem the
		     nav is a sidebar beside the page; below that it is a strip (tablet) or a
		     docked bar (phone), and this grid is a plain stack. -->
		<div class="shell manager-shell">
			{@render appBar()}
			<div class="nav-cell">
				<AppNav items={nav} current={navKey} manager />
			</div>
			<div class="content">
				{@render accountWarning()}
				<!-- Not over the manager pages, as it never was over Studio: a reminder
				     is addressed to someone scouting, and on Run it lands on top of the
				     list the manager is working through. Home still shows them. -->
				{#if !inStudio}
					<ReminderFlyby />
				{/if}
				{@render children()}
			</div>
		</div>
	{:else}
		{@render appBar()}
		<!-- Bottom-docked on phones, top strip from 40rem up. See design.md
		     § Three deviations — a scout holds this one-handed. Two tabs: Scouting
		     was the third and folded into Home in v0.82. -->
		<AppNav items={nav} current={navKey} manager={false} />
		{@render accountWarning()}
		<ReminderFlyby />
		{@render children()}
	{/if}
{/if}

<!-- One instance for the whole app; pages drive it via $lib/dialog.svelte.js.
     Outside the {#if} so it works before the session has loaded. -->
<Dialog />

<style>

	/* ── Theme variables ───────────────────────────────────────────────
	   Light is the default. Dark applies whenever the OS prefers dark
	   *unless* the user explicitly chose light, OR whenever the user
	   explicitly chose dark via Settings → data-theme="dark".

	   Components consume these vars instead of hardcoding hex values. The
	   team-purple header stays fixed; lavender surfaces have light and dark values. */
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
		--bg-page: #f7f2fc;
		--nav-bg: #efe4f8;
		--bg-card: #ffffff;
		--bg-subtle: #f0e7f8;
		--bg-elev: #f5eefb;
		--text-primary: #2b1f36;
		--text-muted: #62526f;
		--text-faint: #74637e;
		--border: #e0d3eb;

		--border-strong: #95809f;
		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #eadbf6;
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

		--bar-bg: #5f24a2;
		--bar-ink: #ffffff;
		--bar-chip-bg: #6b32ab;

		--bar-edge: #c5a8e5;
		--bar-badge-bg: #eadbf6;
		--bar-badge-ink: #5f24a2;
		--dot-ok: #4ade80;
		--dot-pending: #facc15;
		--dot-offline: #a9a9ae;
		--dot-err: #ff9188;
		--dot-idle: #c5a8e5;
		--pending-ink: #442222;
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
		--bg-page: #1b1424;
		--nav-bg: #281d36;
		--bg-card: #241b2f;
		--bg-subtle: #30253e;
		--bg-elev: #382b47;
		--text-primary: #f4edf9;
		--text-muted: #c5b7d2;
		--text-faint: #b2a0c1;
		--border: #4c395e;
		--border-strong: #947ea5;
		--accent: #c6a1ed;
		--accent-hover: #d8b9f6;
		--accent-soft: #3d2955;

		--on-accent: #241b2f;
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
		--banner-info-bg: #3d2955;
		--banner-info-border: #4d415e;
		--banner-red-bg: #3a1a18;
		--banner-red-border: #5a2a22;
		--banner-blue-bg: #16233a;
		--banner-blue-border: #2c4a7a;
		--bar-bg: #5f24a2;
		--bar-ink: #ffffff;
		--bar-chip-bg: #6b32ab;
		--bar-edge: #c5a8e5;
		--bar-badge-bg: #3d2955;
		--bar-badge-ink: #c6a1ed;
		--dot-ok: #4ade80;
		--dot-pending: #facc15;
		--dot-offline: #a9a9ae;
		--dot-err: #ff9188;
		--dot-idle: #c5a8e5;
		--pending-ink: #442222;
		--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
		--shadow-md: 0 12px 36px rgba(0, 0, 0, 0.35);
	}

	/* Studio shares the team-purple header and tinted canvas. Chart series retain
	   separate semantic colors; navigation does not borrow their palette. */
	:global(:root[data-studio]) {
		--studio-purple: #5f24a2;
		--studio-blue: #0087f8;
		--studio-cyan: #00c7fa;
		--studio-aqua: #49fce2;

		--studio-violet: #5f24a2;

		--bg-page: #f7f2fc;
		--bg-card: #ffffff;
		--bg-subtle: #f0e7f8;

		--bg-elev: #f5eefb;

		--text-primary: #2b1f36;
		--text-muted: #62526f;
		--text-faint: #74637e;

		--border: #e0d3eb;

		--border-strong: #95809f;

		--accent: #5f24a2;
		--accent-hover: #4e1c87;
		--accent-soft: #eadbf6;
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

		--studio-violet: #c6a1ed;

		--bg-page: #1b1424;
		--bg-card: #241b2f;
		--bg-subtle: #30253e;
		--bg-elev: #382b47;

		--text-primary: #f4edf9;
		--text-muted: #c5b7d2;
		--text-faint: #b2a0c1;

		--border: #4c395e;

		--border-strong: #947ea5;

		--accent: #c6a1ed;
		--accent-hover: #d8b9f6;
		--accent-soft: #3d2955;
		--on-accent: #241b2f;

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
		--banner-info-bg: #3d2955;
		--banner-info-border: #4d415e;
		--banner-red-bg: #33141a;
		--banner-red-border: #5e2a2a;
		--banner-blue-bg: #141d38;
		--banner-blue-border: #2c4472;

		--studio-series-1: #c6a1ed;
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
		padding: var(--space-2) max(var(--space-5), env(safe-area-inset-right, 0px)) var(--space-2) max(var(--space-5), env(safe-area-inset-left, 0px));
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
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
	}
	.sep { opacity: 0.6; }
	.name { opacity: 0.95; }
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
	.app-bar-inner { gap: var(--space-3); }
	.who { font-size: var(--fs-sm); }
	.event { letter-spacing: 0; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	@media (max-width: 47.9375rem) {
		.app-bar { padding-left: max(var(--space-4), env(safe-area-inset-left, 0px)); padding-right: max(var(--space-4), env(safe-area-inset-right, 0px)); }
	}
	@media (max-width: 22rem) {
		.app-bar-inner { gap: var(--space-2); }
		.who .name, .who .sep { display: none; }
	}
	.content {
		min-width: 0;
	}
	@media (min-width: 48rem) {
		.shell {
			display: grid;
			grid-template-columns: 15rem minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
			grid-template-areas:
				'bar bar'
				'nav content';
			min-height: 100dvh;
		}
		.shell .app-bar {
			grid-area: bar;
		}
		.nav-cell {
			grid-area: nav;
		}
		.content {
			grid-area: content;
		}
	}
</style>
