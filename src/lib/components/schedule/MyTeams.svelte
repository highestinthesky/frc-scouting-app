<script>
	// Scout view: the teams the manager has assigned to this device.
	//
	// Read-only on purpose. Scouts could once add teams here, but those
	// additions lived only on their own phone — the manager's coverage board
	// never saw them, so the roster the manager planned against and the one
	// scouts were working to could silently disagree.
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { session } from '$lib/session.svelte.js';
	import { relativeTime } from '$lib/format.js';

	let { assignedTeams, cached, qmList, busy, now, onRefresh } = $props();
</script>

<section>
	<h2>Your teams</h2>

	{#if assignedTeams.length === 0}
		<p class="muted small">
			Nothing assigned to <strong>{session.scoutName || '(no name set)'}</strong>.
			Check that your name on <a href="{base}/settings/">Settings</a> matches
			exactly what your manager typed, then tap Refresh. If it still looks
			empty, ask them to assign you.
		</p>
	{:else}
		<div class="team-chips">
			{#each assignedTeams as t}
				<span class="team-chip">{t}</span>
			{/each}
		</div>
	{/if}

	<div class="actions-row" style="margin-top: 0.6rem;">
		<Button disabled={busy} onclick={onRefresh}>
			{busy ? '…' : 'Refresh from manager'}
		</Button>
	</div>

	{#if cached}
		<p class="muted small freshness">
			Schedule pulled {relativeTime(cached.cachedAt, now)}
			{#if cached.fetchedBy} (published by {cached.fetchedBy}){/if}
			· {qmList.length} qual matches
		</p>
	{/if}
</section>

<style>
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.muted.small { font-size: 0.82rem; }
	.muted a { color: var(--accent); }
	.actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}
	.freshness {
		margin-top: 0.6rem;
		font-style: italic;
		font-size: 0.8rem;
	}
	/* ── scout: team chips ──────────────────────────────────────────── */
	.team-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
	.team-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid var(--accent);
		font-weight: 700;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.9rem;
	}
</style>
