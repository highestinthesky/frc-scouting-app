<script>
	// A mode's sub-pages, as a segmented control under the page heading.
	//
	// The mode is the <h1> (Plan, Run, Pick) and this says which part of it you
	// are on. The same at every width: a second level in the sidebar would exist
	// only on a laptop, and a phone needs the sub-pages more, not less.
	//
	// `current` is the LABEL of the sub-page this file is, written as a literal
	// at the call site. check_components.mjs reads it there to assert that each
	// sub-page lights itself — derived from the URL instead, a page mounted at
	// the wrong path would light whatever that path names and still pass.

	import { base } from '$app/paths';
	import { SUBNAV } from '$lib/nav-items.js';

	/** @type {{ mode: 'plan'|'run'|'pick', current: string }} */
	let { mode, current } = $props();

	const items = $derived(SUBNAV[mode] ?? []);
	const label = $derived(mode.charAt(0).toUpperCase() + mode.slice(1));
</script>

<nav class="sub" aria-label="{label} sections">
	<!-- Scrolls in its own box if it ever outgrows a phone; the document must
	     never scroll sideways. -->
	<ul>
		{#each items as item (item.key)}
			<li>
				<a
					href="{base}{item.href}"
					class:on={item.label === current}
					aria-current={item.label === current ? 'page' : undefined}
				>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.sub {
		margin: 0 0 var(--space-4);
		overflow-x: auto;
		border-bottom: 1px solid var(--border);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
	}
	a {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
		color: var(--text-muted);
		font-weight: 600;
		font-size: var(--fs-md);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--dur-short) var(--ease-out);
	}
	a:hover {
		color: var(--text-primary);
	}
	/* A rule and the accent, never colour alone. */
	a.on {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	/* Plan's four labels need 363px at the roomy padding and a 375px phone has
	   343 inside the page gutter, so the last tab was half off the edge. The
	   wrapper would scroll, but a tab cut in half reads as a tab that is not
	   there. Tighter padding fits all four. */
	@media (max-width: 30rem) {
		a {
			padding: var(--space-2);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		a {
			transition-duration: 0.01ms;
		}
	}
</style>
