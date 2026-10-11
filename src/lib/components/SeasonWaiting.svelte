<script>
	import { base } from '$app/paths';
	import { SEASON_WAITING_MESSAGE } from '$lib/season-rules.js';
	import { seasonLabel } from '$lib/seasons/catalog.js';
	import Button from './Button.svelte';
	let { year = 2026, otherEvent = false } = $props();
</script>

<main>
	<h1>{seasonLabel(year)}</h1>
	<p>{otherEvent ? `Choose an event for ${seasonLabel(year)}.` : SEASON_WAITING_MESSAGE}</p>
	<Button href="{base}/settings/">Settings</Button>
</main>

<style>
	main { max-width: var(--w-read); margin: var(--space-6) auto; padding: var(--space-5) var(--space-4); }
	h1 { margin: 0 0 var(--space-3); font-size: var(--fs-page); }
	p { margin: 0 0 var(--space-5); color: var(--text-muted); }
</style>
