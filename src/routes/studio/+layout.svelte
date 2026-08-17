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
		{ href: 'event', label: 'Event', hint: 'Who is on this event' },
		{ href: 'schedule', label: 'Schedule', hint: 'Matches and assignments' },
		{ href: 'coverage', label: 'Coverage', hint: 'What is being watched' },
		{ href: 'insights', label: 'Insights', hint: 'Teams, compare, picklist' },
		{ href: 'accounts', label: 'Accounts', hint: 'Who is on the team' }
	];

	// The SECOND segment after /studio, not the last one — /studio/insights/team/254
	// must still light up Insights. Taking the last segment lit nothing on any
	// sub-page, which is precisely where a manager needs to know where they are.
	const current = $derived.by(() => {
		const parts = page.url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
		const i = parts.indexOf('studio');
		return i >= 0 ? (parts[i + 1] ?? '') : '';
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
		<h1>Studio is a manager surface</h1>
		<p>
			Your account is a {auth.role ?? 'scout'}. A super can change that — everything
			you record is unaffected either way.
		</p>
		<a href="{base}/scouting/">Back to Home</a>
	</div>
{:else}
	<div class="studio">
		<nav aria-label="Studio sections">
			<div class="brand">
				<span class="mark">Studio</span>
				<!-- The event this surface is operating on. "Which event am I editing"
				     is the one thing that must never be ambiguous here, and the app bar
				     that used to answer it is gone. -->
				{#if session.eventCode}
					<span class="at">{session.eventCode}</span>
				{/if}
			</div>
			<ul>
				{#each TABS as tab (tab.href)}
					<li>
						<a
							href="{base}/studio/{tab.href}/"
							aria-current={current === tab.href ? 'page' : undefined}
							class:on={current === tab.href}
						>
							<span class="label">{tab.label}</span>
							<span class="hint">{tab.hint}</span>
						</a>
					</li>
				{/each}
			</ul>
			<!-- The only way out, so it is a real control and it is never hidden.
			     The global tab bar used to be the escape route and it was a trapdoor:
			     it left Studio without offering a way back. -->
			<a class="out" href="{base}/scouting/">
				<span aria-hidden="true">←</span> Leave Studio
			</a>
		</nav>

		<main>{@render children()}</main>
	</div>
{/if}

<style>
	.gate {
		max-width: 32rem;
		margin: var(--space-6) auto;
		padding: 0 var(--space-4);
		color: var(--text-muted);
	}
	.gate h1 {
		font-size: var(--fs-xl);
		color: var(--text-primary);
		margin: 0 0 var(--space-3);
	}
	.gate a {
		color: var(--accent);
	}

	.studio {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
		padding: var(--space-4);
		/* No reservation for the phone shell's bottom bar — Studio does not render
		   it. This used to subtract a nav's height from a viewport that has none. */
		padding-bottom: var(--space-6);
		min-height: 100dvh;
	}

	/* Below the tablet breakpoint the sidebar becomes a strip above the content.
	   Studio is a laptop surface, but a manager WILL open it on a phone to check
	   one thing, and a 14rem column beside content at 375px is unreadable. */
	@media (max-width: 47.9375rem) {
		.studio {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-3);
		}
		nav ul {
			flex-direction: row !important;
		}
		nav li {
			flex: 1;
		}
		.hint {
			display: none;
		}
		/* The exit stays visible on phones. It is the only way out of Studio, and
		   hiding it was the bug: on a phone there was no route back at all. */
		.brand .at {
			display: none;
		}
	}

	nav {
		position: sticky;
		top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.brand {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.mark {
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	/* Named .at, not .on — `nav a.on` marks the current tab, and a bare `.on`
	   rule would have matched it too, rendering the active link tiny and
	   uppercase. Two meanings, one class name, one of them silently wrong. */
	.at {
		font-size: var(--fs-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	nav a {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: var(--tap-min);
		justify-content: center;
		padding: var(--space-2);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		color: var(--text-muted);
		text-decoration: none;
	}
	nav a:hover {
		background: var(--bg-subtle);
	}
	/* Current section carries a border and a weight change, not colour alone. */
	nav a.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--text-primary);
	}
	.label {
		font-weight: 600;
		font-size: var(--fs-md);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}
	.out {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-min);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
	}
	.out:hover {
		background: var(--bg-subtle);
	}

	main {
		min-width: 0; /* lets wide tables scroll instead of stretching the grid */
	}
</style>
