<script>
	// The scout's match list. Two views of the same schedule:
	//
	//   "My teams"    one row per team-match they're responsible for. This is the
	//                 working list — already-recorded rows stay visible but muted
	//                 so the scout keeps a sense of pace.
	//   "All matches" every qual match at the event. Useful while waiting: you can
	//                 see what's actually on the field, with your own rows marked.
	//
	// Either way a row expands in place to show all six robots, so a scout can
	// check partners and opponents without going to the manager's preview.
	import { relativeTime, timeOfDay } from '$lib/format.js';
	import { teamStatus } from '$lib/coverage.js';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		cached,
		assignedTeams,
		myUpcoming,
		myProgress,
		qmList,
		entryIndex,
		now,
		hrefFor,
		isManager = false
	} = $props();

	let view = $state(/** @type {'mine'|'all'} */ ('mine'));
	/** Expanded match numbers — a Set so several can be open at once. */
	let expanded = new SvelteSet();

	function toggle(matchNumber) {
		// SvelteSet is reactive, so mutating in place is enough.
		if (expanded.has(matchNumber)) expanded.delete(matchNumber);
		else expanded.add(matchNumber);
	}

	const mine = $derived(new Set(assignedTeams ?? []));
	const matchByNumber = $derived(new Map((qmList ?? []).map((m) => [m.match_number, m])));

	/** The six robots in a match, in alliance order, with per-team state. */
	function lineup(matchNumber) {
		const m = matchByNumber.get(matchNumber);
		if (!m) return [];
		const out = [];
		for (const color of ['red', 'blue']) {
			for (const key of m.alliances?.[color]?.team_keys ?? []) {
				const team = Number(String(key).replace(/^frc/, ''));
				if (!Number.isFinite(team)) continue;
				const st = teamStatus(matchNumber, team, entryIndex, mine.has(team));
				out.push({ color, team, isMine: mine.has(team), status: st.status, count: st.count });
			}
		}
		return out;
	}

	const matchTimeOf = (m) => m?.actual_time ?? m?.predicted_time ?? m?.time ?? null;
</script>

<section>
	<h2>Upcoming matches</h2>

	{#if cached && qmList?.length}
		<div class="view-toggle" role="group" aria-label="Which matches to show">
			<button
				type="button"
				class="vt-btn"
				class:selected={view === 'mine'}
				aria-pressed={view === 'mine'}
				onclick={() => (view = 'mine')}
			>My teams</button>
			<button
				type="button"
				class="vt-btn"
				class:selected={view === 'all'}
				aria-pressed={view === 'all'}
				onclick={() => (view = 'all')}
			>All matches</button>
		</div>
	{/if}

	{#if !cached}
		<p class="muted small">
			{#if isManager}
				Fetch and publish to populate this list.
			{:else}
				No schedule pulled yet. Tap “Refresh from manager” above once your
				manager has published.
			{/if}
		</p>
	{:else if view === 'all'}
		<!-- ── Every qual match at the event ─────────────────────────── -->
		{#if !qmList?.length}
			<p class="muted small">No qual matches in the published schedule.</p>
		{:else}
			<ul class="upcoming">
				{#each qmList as m (m.match_number)}
					{@const t = matchTimeOf(m)}
					{@const teams = lineup(m.match_number)}
					{@const yours = teams.filter((x) => x.isMine)}
					{@const open = expanded.has(m.match_number)}
					<li class="upcoming-row" class:has-mine={yours.length > 0}>
						<button
							type="button"
							class="upcoming-link as-button"
							aria-expanded={open}
							onclick={() => toggle(m.match_number)}
						>
							<span class="up-match">Q{m.match_number}</span>
							<span class="up-lineup">
								<span class="side red"
									>{teams.filter((x) => x.color === 'red').map((x) => x.team).join(' · ')}</span
								>
								<span class="up-vs">vs</span>
								<span class="side blue"
									>{teams.filter((x) => x.color === 'blue').map((x) => x.team).join(' · ')}</span
								>
							</span>
							{#if yours.length > 0}
								<span class="up-yours">yours: {yours.map((x) => x.team).join(', ')}</span>
							{/if}
							{#if t}
								<span class="up-time">
									{timeOfDay(t)}
									<span class="up-rel">· {relativeTime(t, now)}</span>
								</span>
							{/if}
							<span class="up-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
						</button>
						{#if open}
							{@render detail(teams, m.match_number)}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else if !assignedTeams.length}
		<p class="muted small">Nothing assigned to you yet — ask your manager, or use All matches.</p>
	{:else if myUpcoming.length === 0}
		<p class="muted small">None of your teams appear in the qual schedule.</p>
	{:else}
		<!-- ── Just the scout's own team-matches ─────────────────────── -->
		<div class="cov-rollup" aria-label="Your scouting progress">
			<div class="cov-bar" aria-hidden="true">
				<span
					class="cov-bar-fill"
					style="width:{myProgress.total ? Math.round((myProgress.done / myProgress.total) * 100) : 0}%"
				></span>
			</div>
			<p class="cov-rollup-text">
				You've logged <strong>{myProgress.done}</strong> of
				<strong>{myProgress.total}</strong> assigned team-matches.
			</p>
		</div>
		<ul class="upcoming">
			{#each myUpcoming as row (row.match + ':' + row.team)}
				{@const matchTime = row.actualTime ?? row.predictedTime}
				{@const open = expanded.has(row.match)}
				<li class="upcoming-row" data-color={row.color} class:done={row.done}>
					<div class="row-main">
						<a href={hrefFor(row)} class="upcoming-link">
							<span class="up-match">Q{row.match}</span>
							<span class="up-team">Team {row.team}</span>
							<span class="up-color">{row.color}</span>
							{#if matchTime}
								<span class="up-time">
									{timeOfDay(matchTime)}
									<span class="up-rel">· {relativeTime(matchTime, now)}</span>
								</span>
							{/if}
							{#if row.done}<span class="up-done">✓ scouted</span>{/if}
						</a>
						<button
							type="button"
							class="up-expand"
							aria-expanded={open}
							aria-label="Show the rest of Q{row.match}"
							onclick={() => toggle(row.match)}
						>{open ? '▾' : '▸'}</button>
					</div>
					{#if open}
						{@render detail(lineup(row.match), row.match)}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#snippet detail(teams, matchNumber)}
	<div class="md-panel">
		{#if teams.length === 0}
			<p class="muted small md-empty">That match isn't in the pulled schedule.</p>
		{:else}
			<ul class="md-list">
				{#each teams as x (x.color + ':' + x.team)}
					<li class="md-row" data-color={x.color} class:mine={x.isMine}>
						<span class="md-color">{x.color}</span>
						<span class="md-team">{x.team}</span>
						{#if x.isMine}<span class="md-tag">yours</span>{/if}
						<span class="md-status {x.status}">
							{#if x.status === 'submitted'}
								✓ scouted{#if x.count > 1} ×{x.count}{/if}
							{:else if x.status === 'assigned'}
								assigned
							{:else}
								uncovered
							{/if}
						</span>
						<a
							class="md-scout"
							href={hrefFor({ match: matchNumber, team: x.team, color: x.color })}
						>{x.status === 'submitted' ? 'Re-scout →' : 'Scout →'}</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/snippet}

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

	/* ── view toggle ────────────────────────────────────────────────── */
	.view-toggle {
		display: flex;
		gap: var(--space-2);
		margin: 0 0 var(--space-3);
	}
	.vt-btn {
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		padding: var(--space-2) var(--space-3);
		min-height: 2.75rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border-strong);
		background: var(--bg-card);
		color: var(--text-muted);
		cursor: pointer;
	}
	.vt-btn.selected {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}

	/* ── upcoming matches list ──────────────────────────────────────── */
	.upcoming {
		list-style: none;
		padding: 0;
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.upcoming-row {
		border: 1px solid var(--border);
		border-left: 4px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
	}
	.upcoming-row[data-color='red'] { border-left-color: var(--alliance-red); }
	.upcoming-row[data-color='blue'] { border-left-color: var(--alliance-blue); }
	.upcoming-row.done { opacity: 0.55; }
	.upcoming-row.has-mine { border-left-color: var(--accent); }
	.row-main { display: flex; align-items: stretch; }
	.upcoming-link {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		color: inherit;
		text-decoration: none;
		flex-wrap: wrap;
		flex: 1 1 auto;
		min-width: 0;
	}
	.upcoming-link:hover { background: var(--bg-subtle); }
	.as-button {
		font: inherit;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.up-expand {
		font: inherit;
		flex: 0 0 auto;
		min-width: 2.75rem;
		background: none;
		border: none;
		border-left: 1px solid var(--border);
		color: var(--text-faint);
		cursor: pointer;
	}
	.up-expand:hover { background: var(--bg-subtle); color: var(--text-primary); }
	.up-match { font-weight: 700; color: var(--accent); min-width: 3rem; }
	.up-team { font-weight: 600; }
	.up-color { color: var(--text-muted); text-transform: capitalize; font-size: var(--fs-sm); }
	.up-lineup {
		display: inline-flex;
		gap: var(--space-2);
		align-items: baseline;
		flex-wrap: wrap;
		min-width: 0;
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-sm);
	}
	.side.red { color: var(--alliance-red); font-weight: 600; }
	.side.blue { color: var(--alliance-blue); font-weight: 600; }
	.up-vs { color: var(--text-faint); font-size: var(--fs-xs); }
	.up-yours {
		font-size: var(--fs-xs);
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.up-time {
		color: var(--text-muted);
		font-size: var(--fs-sm);
		margin-left: auto;
		white-space: nowrap;
	}
	.up-rel { color: var(--text-faint); font-size: var(--fs-xs); }
	.up-done {
		color: var(--success);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.up-caret { color: var(--text-faint); font-size: var(--fs-sm); }

	/* ── expanded match detail ──────────────────────────────────────── */
	.md-panel {
		border-top: 1px solid var(--border);
		background: var(--bg-subtle);
		padding: var(--space-2);
		border-radius: 0 0 var(--radius-md) var(--radius-md);
	}
	.md-empty { margin: var(--space-1); }
	.md-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.md-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		border: 1px solid var(--border);
		font-size: var(--fs-sm);
	}
	.md-row.mine { border-color: var(--accent); }
	.md-color {
		text-transform: uppercase;
		font-size: var(--fs-xs);
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}
	.md-row[data-color='red'] .md-color { background: var(--alliance-red); color: var(--on-alliance); }
	.md-row[data-color='blue'] .md-color { background: var(--alliance-blue); color: var(--on-alliance); }
	.md-team { font-weight: 700; font-variant-numeric: tabular-nums; }
	.md-tag {
		font-size: var(--fs-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.md-status { font-size: var(--fs-xs); color: var(--text-muted); }
	.md-status.submitted { color: var(--success); font-weight: 600; }
	.md-status.uncovered { color: var(--warning); font-weight: 600; }
	.md-scout {
		margin-left: auto;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		white-space: nowrap;
		padding: var(--space-1);
	}

	.cov-rollup {
		margin: var(--space-1) 0 var(--space-3);
	}
	.cov-bar {
		height: 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.cov-bar-fill {
		display: block;
		height: 100%;
		background: var(--success);
		border-radius: var(--radius-pill);
		transition: width 240ms ease;
	}
	.cov-rollup-text {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.cov-rollup-text strong {
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
</style>
