<script>
	// Manager Studio — v0.6 Phase 5.
	//
	// A separate surface rather than another tab on Insights, because the jobs are
	// different in kind. Insights answers "how is this team doing" and a scout
	// reads it on a phone between matches. Studio answers "who is scouting what,
	// and is the event covered", which is a laptop-at-a-table job done by one or
	// two people.
	//
	// The draft wants it to feel like a separate, more futuristic application,
	// opened in its own tab. What that actually buys is room: a sidebar and wide
	// tables are unusable at 375px and are the right shape at 1280px, and trying
	// to serve both is what made the old schedule mega-page unreadable.
	//
	// It stays inside the same app for one reason: a second deployment would need
	// its own auth, and "signed into the scouting app but not the studio" is a
	// support problem nobody needs at a competition.

	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte.js';
	import { session } from '$lib/session.svelte.js';

	let { children } = $props();

	// Everything that is "running an event" lives here now. Insights folded in
	// because it was never a different job from Studio — teams, compare and
	// picklist are all decisions a manager makes at a table — and keeping them in
	// separate applications is what made the two clash.
	const TABS = [
		{ href: 'event', label: 'Event' },
		{ href: 'schedule', label: 'Schedule' },
		{ href: 'coverage', label: 'Coverage' },
		{ href: 'insights', label: 'Insights' },
		{ href: 'accounts', label: 'Accounts' }
	];

	// The SECOND segment after /studio, not the last one — /studio/insights/team/254
	// must still light up Insights. Taking the last segment lit nothing on any
	// sub-page, which is precisely where a manager needs to know where they are.
	//
	// The event-scoped routes break that rule and have to be mapped by hand:
	// /studio/<code>/q12 and /studio/<code>/team/254 put an EVENT CODE in the
	// second slot, which matches no tab, so the rail went dark on exactly the two
	// pages added to be linked to from everywhere. A match belongs to Schedule
	// and a team belongs to Insights, so they light those.
	const current = $derived.by(() => {
		const parts = page.url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
		const i = parts.indexOf('studio');
		if (i < 0) return '';
		const second = parts[i + 1] ?? '';
		if (!second || TABS.some((t) => t.href === second)) return second;
		// Not a tab, so it is an event code. Which page is decided by what comes
		// after it.
		const third = parts[i + 2] ?? '';
		if (/^q\d+$/.test(third)) return 'schedule';
		if (third === 'team') return 'insights';
		return '';
	});
</script>

{#if !auth.signedIn}
	<!-- The route guard in +layout.svelte already redirects, so this is only the
	     flash before it fires. Saying nothing looks broken; saying this does not. -->
	<p class="gate">Sign in to open Studio.</p>
{:else if !auth.isManager}
	<!-- Deliberately explicit rather than a 404. A scout who followed a link from
	     a manager should learn why it will not open, not conclude the app is
	     broken and ask someone mid-match. -->
	<div class="gate">
		<h1>Manager access required</h1>
		<p>
			Ask a team admin for access.
		</p>
		<a href="{base}/home/">Back to Home</a>
	</div>
{:else}
	<div class="studio">
		<nav aria-label="Studio sections">
			<div class="event-context">
				<span class="at">{session.eventCode || 'No event'}</span>
			</div>
			<ul>
				{#each TABS as tab (tab.href)}
					<li>
						<a
							href="{base}/studio/{tab.href}/"
							aria-current={current === tab.href ? 'page' : undefined}
							class:on={current === tab.href}
						>
							<span class="nav-symbol" aria-hidden="true">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
									{#if tab.href === 'event'}<path d="M7 4v4m10-4v4M4 10h16M5 6h14a1 1 0 0 1 1 1v13H4V7a1 1 0 0 1 1-1Z" />
									{:else if tab.href === 'schedule'}<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
									{:else if tab.href === 'coverage'}<path d="M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7l-9-4Z" /><path d="m8 12 3 3 5-6" />
									{:else if tab.href === 'insights'}<path d="M4 4v16h16M8 16v-5m5 5V7m5 9v-8" />
									{:else}<circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m3 9v-2a6 6 0 0 0-3-5" />{/if}
								</svg>
							</span>
							<span class="label">{tab.label}</span>
						</a>
					</li>
				{/each}
			</ul>
			<!-- The only way out, so it is a real control and it is never hidden.
			     The global tab bar used to be the escape route and it was a trapdoor:
			     it left Studio without offering a way back. -->
			<a class="out" href="{base}/home/">
				<span aria-hidden="true">←</span> Home
			</a>
		</nav>

		<main>{@render children()}</main>
	</div>
{/if}

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app · tone: quiet utilitarian
	 * pre-emit critique: P5 H5 E4 S5 R5 V4
	 */
	.gate { max-width: var(--w-form); margin: calc(var(--space-7) + var(--safe-top)) auto; padding: 0 var(--space-4); color: var(--text-muted); }
	.gate h1 { font-size: var(--fs-page); color: var(--text-primary); }
	.gate a { color: var(--accent); }
	.studio { display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); align-items: stretch; min-height: 100dvh; }
	nav {
		position: sticky; top: 0; height: 100dvh; overflow-y: auto;
		display: flex; flex-direction: column; gap: var(--space-2);
		padding: max(var(--space-6), env(safe-area-inset-top, 0px)) var(--space-3) max(var(--space-5), env(safe-area-inset-bottom, 0px));
		padding-left: max(var(--space-3), env(safe-area-inset-left, 0px));
		background: var(--bg-card); border-right: 1px solid var(--border);
	}
	.event-context { display: flex; align-items: center; min-height: var(--tap-min); padding: var(--space-2) var(--space-3) var(--space-4); }
	.at { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted);  overflow-wrap: anywhere; }
	nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); width: 100%; }
	nav a { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap-min); padding: var(--space-2) var(--space-3); border: 1px solid transparent; border-radius: var(--radius-md); color: var(--text-muted); text-decoration: none; white-space: nowrap; }
	nav a:hover { background: var(--bg-subtle); color: var(--text-primary); }
	nav a.on { background: var(--accent-soft); color: var(--accent); border-left-color: var(--accent); }
	.nav-symbol { display: flex; flex: none; opacity: 0.85; }
	.label { font-weight: 500; font-size: var(--fs-sm); }
	.on .label { font-weight: 650; }
	.out { align-self: flex-start; margin-top: auto; font-size: var(--fs-sm); }
	main { min-width: 0; width: 100%; max-width: var(--w-board); padding: var(--space-7); padding-right: max(var(--space-7), env(safe-area-inset-right, 0px)); padding-bottom: max(var(--space-7), env(safe-area-inset-bottom, 0px)); }
	@media (max-width: 63.9375rem) { main { padding: var(--space-5); padding-right: max(var(--space-5), env(safe-area-inset-right, 0px)); padding-bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px)); } }
	@media (max-width: 47.9375rem) {
		.studio { grid-template-columns: minmax(0, 1fr); }
		nav { position: static; height: auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); padding: max(var(--space-3), env(safe-area-inset-top, 0px)) var(--space-3) var(--space-2); padding-left: max(var(--space-3), env(safe-area-inset-left, 0px)); padding-right: max(var(--space-3), env(safe-area-inset-right, 0px)); border-right: 0; border-bottom: 1px solid var(--border); }
		.event-context { padding: var(--space-2) var(--space-1); }
		.at { padding-left: 0; }
		nav ul { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; gap: var(--space-1); }
		nav li { flex: 1 0 auto; }
		nav ul a { justify-content: center; gap: var(--space-2); padding: var(--space-2); }
		.nav-symbol { display: none; }
		.out { grid-column: 2; grid-row: 1; align-self: center; margin: 0; padding: var(--space-2); }
		main { padding: var(--space-5) var(--space-4); padding-left: max(var(--space-4), env(safe-area-inset-left, 0px)); padding-right: max(var(--space-4), env(safe-area-inset-right, 0px)); padding-bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px)); }
	}
</style>
