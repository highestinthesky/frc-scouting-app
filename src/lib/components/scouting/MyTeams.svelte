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
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	.muted a { color: var(--accent); }
	.actions-row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}
	.freshness {
		margin-top: var(--space-3);
		font-style: italic;
		font-size: var(--fs-sm);
	}
	/* ── scout: team chips ──────────────────────────────────────────── */
	.team-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.team-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid var(--accent);
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--fs-sm);
	}
</style>
