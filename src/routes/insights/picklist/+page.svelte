<script>
	import { onMount } from 'svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { scoreTeams, fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { getSetting, setSetting } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';

	let summary = $state(null);
	let loading = $state(true);

	/** Ranked team numbers, in pick order. Persisted per-event. */
	let primary = $state([]);
	/** Teams the strategy team has explicitly marked "do not pick". */
	let doNotPick = $state([]);

	let copyFlash = $state('');

	const settingKey = $derived(
		`picklist:${(session.eventCode || 'event').toLowerCase()}`
	);

	const teamsInList = $derived(new Set([...primary, ...doNotPick]));
	const availableTeams = $derived.by(() => {
		if (!summary) return [];
		return summary.teams.filter((t) => !teamsInList.has(t.teamNumber));
	});

	async function refresh() {
		summary = await summarize();
	}

	async function loadList() {
		const stored = await getSetting(settingKey);
		if (stored && typeof stored === 'object') {
			primary = Array.isArray(stored.primary) ? stored.primary.slice() : [];
			doNotPick = Array.isArray(stored.doNotPick) ? stored.doNotPick.slice() : [];
			// Merge rather than replace: a metric added to form-config since this
			// list was saved needs a default weight, not undefined.
			weights = {
				...Object.fromEntries(METRIC_FIELDS.map((m) => [m.key, 1])),
				...(stored.weights ?? {})
			};
		} else {
			primary = [];
			doNotPick = [];
			weights = Object.fromEntries(METRIC_FIELDS.map((m) => [m.key, 1]));
		}
	}

	async function saveList() {
		await setSetting(settingKey, {
			eventCode: session.eventCode,
			primary,
			doNotPick,
			weights,
			updatedAt: new Date().toISOString()
		});
	}

	onMount(async () => {
		await refresh();
		await loadList();
		loading = false;
	});

	// Reload the picklist whenever the user switches events in Identity.
	$effect(() => {
		settingKey;
		if (!loading) loadList();
	});

	// Auto-save on every list mutation. Cheap; the storage is local.
	$effect(() => {
		primary;
		doNotPick;
		weights;
		if (!loading) saveList();
	});

	// Re-aggregate when sync brings new rows.
	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});

	function addToPick(teamNumber) {
		if (primary.includes(teamNumber)) return;
		// If team is currently on the do-not-pick list, move it off.
		doNotPick = doNotPick.filter((n) => n !== teamNumber);
		primary = [...primary, teamNumber];
	}

	function removeFromPick(teamNumber) {
		primary = primary.filter((n) => n !== teamNumber);
	}

	function moveUp(idx) {
		if (idx <= 0) return;
		const next = primary.slice();
		[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
		primary = next;
	}

	function moveDown(idx) {
		if (idx >= primary.length - 1) return;
		const next = primary.slice();
		[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
		primary = next;
	}

	function avoid(teamNumber) {
		if (doNotPick.includes(teamNumber)) return;
		primary = primary.filter((n) => n !== teamNumber);
		doNotPick = [...doNotPick, teamNumber];
	}

	function unavoid(teamNumber) {
		doNotPick = doNotPick.filter((n) => n !== teamNumber);
	}

	function teamFor(n) {
		return summary?.teams.find((t) => t.teamNumber === n);
	}

	// ─── weighted scoring ──────────────────────────────────────────────────────
	//
	// The manager sets a weight per metric; the engine normalizes each team's
	// mean against the pool and combines them. This only ever *suggests* an
	// order — the manual list above is authoritative, because the numbers can't
	// see a robot that just looks fragile.

	/** metric key → 0..3 weight. Persisted alongside the picklist. */
	let weights = $state(Object.fromEntries(METRIC_FIELDS.map((m) => [m.key, 1])));
	let showScored = $state(false);

	const scored = $derived.by(() => {
		if (!summary || !showScored) return [];
		const pool = availableTeams.map((t) => ({
			teamNumber: t.teamNumber,
			metrics: t.metrics
		}));
		const ranked = scoreTeams(pool, weights);
		return ranked
			.map((r) => ({ ...r, team: teamFor(r.teamNumber) }))
			.filter((r) => r.team);
	});

	const anyWeight = $derived(METRIC_FIELDS.some((m) => (weights[m.key] ?? 0) > 0));

	async function copyText() {
		const lines = [`Picklist · ${session.eventCode || 'event'}`];
		lines.push('');
		lines.push('Primary:');
		primary.forEach((n, i) => lines.push(`  ${i + 1}. Team ${n}`));
		if (doNotPick.length > 0) {
			lines.push('');
			lines.push('Do not pick:');
			doNotPick.forEach((n) => lines.push(`  • Team ${n}`));
		}
		const text = lines.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			copyFlash = 'Copied to clipboard.';
			setTimeout(() => (copyFlash = ''), 1800);
		} catch (_e) {
			copyFlash = 'Could not copy automatically — select and copy the text below.';
		}
	}

	async function clearAll() {
		const ok = await dialog.confirm({
			title: 'Clear the whole picklist?',
			body: 'Both the ranked list and the do-not-pick list are emptied. This cannot be undone.',
			confirmLabel: 'Clear picklist',
			danger: true
		});
		if (!ok) return;
		primary = [];
		doNotPick = [];
	}

	let teamSearch = $state('');
	const filteredAvailable = $derived(
		teamSearch.trim()
			? availableTeams.filter((t) => String(t.teamNumber).includes(teamSearch.trim()))
			: availableTeams
	);
</script>

<svelte:head>
	<title>Picklist · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/insights/" aria-label="Back to manager">←</a>
		<h1>Picklist</h1>
		{#if session.eventCode}<small class="event">· {session.eventCode}</small>{/if}
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if !summary || summary.totalEntries === 0}
		<div class="empty">
			<p>No entries on file. Import or record entries first, then come back to build a picklist.</p>
		</div>
	{:else}
		<!-- ── Primary picklist ─────────────────────────────────────── -->
		<section class="block">
			<div class="block-head">
				<h2>Primary picks <small class="count">({primary.length})</small></h2>
				<div class="block-actions">
					<button class="link-btn" onclick={copyText} disabled={primary.length === 0 && doNotPick.length === 0}>
						Copy as text
					</button>
					<button class="link-btn danger-link" onclick={clearAll} disabled={primary.length === 0 && doNotPick.length === 0}>
						Clear
					</button>
				</div>
			</div>
			{#if copyFlash}<small class="muted">{copyFlash}</small>{/if}
			{#if primary.length === 0}
				<p class="hint muted">Pick teams from the available list below to start ranking.</p>
			{:else}
				<ol class="picked">
					{#each primary as n, i (n)}
						{@const t = teamFor(n)}
						<li>
							<span class="rank">{i + 1}</span>
							<span class="team-num">Team {n}</span>
							{#if t}
								<span class="ministats">{t.entryCount}e · {t.matchesCovered}m{#if t.breakdownCount > 0} · {t.breakdownCount}b{/if}</span>
							{:else}
								<span class="ministats muted">no entries on this device</span>
							{/if}
							<div class="ops">
								<button onclick={() => moveUp(i)} disabled={i === 0} title="Move up">↑</button>
								<button onclick={() => moveDown(i)} disabled={i === primary.length - 1} title="Move down">↓</button>
								<button class="danger-btn" onclick={() => removeFromPick(n)} title="Remove from picklist">×</button>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<!-- ── Do not pick ──────────────────────────────────────────── -->
		{#if doNotPick.length > 0}
			<section class="block">
				<h2 class="warn">Do not pick <small class="count">({doNotPick.length})</small></h2>
				<ul class="avoided">
					{#each doNotPick as n (n)}
						{@const t = teamFor(n)}
						<li>
							<span class="team-num">Team {n}</span>
							{#if t}
								<span class="ministats">{t.entryCount}e{#if t.breakdownCount > 0} · {t.breakdownCount}b{/if}</span>
							{/if}
							<button class="link-btn" onclick={() => unavoid(n)}>Remove</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- ── Scored suggestions ───────────────────────────────────── -->
		<section class="block">
			<div class="block-head">
				<h2>Suggested order</h2>
				<button class="link-btn" onclick={() => (showScored = !showScored)}>
					{showScored ? 'Hide' : 'Show'}
				</button>
			</div>

			{#if showScored}
				<div class="weights">
					{#each METRIC_FIELDS as m (m.key)}
						<label class="weight">
							<span class="w-label">
								{m.label}
								{#if m.higherIsBetter === false}<small class="w-inv">lower is better</small>{/if}
							</span>
							<input
								type="range"
								min="0"
								max="3"
								step="1"
								bind:value={weights[m.key]}
								aria-label="Weight for {m.label}"
							/>
							<span class="w-val">{weights[m.key] === 0 ? 'off' : '×' + weights[m.key]}</span>
						</label>
					{/each}
				</div>

				{#if !anyWeight}
					<p class="muted">Turn at least one metric on to rank.</p>
				{:else if scored.length === 0}
					<p class="muted">No unpicked teams to rank.</p>
				{:else}
					<ol class="scored">
						{#each scored.slice(0, 12) as s (s.teamNumber)}
							<li>
								<span class="team-num">Team {s.teamNumber}</span>
								<span class="score-bar" aria-hidden="true">
									<span class="score-fill" style="width: {Math.max(0, s.score) * 100}%"></span>
								</span>
								<span class="score-val">{fmt(s.score * 100, 0)}</span>
								{#if s.confidence < 0.5}
									<span class="thin" title="Fewer than 3 readings on most metrics">thin</span>
								{/if}
								<button onclick={() => addToPick(s.teamNumber)}>Pick</button>
							</li>
						{/each}
					</ol>
					<p class="muted small">
						Scores are relative to the teams still available, not an absolute rating.
					</p>
				{/if}
			{/if}
		</section>

		<!-- ── Available teams ──────────────────────────────────────── -->
		<section class="block">
			<div class="block-head">
				<h2>Available teams <small class="count">({availableTeams.length})</small></h2>
				<input
					class="search"
					type="text"
					inputmode="numeric"
					placeholder="Find team #"
					bind:value={teamSearch}
				/>
			</div>
			{#if filteredAvailable.length === 0}
				<p class="muted">No teams match.</p>
			{:else}
				<ul class="available">
					{#each filteredAvailable as t (t.teamNumber)}
						<li>
							<span class="team-num">Team {t.teamNumber}</span>
							<span class="ministats">
								{t.entryCount} {t.entryCount === 1 ? 'entry' : 'entries'}
								{#if t.breakdownCount > 0} · {t.breakdownCount} broken{/if}
								{#if t.discrepancyCount > 0} · ⚠ {t.discrepancyCount}{/if}
							</span>
							<div class="ops">
								<a class="peek" href="{base}/insights/team/{t.teamNumber}/" title="Open team page">peek</a>
								<button onclick={() => addToPick(t.teamNumber)} title="Add to primary picks">Pick</button>
								<button class="warn-btn" onclick={() => avoid(t.teamNumber)} title="Mark do-not-pick">Avoid</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 38rem;
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin: var(--space-4) 0 var(--space-2);
	}
	.back {
		font-size: var(--fs-xl);
		text-decoration: none;
		color: var(--accent);
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
	}
	.back:hover { background: var(--bg-subtle); }
	.back:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.event { color: var(--text-faint); font-size: var(--fs-sm); }
	.muted { color: var(--text-faint); }

	/* ── weighted scoring ─────────────────────────────── */
	.weights { display: grid; gap: var(--space-2); margin-bottom: var(--space-3); }
	.weight {
		display: grid;
		grid-template-columns: minmax(6rem, 9rem) 1fr 2.5rem;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-sm);
		min-height: var(--tap-min);
	}
	.w-label { display: flex; flex-direction: column; }
	.w-inv { font-size: var(--fs-xs); color: var(--text-faint); }
	.w-val {
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-xs);
		color: var(--text-muted);
		text-align: right;
	}
	.scored {
		list-style: none;
		counter-reset: rank;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.scored li {
		counter-increment: rank;
		display: grid;
		grid-template-columns: auto 1fr auto auto auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-subtle);
	}
	.scored li::before {
		content: counter(rank);
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		min-width: 1.2rem;
	}
	.scored .team-num { grid-column: 2; }
	.score-bar {
		grid-column: 2;
		grid-row: 2;
		height: 3px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}
	.score-fill { display: block; height: 100%; background: var(--accent); }
	.score-val { font-variant-numeric: tabular-nums; font-size: var(--fs-sm); font-weight: 600; }
	.thin {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-faint);
	}
	.small { font-size: var(--fs-xs); margin-top: var(--space-2); }
	.hint { font-size: var(--fs-md); }

	.empty {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}

	.block {
		margin-top: var(--space-4);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
	}
	.block-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-bottom: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	h2.warn { color: var(--warning); }
	.count { font-size: var(--fs-xs); color: var(--text-faint); margin-left: var(--space-1); }
	.block-actions { display: flex; gap: var(--space-2); }
	.link-btn {
		background: none;
		border: none;
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
		min-height: var(--tap-min);
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
	}
	.link-btn:hover { text-decoration: underline; }
	.link-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	.link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.danger-link { color: var(--danger); }

	.search {
		font: inherit;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		max-width: 9rem;
	}
	.search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

	.picked, .available, .avoided {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.picked li, .available li, .avoided li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}
	.rank { min-width: 1.5rem; font-weight: 700; color: var(--accent); }
	.team-num { font-weight: 600; min-width: 5rem; }
	.ministats { color: var(--text-muted); font-size: var(--fs-xs); flex: 1; }
	.ops { display: flex; gap: var(--space-1); flex-shrink: 0; }
	/* Draft day is the one place in the app where a manager taps repeatedly
	   under time pressure, so these get the tap floor even though they read
	   as small chips. */
	.ops button, .ops a {
		font: inherit;
		font-size: var(--fs-xs);
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-decoration: none;
		color: var(--text-primary);
	}
	.ops button:hover, .ops a:hover {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}
	.ops button:focus-visible, .ops a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.ops button:disabled { opacity: 0.4; cursor: not-allowed; }
	.ops .danger-btn:hover {
		background: var(--danger-bg);
		border-color: var(--danger);
		color: var(--danger);
	}
	.ops .warn-btn:hover {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.peek { font-size: var(--fs-xs); }
</style>
