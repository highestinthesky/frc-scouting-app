<script>
	import { auth } from '$lib/auth.svelte.js';
	import { seasonSettings } from '$lib/season-settings.svelte.js';
	import { seasonFor } from '$lib/seasons/index.js';
	import Button from './Button.svelte';
	let year = $state(2026);
	let announced = $state(false);
	let busy = $state(false);
	let error = $state('');
	let saved = $state('');
	let observedYear;
	let observedAnnounced;
	const game = $derived(Number(year) === 1999 ? null : seasonFor(Number(year)));
	$effect(() => {
		const nextYear = seasonSettings.value.active_year;
		const nextAnnounced = seasonSettings.value.announced;
		if (nextYear === observedYear && nextAnnounced === observedAnnounced) return;
		observedYear = nextYear;
		observedAnnounced = nextAnnounced;
		year = nextYear;
		announced = nextAnnounced;
	});
	async function save(e) {
		e.preventDefault();
		busy = true; error = ''; saved = '';
		try {
			await seasonSettings.update(year, announced);
			saved = 'Season updated for the team.';
		} catch (e) { error = e?.message ?? String(e); }
		finally { busy = false; }
	}
</script>

<p class="status">{seasonSettings.value.active_year} · {seasonSettings.open ? 'Announced' : 'Awaiting announcement'}</p>
{#if auth.isSuper}
	<form onsubmit={save}>
		<label>
			<span>Active year</span>
			<input type="number" min="1992" max="9999" required bind:value={year}
				disabled={busy} oninput={() => { announced = false; saved = ''; }} />
		</label>
		<p class="game">{game?.name ?? 'Game configuration pending'}</p>
		<label class="announcement">
			<input type="checkbox" bind:checked={announced} disabled={busy || !game} />
			<span>Season announced</span>
		</label>
		<p class="help">Changing the year closes scouting until you announce the prepared game.</p>
		<div><Button type="submit" variant="primary" disabled={busy || !seasonSettings.ready}>{busy ? 'Saving…' : 'Save season'}</Button></div>
	</form>
{:else}
	<p class="help">A super sets the team's active year and opens scouting after the game is announced.</p>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if saved}<p class="help" role="status">{saved}</p>{/if}
{#if seasonSettings.error}
	<p class="help" role="status">Could not refresh the shared season. Showing the saved setting.</p>
	<Button onclick={() => seasonSettings.refresh()} disabled={busy}>Refresh season</Button>
{/if}

<style>
	form { display: flex; flex-direction: column; gap: var(--space-3); }
	label { display: flex; flex-direction: column; gap: var(--space-1); font-weight: 600; }
	input[type='number'] { min-height: var(--tap-min); max-width: 12rem; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-md); }
	.announcement { flex-direction: row; align-items: center; gap: var(--space-3); min-height: var(--tap-min); cursor: pointer; }
	.announcement input { width: var(--space-4); height: var(--space-4); accent-color: var(--accent); }
	p { margin: 0 0 var(--space-3); }
	.game, .help { color: var(--text-muted); }
	.help { font-size: var(--fs-sm); }
	.error { color: var(--danger); }
</style>
