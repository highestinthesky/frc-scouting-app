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
				     that used to answer it is gone.
				     Sitting ON the purple fill rather than under it: this is the one
				     member of the palette that takes light text, and the event code is
				     the fact that must never be missed. -->
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

	/* The sidebar is a SURFACE, flush to the viewport edge and running its full
	   height, rather than a floating column with padding around it. That is the
	   difference between "an application with a navigation rail" and "a page that
	   happens to have links down the side", and it was the second one. */
	.studio {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		align-items: stretch;
		/* No reservation for the phone shell's bottom bar — Studio does not render
		   it. This used to subtract a nav's height from a viewport that has none. */
		min-height: 100dvh;
	}


	/* No `align-self: start` here, and that is the whole rule.
	   A sticky element can only stick INSIDE its containing block, which for a
	   grid item is its grid area. `align-self: start` shrinks that area to the
	   item's own height, so the rail pinned for exactly one viewport and then
	   scrolled away with the page — on Insights, where the table is the thing you
	   scroll and the navigation is the thing you need while scrolling it.
	   Stretching keeps the area the full height of the row. */
	nav {
		position: sticky;
		top: 0;
		/* The app has no box-sizing reset — everything is content-box — so
		   `height: 100dvh` plus 2rem of padding made this 752px against a 720px
		   viewport. A sticky element taller than the viewport pins to the TOP only
		   until its bottom edge arrives, then travels with the page: the rail slid
		   32px and looked like sticky was simply broken. Border-box here rather
		   than globally, because flipping the box model under every page in the app
		   is not a thing to do inside a visual pass. */
		box-sizing: border-box;
		height: 100dvh;
		/* And if the rail ever outgrows the viewport, IT scrolls. */
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-3);
		background: var(--bg-card);
		border-right: 1px solid var(--border);
	}

	/* The one fill in the palette that takes light text, spent on the one fact
	   that must never be ambiguous: which event this surface is editing. */
	.brand {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--studio-fill);
		color: var(--on-studio-fill);
	}
	.mark {
		font-size: var(--fs-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	/* Named .at, not .on — `nav a.on` marks the current tab, and a bare `.on`
	   rule would have matched it too, rendering the active link tiny and
	   uppercase. Two meanings, one class name, one of them silently wrong. */
	.at {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
		opacity: 0.85;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-right: auto;
		width: 100%;
	}
	nav a {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: var(--tap-min);
		justify-content: center;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border-left: 3px solid transparent;
		color: var(--text-muted);
		text-decoration: none;
	}
	nav a:hover {
		background: var(--bg-subtle);
		color: var(--text-primary);
	}
	/* Current section carries a rule, a fill and a weight change — never colour
	   alone. The rule is what survives being looked at from across a table. */
	nav a.on {
		background: var(--accent-soft);
		border-left-color: var(--accent);
		color: var(--text-primary);
	}
	nav a.on .label {
		color: var(--accent);
	}
	.label {
		font-weight: 600;
		font-size: var(--fs-md);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--text-faint);
	}
	.out {
		display: inline-flex;
		align-items: center;
		/* start, not stretch. As a stretched column child it filled the rail and
		   its two words centred themselves over two lines on a phone. */
		align-self: flex-start;
		gap: var(--space-2);
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
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
		/* Dense by design, but not unboundedly: --w-board is the width a table is
		   readable at, and a 2400px row is not more information, it is a longer
		   saccade. Left-aligned against the rail rather than centred, because the
		   rail is where the eye starts. */
		max-width: var(--w-board);
		padding: var(--space-5);
	}

	/* Below the tablet breakpoint the sidebar becomes a strip above the content.
	   Studio is a laptop surface, but a manager WILL open it on a phone to check
	   one thing, and a 15rem column beside content at 375px is unreadable.

	   LAST in the file, not next to .studio where it reads better. A media query
	   adds no specificity, so `nav { position: static }` in here and
	   `nav { position: sticky }` outside it are a tie broken by source order —
	   and with this block written first, every phone override silently lost. The
	   rail stayed a 15rem sticky column at 375px. */
	@media (max-width: 47.9375rem) {
		.studio {
			grid-template-columns: minmax(0, 1fr);
		}
		nav {
			position: static;
			height: auto;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		nav ul {
			flex-direction: row !important;
			overflow-x: auto;
		}
		nav li {
			flex: 1 0 auto;
		}
		.hint {
			display: none;
		}
		/* The exit stays visible on phones. It is the only way out of Studio, and
		   hiding it was the bug: on a phone there was no route back at all. */
		.brand {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
		main {
			padding: var(--space-4);
		}
	}
</style>
