<script>
	import { tick } from 'svelte';
	import Select from '../Select.svelte';
	// Manager taps "Edit" on a preview row or a coverage conflict to open this.
	// Shows both alliances, who is effectively watching each team (override if
	// there is one, otherwise the base assignment), and an override editor.
	//
	// The route used {@const} here; as a component these have to be $derived,
	// since {@const} is only legal inside a block.
	import { teamStatus } from '$lib/coverage.js';
	import Button from '$lib/components/Button.svelte';
	import { timeOfDay } from '$lib/format.js';

	let {
		m,
		draft,
		overrideList,
		entryIndex,
		editingMatchCoverage,
		reminderScouts,
		busy,
		onClose,
		onDeleteOverride,
		onSaveOverride,
		hrefFor
	} = $props();

	const matchTime = $derived(m.actual_time ?? m.predicted_time ?? m.time ?? null);
	const matchOverrides = $derived(overrideList.filter((o) => o.match_number === m.match_number));
	const teamsRed = $derived((m.alliances?.red?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, ''))));
	const teamsBlue = $derived((m.alliances?.blue?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, ''))));

	let modal = $state(/** @type {HTMLDialogElement|null} */ (null));
	$effect(() => {
		const el = modal;
		if (!el) return;
		const opener = document.activeElement;
		el.showModal();
		return () => {
			el.close();
			void tick().then(() => {
				if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
			});
		};
	});
</script>

<dialog
	bind:this={modal}
	class="modal-backdrop"
	aria-labelledby="match-editor-title"
	oncancel={(e) => { e.preventDefault(); onClose(); }}
	onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
	<div class="modal-card">
		<header class="modal-head">
			<h2 id="match-editor-title">
				Q{m.match_number}
				{#if matchTime}<span class="mh-time">· {timeOfDay(matchTime)}</span>{/if}
			</h2>
			<button type="button" class="modal-x" onclick={onClose} aria-label="Close">✕</button>
		</header>

		<div class="modal-body">
			<!-- Coverage map: for each team, who's watching it. -->
			<section class="mb-section">
				<h3 class="mb-h">Coverage</h3>
				<ul class="mb-coverage">
					{#each editingMatchCoverage as row (row.color + ':' + row.team)}
						{@const st = teamStatus(m.match_number, row.team, entryIndex, row.watchers.length > 0)}
						<li class="mb-team" data-color={row.color}>
							<span class="mb-color-tag">{row.color}</span>
							<span class="mb-team-num">{row.team}</span>
							<span class="mb-status {st.status}">
								{#if st.status === 'submitted'}
									✓ scouted{#if st.count > 1} ×{st.count}{/if}
								{:else if st.status === 'assigned'}
									assigned
								{:else}
									uncovered
								{/if}
							</span>
							<span class="mb-watchers">
								{#if row.watchers.length === 0}
									<em class="mb-none">no scout</em>
								{:else}
									{#each row.watchers as w, i}
										{w.scout}{#if w.viaOverride} <small class="mb-override-tag">(override)</small>{/if}{#if i < row.watchers.length - 1}, {/if}
									{/each}
								{/if}
							</span>
							<a
								class="mb-scout"
								href={hrefFor({ match: m.match_number, team: row.team, color: row.color })}
							>{st.status === 'submitted' ? 'Re-scout →' : 'Scout →'}</a>
						</li>
					{/each}
				</ul>
			</section>

			<!-- Active overrides for this match. -->
			<section class="mb-section">
				<h3 class="mb-h">
					Overrides
					{#if matchOverrides.length > 0}<span class="ov-pill">{matchOverrides.length}</span>{/if}
				</h3>
				{#if matchOverrides.length === 0}
					<p class="muted small">
						No overrides.
					</p>
				{:else}
					<ul class="mb-overrides">
						{#each matchOverrides as o (o.id)}
							<li class="mb-or-row">
								<span><strong>{o.scout_name}</strong> watches <strong>{o.team_number}</strong></span>
								<button
									type="button"
									class="ov-x"
									aria-label="Remove override"
									onclick={() => onDeleteOverride(o.id)}
									disabled={busy}
								>✕</button>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Add an override for this match. -->
				<div class="mb-form">
					<div class="mb-field">
						<Select
							label="Scout"
							bind:value={draft.scout}
							options={[{ value: '', label: 'Choose a scout' }, ...reminderScouts.map((n) => ({ value: n, label: n }))]}
						/>
					</div>
					<div class="mb-field">
						<Select
							label="Watches team"
							bind:value={draft.team}
							options={[{ value: '', label: 'Choose a team' }, ...[...teamsRed, ...teamsBlue].map((t) => ({ value: String(t), label: String(t) }))]}
						/>
					</div>
					<!-- Wrapped rather than styled through a class prop: a parent's
					     scoped selector cannot reach a child component's element,
					     and Svelte does not warn about it because it can see the
					     class in the markup. -->
					<div class="mb-add">
						<Button
							variant="primary"
							disabled={busy || !draft.scout || !draft.team}
							onclick={() => onSaveOverride(m.match_number)}
						>Add override</Button>
					</div>
				</div>
			</section>
		</div>

		<footer class="modal-foot">
			<Button onclick={onClose}>Done</Button>
		</footer>
	</div>
</dialog>

<style>
	h2 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-primary);
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); }
	.ov-pill {
		display: inline-block;
		padding: 0 var(--space-2);
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: var(--radius-pill);
		font-size: var(--fs-xs);
		font-weight: 700;
	}
	.ov-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		font-size: var(--fs-sm);
	}
	.ov-x:hover { color: var(--danger); }
	/* ── match-detail modal ─────────────────────────────────────── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		width: 100%; height: 100dvh; max-width: none; max-height: none;
		margin: 0; border: 0;
		background: var(--overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(var(--space-4), env(safe-area-inset-top, 0px)) max(var(--space-4), env(safe-area-inset-right, 0px)) max(var(--space-4), env(safe-area-inset-bottom, 0px)) max(var(--space-4), env(safe-area-inset-left, 0px));
		z-index: 50;
	}
	.modal-backdrop:not([open]) { display: none; }
	.modal-backdrop::backdrop { background: transparent; }
	.modal-card {
		background: var(--bg-card);
		color: var(--text-primary);
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-md);
		width: 100%;
		max-width: 30rem;
		max-height: calc(100dvh - max(var(--space-4), env(safe-area-inset-top, 0px)) - max(var(--space-4), env(safe-area-inset-bottom, 0px)));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.modal-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4);
		border-bottom: 1px solid var(--border);
	}
	.modal-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-primary);
		flex: 1 1 0;
		min-width: 0;
	}
	.mh-time {
		color: var(--text-muted);
		font-weight: 500;
		font-size: var(--fs-sm);
		margin-left: var(--space-2);
	}
	.modal-x {
		min-width: var(--tap-min); min-height: var(--tap-min);
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: var(--fs-lg);
		cursor: pointer;
		padding: var(--space-1) var(--space-2);
		line-height: 1;
		border-radius: var(--radius-sm);
	}
	.modal-x:hover { color: var(--text-primary); background: var(--bg-subtle); }
	.modal-body {
		padding: var(--space-2) var(--space-4) var(--space-4);
		overflow-y: auto;
	}
	.mb-section { margin-top: var(--space-4); }
	.mb-section:first-child { margin-top: var(--space-1); }
	.mb-h {
		font-size: var(--fs-sm);
		color: var(--text-muted);
		margin: 0 0 var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.mb-coverage {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.mb-team {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border);

		border-radius: var(--radius-md);
		background: var(--bg-card);
		font-size: var(--fs-sm);
	}
	.mb-team[data-color='red'] .mb-color-tag { color: var(--alliance-red); }
	.mb-team[data-color='blue'] .mb-color-tag { color: var(--alliance-blue); }
	.mb-color-tag {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		min-width: 2.4rem;
	}
	.mb-team-num { font-weight: 700; min-width: 3.5rem; }
	.mb-status {
		flex-shrink: 0;
		font-size: var(--fs-xs);
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		white-space: nowrap;
		border: 1px solid var(--border);
		color: var(--text-faint);
		background: var(--bg-subtle);
	}
	.mb-status.submitted {
		color: var(--success);
		background: var(--success-bg);
		border-color: var(--success-border);
	}
	.mb-status.assigned {
		color: var(--accent);
		background: var(--accent-soft);
		border-color: var(--accent-soft);
	}
	.mb-watchers { color: var(--text-muted); flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; }
	.mb-none { color: var(--text-faint); font-style: italic; }
	.mb-override-tag {
		color: var(--accent);
		font-weight: 600;
		font-size: var(--fs-xs);
	}
	.mb-scout {
		flex-shrink: 0;
		font-size: var(--fs-xs);
		font-weight: 700;
		text-decoration: none;
		color: var(--accent);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		white-space: nowrap;
	}
	.mb-scout:hover { border-color: var(--accent); background: var(--accent-soft); }
	.mb-overrides {
		list-style: none;
		padding: 0;
		margin: 0 0 var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.mb-or-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--bg-subtle);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}
	.mb-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-2);
		align-items: end;
		margin-top: var(--space-2);
	}
	.mb-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.mb-label {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--text-muted);
	}
	.mb-add {
		grid-column: 1 / -1;
		justify-self: start;
	}
	.modal-foot {
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--border);
		display: flex;
		justify-content: flex-end;
	}
	@media (max-width: 39.9375rem) {
		.modal-card { max-width: 100%; }
		.mb-form { grid-template-columns: minmax(0, 1fr); }
		.mb-team { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; }
		.mb-watchers { grid-column: 1 / 3; }
		.mb-scout { grid-column: 3; }
	}
</style>
