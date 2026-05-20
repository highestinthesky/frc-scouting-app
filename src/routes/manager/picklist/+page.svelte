<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
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
		} else {
			primary = [];
			doNotPick = [];
		}
	}

	async function saveList() {
		await setSetting(settingKey, {
			eventCode: session.eventCode,
			primary,
			doNotPick,
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

	function clearAll() {
		if (!confirm('Clear the entire picklist for this event?')) return;
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
		<a class="back" href="{base}/manager/" aria-label="Back to manager">←</a>
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
								<a class="peek" href="{base}/manager/team/{t.teamNumber}/" title="Open team page">peek</a>
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
	main {
		max-width: 38rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin: 1rem 0 0.5rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	.event { color: var(--text-faint); font-size: 0.9rem; }
	.muted { color: var(--text-faint); }
	.hint { font-size: 0.92rem; }

	.empty {
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.block {
		margin-top: 1rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		padding: 0.7rem 0.85rem;
	}
	.block-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.4rem;
	}
	h2 {
		margin: 0;
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	h2.warn { color: #92400e; }
	.count { font-size: 0.78rem; color: var(--text-faint); margin-left: 0.3rem; }
	.block-actions { display: flex; gap: 0.5rem; }
	.link-btn {
		background: none;
		border: none;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent);
		cursor: pointer;
		padding: 0.25rem 0.4rem;
	}
	.link-btn:hover { text-decoration: underline; }
	.link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.danger-link { color: var(--danger); }

	.search {
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		max-width: 9rem;
	}

	.picked, .available, .avoided {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.picked li, .available li, .avoided li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.55rem;
		background: var(--bg-subtle);
		border-radius: 0.4rem;
		flex-wrap: wrap;
	}
	.rank {
		min-width: 1.5rem;
		font-weight: 700;
		color: var(--accent);
	}
	.team-num { font-weight: 600; min-width: 5rem; }
	.ministats { color: var(--text-muted); font-size: 0.82rem; flex: 1; }
	.ops { display: flex; gap: 0.3rem; flex-shrink: 0; }
	.ops button, .ops a {
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.3rem 0.55rem;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: 0.3rem;
		cursor: pointer;
		text-decoration: none;
		color: var(--text-primary);
	}
	.ops button:hover, .ops a:hover { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
	.ops button:disabled { opacity: 0.4; cursor: not-allowed; }
	.ops .danger-btn:hover { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
	.ops .warn-btn:hover { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
	.peek { font-size: 0.78rem; }
</style>
