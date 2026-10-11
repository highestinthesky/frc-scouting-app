<script>
	import { auth } from '$lib/auth.svelte.js';
	import { seasonSettings } from '$lib/season-settings.svelte.js';
	import { seasonFor } from '$lib/seasons/index.js';
	import { seasonLabel, seasonOptions } from '$lib/seasons/catalog.js';
	import Button from './Button.svelte';
	import Select from './Select.svelte';
	let year = $state(2026);
	let busy = $state(false);
	let error = $state('');
	let saved = $state('');
	let observedYear;
	const game = $derived(Number(year) === 1999 ? null : seasonFor(Number(year)));
	const options = $derived(seasonOptions(seasonSettings.value.active_year));
	$effect(() => {
		const nextYear = seasonSettings.value.active_year;
		if (nextYear === observedYear) return;
		observedYear = nextYear;
		year = nextYear;
	});
	async function save(e) {
		e.preventDefault();
		busy = true; error = ''; saved = '';
		try {
			await seasonSettings.update(year);
			saved = 'Season updated for the team.';
		} catch (e) { error = e?.message ?? String(e); }
		finally { busy = false; }
	}
</script>

<p class="status">{seasonLabel(seasonSettings.value.active_year)} · {seasonSettings.open ? 'Announced' : 'Awaiting announcement'}</p>
{#if auth.isSuper}
	<form onsubmit={save}>
		<Select label="Active season" bind:value={year} {options}
			disabled={busy || !seasonSettings.ready}
			onchange={() => { saved = ''; error = ''; }} />
		{#if !game}<p class="help">The scouting configuration for {seasonLabel(year)} is pending.</p>{/if}
		<p class="help">Scouting is available for announced seasons. Upcoming seasons open after their game is announced.</p>
		<div><Button type="submit" variant="primary" disabled={busy || !seasonSettings.ready}>{busy ? 'Saving…' : 'Save season'}</Button></div>
	</form>
{:else}
	<p class="help">A super chooses the team's active season. Scouting is available for announced seasons.</p>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if saved}<p class="help" role="status">{saved}</p>{/if}
{#if seasonSettings.error}
	<p class="help" role="status">Could not refresh the shared season. Showing the saved setting.</p>
	<Button onclick={() => seasonSettings.refresh()} disabled={busy}>Refresh season</Button>
{/if}

<style>
	form { display: flex; flex-direction: column; gap: var(--space-3); }
	p { margin: 0 0 var(--space-3); }
	.help { color: var(--text-muted); }
	.help { font-size: var(--fs-sm); }
	.error { color: var(--danger); }
</style>
