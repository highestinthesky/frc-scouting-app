<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
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
			goto(`${base}/scouting/`, { replaceState: true });
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

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

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
{:else if !session.isConfigured}
	<SessionSetup />
{:else if inStudio}
	<!-- No app bar, no tab bar, no reminder banner. Studio owns its whole
	     viewport and supplies its own chrome and its own exit. -->
	{@render children()}
{:else}
	<header class="app-bar">
		<div class="app-bar-inner">
			<!-- Context, not controls: this group is allowed to shrink and truncate.
			     The controls after it are not, because a tap target that shrinks is a
			     tap target that gets missed. -->
			<div class="who">
				<strong class="event">{session.eventCode}</strong>
				<span class="sep">·</span>
				<span class="name">{shellIdentity.name}</span>
			</div>
			<SyncPanel />
			<!-- Hidden on narrow screens. On a phone the Studio button already says
			     "manager" more usefully than a badge does, and at 375px the bar was
			     overflowing the viewport by 37px with this in it. -->
			<span class="role-badge" class:manager={shellIdentity.isManager}>
				{shellIdentity.role}
			</span>
			{#if shellIdentity.isManager}
				<!-- Opens in its own tab, so it carries a pop-out mark. The mark is not
				     decoration: a link that replaces the page and a link that opens a
				     new one should not look identical, and this one takes you out of
				     the app you are standing in. rel=noopener because target=_blank
				     otherwise hands the new tab a reference back to this window. -->
				<a
					class="studio-btn"
					href="{base}/studio/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Studio
					<svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
						<path d="M4.5 1.5h6v6M10.5 1.5 5 7M8 9.5v1h-6.5V4h1"
							stroke="currentColor" stroke-width="1.4"
							stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span class="sr-only">(opens in a new tab)</span>
				</a>
			{/if}
		</div>
	</header>

	<!-- Bottom-docked on phones, top strip from 40rem up. See design.md
	     § Three deviations — a scout holds this one-handed. -->
	<!-- Two tabs, not four. This app records matches; running an event is Studio's
	     job and Studio is not a peer of these — it is a different application, so
	     it is a button in the bar above rather than a tab down here. -->
	<nav class="tabs" aria-label="Main">
		<a href="{base}/scouting/" class:active={isActive('/scouting')} aria-current={isActive('/scouting') ? 'page' : undefined}>
			Scouting
		</a>
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
		/* The app bar's height, exposed the same way the bottom bar's is, so
		   anything positioned against the top of the viewport can clear it instead
		   of guessing. The reminder popup landed 12px under the bar because it
		   guessed. Tracks the bar's own padding + line-height, plus the notch. */
		--app-bar-h: calc(2.75rem + var(--space-2) * 2 + env(safe-area-inset-top, 0px));

		/* ─── how wide content is allowed to get ────────────────────────────────
		 *
		 * Every page picked its own number before this — 38rem here, 32rem there,
		 * 42rem in the bar — so a 1280px screen showed a 672px column with a third
		 * of the window empty, and no two surfaces agreed on why.
		 *
		 * Width is a decision about the CONTENT, not the device. A form stays
		 * narrow because line length is readability and a 900px-wide text input is
		 * harder to use, not easier. A list of cards or a table goes wide because
		 * density is the whole point — a manager comparing teams wants more rows
		 * visible, not more whitespace.
		 *
		 * Breakpoints stay literal in @media because custom properties cannot be
		 * used there. The scale is 30rem / 40rem / 64rem — phone, tablet, desktop —
		 * and it replaces the four ad-hoc values that were in use (28rem, 40rem,
		 * 47.9375rem, 600px).
		 */
		--w-form: 34rem;   /* one column of fields */
		--w-read: 42rem;   /* prose, settings, anything mostly sentences */
		--w-list: 60rem;   /* cards and entry lists */
		--w-board: 78rem;  /* tables, coverage grids, anything dense */

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

	/* ─── Studio ───────────────────────────────────────────────────────────────
	 *
	 * A second palette on one system, not a second design system. Spacing, type,
	 * radii and motion still come from the block above and design.md still governs
	 * them; only colour changes here.
	 *
	 * MUST STAY AFTER THE DARK BLOCK. `:root[data-theme='dark']` and
	 * `:root[data-studio]` are both (0,2,0), so source order is the only thing
	 * deciding which wins on a dark-themed Studio. check_contrast.mjs asserts the
	 * ordering, because nothing else would notice it being moved.
	 *
	 * ── why dark, in both themes ──
	 *
	 * Studio is dark whatever the app theme says, the same way the app bar stays
	 * purple in both. It is a laptop-at-a-table surface read under competition
	 * lighting, and the palette only works on a dark ground:
	 *
	 *     #662DB4  purple  8.08 on white   ← the only one that can carry white text
	 *     #0087F8  blue    3.61 on white   dark text only
	 *     #00C7FA  cyan    1.99 on white   dark text only
	 *     #49FCE2  aqua    1.29 on white   dark text only
	 *
	 * Three of the four cannot have white text on them. That is not a detail to
	 * discover during implementation, it decides the scheme: on a dark ground the
	 * numbers invert term for term, and the three that were unusable become the
	 * readable ones. Cyan is 1.99 on white and 9.29 as ink on a Studio card.
	 *
	 * So the light three are INK — links, active states, series, accents — and
	 * purple, the one that can carry white text, is the FILL. That is the whole
	 * assignment, and every rule below follows from it.
	 *
	 * ── why base tokens are remapped, not just added to ──
	 *
	 * `--studio-*` alone would have dressed the pages and left every shared
	 * component behind: Button, Select, Dialog and Field all read `--bg-card`,
	 * `--accent` and `--text-primary`, so a white button would have sat on a dark
	 * panel until each was given a Studio variant. Remapping the base names inside
	 * this scope costs nothing and dresses all of them at once — a component that
	 * consumes tokens correctly is already a Studio component.
	 *
	 * The `--studio-*` names are the ones with no scout-app equivalent: the raw
	 * four, the white-text fill, and the chart series.
	 */
	:global(:root[data-studio]) {
		/* The four, verbatim. Named so a page can reach for the colour itself
		   where a semantic token would be a lie — a legend swatch is not an
		   "accent", it is series 2. */
		--studio-purple: #662db4;
		--studio-blue: #0087f8;
		--studio-cyan: #00c7fa;
		--studio-aqua: #49fce2;
		/* #662DB4 lifted until it reads as ink on a dark ground. The raw purple is
		   2.29 on a Studio card — fine as a fill, invisible as text — and a fourth
		   series had to be something, so this is the purple that can be drawn with
		   rather than sat on. Same relationship as the app's dark --accent to its
		   light one. */
		--studio-violet: #a277ee;

		/* Grounds. Neutral-with-purple rather than grey, so the sidebar's purple
		   fill reads as the same family instead of a sticker on slate. */
		--bg-page: #0a0912;
		--bg-card: #14121f;
		--bg-subtle: #1c1930;
		--bg-elev: #241f3c;

		--text-primary: #eceafd;
		--text-muted: #a9a3c9;
		--text-faint: #8e88b0;

		--border: #2a2540;
		/* 3.54 on --bg-elev, the lightest ground it is ever drawn against. The
		   obvious #5c5480 looked right and measured 2.27 there — an input outline
		   under WCAG 1.4.11's 3:1 floor, which is the one boundary that has to be
		   visible because it is the only thing saying "input". */
		--border-strong: #7a71a4;

		/* Cyan is the accent because it is the one colour that works in both
		   directions: 9.29 as ink on a card, and 9.95 as a fill under --on-accent.
		   Purple could carry the fill but not the links, and --accent has to do
		   both jobs — Button paints it as a background, every page paints it as
		   text. */
		--accent: #00c7fa;
		--accent-hover: #49fce2;
		--accent-soft: #2a1a4d;
		--on-accent: #0a0912;

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
		--banner-info-bg: #1c1440;
		--banner-info-border: #3f2d6e;
		--banner-red-bg: #33141a;
		--banner-red-border: #5e2a2a;
		--banner-blue-bg: #141d38;
		--banner-blue-border: #2c4472;

		/* The white-text fill. Deliberately separate from --accent: this is the
		   one member of the palette that may sit under white, and naming it that
		   way is what stops someone reaching for cyan the next time a filled
		   surface is wanted. */
		--studio-fill: #662db4;
		--on-studio-fill: #ffffff;

		/* Chart series. Ordered cyan → blue → aqua → violet, which is not the
		   order they are listed in: it is the order that keeps ADJACENT series
		   furthest apart. The natural order puts cyan next to aqua at 1.55, the
		   closest pair in the set.

		   Two of the four are lifted rather than raw, and the check is what
		   decided which: a series doubles as its own legend label, so it is held
		   to the 4.5 text floor, and the raw blue measures 4.36 on --bg-elev. It
		   passes on every other ground, which is exactly how it would have
		   shipped — the raised panel is the one surface nobody checks. #1c92fb is
		   the smallest lift that clears it, at 4.90. */
		--studio-series-1: #00c7fa;
		--studio-series-2: #1c92fb;
		--studio-series-3: #49fce2;
		--studio-series-4: #a277ee;

		/* A 6%-black shadow is invisible on a #14121f card. Elevation on dark has
		   to be a darker hole, not a lighter edge. */
		--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
		--shadow-md: 0 8px 28px rgba(0, 0, 0, 0.55);
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
		/* Aligned to --w-list, the width of the busiest surface under it.
		   --w-board left the bar's text starting well left of the content it sits
		   above, which reads as two pages stacked; a bar WIDER than a narrow form
		   is just a header and looks right. Align to the common case, not the
		   widest one. */
		max-width: var(--w-list);
		margin: 0 auto;
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
	@media (max-width: 30rem) {
		.role-badge {
			display: none;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.studio-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-min);
		padding: var(--space-1) var(--space-2);
		margin-left: var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--bar-chip-bg);
		color: var(--bar-ink);
		font-size: var(--fs-xs);
		font-weight: 700;
		letter-spacing: 0.02em;
		text-decoration: none;
		white-space: nowrap;
	}
	.studio-btn:hover {
		background: var(--bar-badge-bg);
		color: var(--bar-badge-ink);
	}
	.studio-btn:focus-visible {
		outline: 2px solid var(--bar-ink);
		outline-offset: 2px;
	}

	.role-badge {
		flex: none;
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
