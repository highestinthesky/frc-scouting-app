<script>
	// The app's one navigation, by role. See nav-items.js for what it offers.
	//
	// A scout's markup and styles are the two-tab bar exactly as it was before
	// Studio folded in — bottom-docked on phones, a top strip from 40rem. That is
	// the promise that made the merge safe, so it is a separate branch here
	// rather than a mode of the manager's layout that happens to look the same.
	//
	// A manager gets two navs, and CSS decides which is on screen, because the
	// pages are prerendered and there is no width to ask for on the server:
	//
	//   .rail   from 40rem: a top strip of every entry, then from 48rem a sticky
	//           sidebar (the old Studio rail, moved).
	//   .bar    under 40rem: Home, Run, Pick and More, docked where the thumb is.
	//           More opens the rest in a sheet.
	//
	// The hidden one is display:none, so it is out of the accessibility tree and
	// the tab order rather than being a second copy of every link.

	import { base } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { MANAGER_GROUPS, PHONE_PRIMARY } from '$lib/nav-items.js';
	import Sheet from './Sheet.svelte';

	/**
	 * @type {{
	 *   items: ReadonlyArray<{ key: string, label: string, href: string }>,
	 *   current: string,
	 *   manager: boolean
	 * }}
	 */
	let { items, current, manager } = $props();

	const byKey = $derived(new Map(items.map((i) => [i.key, i])));
	const groups = $derived(
		MANAGER_GROUPS.map((g) => g.map((k) => byKey.get(k)).filter(Boolean))
	);
	const primary = $derived(PHONE_PRIMARY.map((k) => byKey.get(k)).filter(Boolean));
	const overflow = $derived(items.filter((i) => !PHONE_PRIMARY.includes(i.key)));
	// More stands in for whatever it holds, so it lights when you are on one of
	// those pages — otherwise a manager on Plan sees a bar with nothing lit.
	const moreActive = $derived(overflow.some((i) => i.key === current));

	let moreOpen = $state(false);
	afterNavigate(() => {
		moreOpen = false;
	});
</script>

{#if !manager}
	<nav class="tabs" aria-label="Main">
		{#each items as item (item.key)}
			<a
				href="{base}{item.href}"
				class:active={current === item.key}
				aria-current={current === item.key ? 'page' : undefined}
			>
				{item.label}
			</a>
		{/each}
	</nav>
{:else}
	<nav class="rail" aria-label="Main">
		{#each groups as group, gi (gi)}
			<ul>
				{#each group as item (item.key)}
					<li>
						<a
							href="{base}{item.href}"
							class:on={current === item.key}
							aria-current={current === item.key ? 'page' : undefined}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<nav class="bar" aria-label="Main">
		{#each primary as item (item.key)}
			<a
				href="{base}{item.href}"
				class:active={current === item.key}
				aria-current={current === item.key ? 'page' : undefined}
			>
				{item.label}
			</a>
		{/each}
		<button
			type="button"
			class="more"
			class:active={moreActive}
			aria-haspopup="dialog"
			aria-expanded={moreOpen}
			onclick={() => (moreOpen = true)}
		>
			More
		</button>
	</nav>

	<Sheet bind:open={moreOpen} label="More">
		<ul class="sheet-list">
			{#each overflow as item (item.key)}
				<li>
					<a
						href="{base}{item.href}"
						class:on={current === item.key}
						aria-current={current === item.key ? 'page' : undefined}
						onclick={() => (moreOpen = false)}
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</Sheet>
{/if}

<style>
	/* ── A scout's bar — unchanged ───────────────────────────────────────
	   Phone-first: docked to the bottom of the viewport, where a thumb
	   reaches without the phone changing hands. A top tab strip is the
	   furthest point from a resting thumb on a 6" screen, and this app is
	   used standing up, one-handed, while a match is running.

	   From 40rem the same markup becomes a top strip — on a laptop the
	   bottom edge is the wrong place and there's no reach problem to solve.

	   Nav stays before <main> in the DOM either way, so tab order and
	   screen-reader order are unchanged by the visual move. */
	.tabs,
	.bar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 20;
		display: flex;
		justify-content: stretch;
		background: var(--bg-card);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	.tabs a,
	.bar a,
	.bar .more {
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
	/* A <button> does not inherit the page's font; `font: inherit` resets the
	   shorthand, so the weight and size the links have are restated after it. */
	.bar .more {
		font: inherit;
		font-weight: 600;
		font-size: var(--fs-sm);
		background: none;
		border-left: none;
		border-right: none;
		border-bottom: none;
		cursor: pointer;
	}
	.tabs a.active,
	.bar a.active,
	.bar .more.active {
		color: var(--accent);
		border-top-color: var(--accent);
		background: var(--accent-soft);
	}
	.tabs a:hover,
	.bar a:hover,
	.bar .more:hover {
		color: var(--accent);
	}
	.tabs a:focus-visible,
	.bar a:focus-visible,
	.bar .more:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* Pages reserve the bar's height themselves, via --nav-bottom-h in their
	   own `main` rule. A :global(main) rule in the layout would look like it
	   handled it and quietly lose: Svelte scoping makes a page's `main`
	   selector (0,1,1), which outranks :global(main) at (0,0,1). */

	/* ── A manager's rail ────────────────────────────────────────────────
	   Hidden on phones, where the bar above stands in for it. */
	.rail {
		display: none;
	}
	.rail ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
	}
	.rail a {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		color: var(--text-muted);
		font-weight: 600;
		font-size: var(--fs-md);
		text-decoration: none;
		transition: color var(--dur-short) var(--ease-out);
	}
	.rail a:hover {
		color: var(--text-primary);
		background: var(--bg-subtle);
	}
	/* The current entry carries a rule, a fill and the accent — never colour
	   alone. The rule is what survives being looked at from across a table. */
	.rail a.on {
		color: var(--accent);
		background: var(--accent-soft);
	}

	.sheet-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.sheet-list a {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border-left: 3px solid transparent;
		color: var(--text-primary);
		font-weight: 600;
		text-decoration: none;
	}
	.sheet-list a:hover {
		background: var(--bg-subtle);
	}
	.sheet-list a.on {
		background: var(--accent-soft);
		border-left-color: var(--accent);
		color: var(--accent);
	}

	/* Responsive blocks go last: a media query adds no specificity, so an
	   override written above the rule it overrides loses on source order. */
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

		.bar {
			display: none;
		}
		/* Tablet: the scout's top strip, carrying every entry. */
		.rail {
			display: flex;
			justify-content: center;
			flex-wrap: wrap;
			border-bottom: 1px solid var(--border);
			background: var(--bg-card);
			padding: 0 var(--space-4);
		}
		.rail a {
			border-bottom: 3px solid transparent;
			margin-bottom: -1px;
		}
		.rail a.on {
			border-bottom-color: var(--accent);
			background: none;
		}
	}

	/* Laptop: the sidebar. Sticky inside its grid cell, which the layout
	   stretches to the full row — `align-self: start` would shrink that cell to
	   the rail's own height and it would pin for exactly one viewport. */
	@media (min-width: 48rem) {
		.rail {
			position: sticky;
			top: 0;
			height: 100dvh;
			overflow-y: auto;
			flex-direction: column;
			flex-wrap: nowrap;
			justify-content: flex-start;
			gap: var(--space-3);
			padding: var(--space-4) var(--space-3);
			padding-left: max(var(--space-3), env(safe-area-inset-left, 0px));
			padding-bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px));
			border-bottom: none;
			border-right: 1px solid var(--border);
		}
		.rail ul {
			flex-direction: column;
		}
		.rail ul + ul {
			padding-top: var(--space-3);
			border-top: 1px solid var(--border);
		}
		.rail a {
			border-radius: var(--radius-md);
			border-bottom: none;
			border-left: 3px solid transparent;
			margin-bottom: 0;
		}
		.rail a.on {
			background: var(--accent-soft);
			border-left-color: var(--accent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tabs a,
		.bar a,
		.bar .more,
		.rail a {
			transition-duration: 0.01ms;
		}
	}
</style>
