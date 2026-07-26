<script>
	// Scout view: the teams this device is watching — manager-assigned plus any
	// local extras the scout added themselves.
	import { session } from '$lib/session.svelte.js';
	import { relativeTime } from '$lib/format.js';

	let {
		newTeamInput = $bindable(),
		effectiveTeams,
		cached,
		qmList,
		busy,
		now,
		onAddTeam,
		onRemoveTeam,
		onRefresh
	} = $props();
</script>

<section>
	<h2>Your teams</h2>

	{#if effectiveTeams.length === 0}
		<p class="muted small">
			Nothing assigned to <strong>{session.scoutName || '(no name set)'}</strong>.
			Check the spelling matches what your manager used.
		</p>
	{:else}
		<div class="team-chips">
			{#each effectiveTeams as t}
				{@const isLocal = (session.localExtraTeams ?? []).includes(t)}
				<span class="team-chip" class:local={isLocal}>
					{t}
					{#if isLocal}
						<button
							type="button"
							class="chip-x"
							aria-label="Remove team {t}"
							onclick={() => onRemoveTeam(t)}
						>×</button>
					{/if}
				</span>
			{/each}
		</div>
	{/if}

	<div class="add-team">
		<input
			type="number"
			bind:value={newTeamInput}
			placeholder="Add team (e.g. 1234)"
			inputmode="numeric"
		/>
		<button class="secondary-btn" disabled={!newTeamInput} onclick={onAddTeam}>
			Add
		</button>
	</div>

	<div class="actions-row" style="margin-top: 0.6rem;">
		<button class="secondary-btn" disabled={busy} onclick={onRefresh}>
			{busy ? '…' : 'Refresh from manager'}
		</button>
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
	input {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	button.secondary-btn {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.secondary-btn {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
	}
	button.secondary-btn:hover { background: var(--bg-subtle); }
	button.secondary-btn:disabled { opacity: 0.6; cursor: progress; }
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
	.team-chip.local {
		background: var(--bg-subtle);
		color: var(--text-primary);
		border-color: var(--border-strong);
		font-weight: 600;
	}
	.chip-x {
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.chip-x:hover { color: var(--danger); }
	.add-team {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.add-team input { flex: 1 1 0; min-width: 0; }
</style>
