<script>
	import { onMount } from 'svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { base } from '$app/paths';
	import { summarize } from '$lib/aggregate.js';
	import { scoreTeams, fmt } from '$lib/metrics.js';
	import { METRIC_FIELDS } from '$lib/form-config.js';
	import { session } from '$lib/session.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { rankForMove, rankBetween, ordered } from '$lib/picklist.js';
	import * as store from '$lib/picklist-store.js';
	import {
		fetchAndCacheAlliances,
		getCachedAlliances,
		publishAlliances,
		pullAlliances
	} from '$lib/tba.js';
	import { standingsByTeam, selectionStarted, nextAvailable, describe } from '$lib/alliances.js';
	import { relativeTime } from '$lib/format.js';

	let summary = $state(null);
	let loading = $state(true);
	let syncing = $state(false);
	let syncError = $state('');
	/** Local edits the server has not confirmed. Non-zero for a scout device
	 *  forever, by design — see syncNow(). */
	let pendingCount = $state(0);

	/**
	 * One row per team: { teamNumber, status, rank, updatedAt, pushedAt, ... }.
	 *
	 * Deliberately NOT two arrays of team numbers. The old shape was
	 * { primary: [...], doNotPick: [...] } in a single IndexedDB key, which is
	 * fine on one device and unsyncable across several: pushing it is
	 * last-write-wins over the whole list, so a phone holding the morning's
	 * copy erases an afternoon of ranking the moment someone taps anything.
	 * See src/lib/picklist.js.
	 */
	let rows = $state(/** @type {any[]} */ ([]));
	let weights = $state(Object.fromEntries(METRIC_FIELDS.map((m) => [m.key, 1])));

	let copyFlash = $state('');

	const eventCode = $derived(session.eventCode || '');
	const isManager = $derived(Boolean(session.managerToken));

	const primary = $derived(ordered(rows.filter((r) => r.status === 'pick')));
	const doNotPick = $derived(ordered(rows.filter((r) => r.status === 'avoid')));
	const teamsInList = $derived(new Set(rows.map((r) => r.teamNumber)));
	const availableTeams = $derived(
		summary ? summary.teams.filter((t) => !teamsInList.has(t.teamNumber)) : []
	);

	async function refresh() {
		summary = await summarize();
	}

	/** Re-read the local rows. Every mutation goes through here, so the list on
	 *  screen is always what is actually stored — never an optimistic guess. */
	async function reload() {
		rows = await store.localRows(eventCode);
		const w = await store.localWeights(eventCode);
		// Merge rather than replace: a metric added to form-config since these
		// weights were saved needs a default, not undefined.
		weights = {
			...Object.fromEntries(METRIC_FIELDS.map((m) => [m.key, 1])),
			...(w?.weights ?? {})
		};
	}

	/**
	 * Push local edits and pull everyone else's.
	 *
	 * Only managers can write — the RLS policy requires x-manager-token — so a
	 * scout device pulls and displays but never pushes. Its rows stay pending
	 * forever, which is correct: they are a local scratchpad, not the list.
	 */
	async function syncNow() {
		if (!eventCode || syncing) return;
		syncing = true;
		try {
			const { changed, pending, error } = await store.sync(eventCode, {
				managerToken: session.managerToken,
				updatedBy: session.scoutName
			});
			pendingCount = pending;
			// Only surface a failure that actually cost something. A pull error
			// with nothing pending means the list on screen is simply a few
			// seconds old, which is not worth a red banner during selection.
			syncError = pending > 0 ? error : '';
			if (changed) await reload();
		} catch (e) {
			syncError = e?.message ?? 'Could not reach the server.';
		} finally {
			syncing = false;
		}
	}

	/** Apply a change locally, show it immediately, then push in the background.
	 *
	 *  Awaiting the network here would put a round trip between a tap and the
	 *  list moving. Alliance selection runs faster than that. */
	async function mutate(fn) {
		await fn();
		await reload();
		syncNow();
	}

	onMount(async () => {
		await refresh();
		await store.migrateLegacy(eventCode);
		await store.rebalanceIfNeeded(eventCode);
		await reload();
		await loadAlliances();
		loading = false;
		syncNow();
	});

	// Reload when the user switches events in Identity.
	$effect(() => {
		eventCode;
		if (!loading) {
			(async () => {
				await store.migrateLegacy(eventCode);
				await reload();
				alliancesRaw = null;
				alliancesAt = '';
				await loadAlliances();
				syncNow();
			})();
		}
	});

	// Re-aggregate and re-pull when the entry sync tick brings new rows. The
	// picklist rides that tick rather than running a second timer.
	$effect(() => {
		syncState.inboundChanges;
		syncState.lastSyncedAt;
		if (!loading) {
			refresh();
			syncNow();
		}
	});

	// ─── mutations ─────────────────────────────────────────────────────────────

	const addToPick = (teamNumber) =>
		mutate(() =>
			store.put(eventCode, teamNumber, {
				status: 'pick',
				rank: store.appendRank(rows)
			})
		);

	const removeFromPick = (teamNumber) => mutate(() => store.remove(eventCode, teamNumber));

	/** Move one team by one position. One row is written, never the whole list —
	 *  that is the entire reason rank is a float. */
	function move(teamNumber, delta) {
		const idx = primary.findIndex((r) => r.teamNumber === teamNumber);
		if (idx === -1) return;
		const rank = rankForMove(primary, teamNumber, idx + delta);
		if (rank === null) return;
		return mutate(() => store.put(eventCode, teamNumber, { rank }));
	}

	const avoid = (teamNumber) =>
		mutate(() =>
			store.put(eventCode, teamNumber, {
				status: 'avoid',
				rank: rankBetween(doNotPick.length ? doNotPick[doNotPick.length - 1].rank : null, null)
			})
		);

	const unavoid = (teamNumber) => mutate(() => store.remove(eventCode, teamNumber));

	function teamFor(n) {
		return summary?.teams.find((t) => t.teamNumber === n);
	}

	// ─── weighted scoring ──────────────────────────────────────────────────────
	//
	// The manager sets a weight per metric; the engine normalizes each team's
	// mean against the pool and combines them. This only ever *suggests* an
	// order — the manual list above is authoritative, because the numbers can't
	// see a robot that just looks fragile.

	let showScored = $state(false);
	let weightsDirty = $state(false);

	const scored = $derived.by(() => {
		if (!summary || !showScored) return [];
		const pool = availableTeams.map((t) => ({
			teamNumber: t.teamNumber,
			metrics: t.metrics
		}));
		return scoreTeams(pool, weights)
			.map((r) => ({ ...r, team: teamFor(r.teamNumber) }))
			.filter((r) => r.team);
	});

	const anyWeight = $derived(METRIC_FIELDS.some((m) => (weights[m.key] ?? 0) > 0));

	// Weights are a knob, not data: saving on every pixel of slider travel would
	// write a hundred times per drag. Flagged here, flushed below.
	$effect(() => {
		weights;
		if (!loading) weightsDirty = true;
	});

	$effect(() => {
		if (!weightsDirty) return;
		const id = setTimeout(async () => {
			weightsDirty = false;
			await store.putWeights(eventCode, $state.snapshot(weights));
		}, 400);
		return () => clearTimeout(id);
	});

	async function copyText() {
		const lines = [`Picklist · ${eventCode || 'event'}`];
		lines.push('');
		lines.push('Primary:');
		primary.forEach((r, i) => lines.push(`  ${i + 1}. Team ${r.teamNumber}`));
		if (doNotPick.length > 0) {
			lines.push('');
			lines.push('Do not pick:');
			doNotPick.forEach((r) => lines.push(`  • Team ${r.teamNumber}`));
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
			body:
				'Both the ranked list and the do-not-pick list are emptied, ' +
				"for everyone on this event's picklist — not just this device.\n\n" +
				'This cannot be undone.',
			confirmLabel: 'Clear picklist',
			danger: true
		});
		if (!ok) return;
		await mutate(() => store.clearAll(eventCode));
	}

	// ─── alliance selection ────────────────────────────────────────────────────
	//
	// During selection the picklist's job changes. Ranking is done; the only
	// question is "who on our list is still available", and it changes every
	// ninety seconds. TBA publishes alliances as they form, so this is a fetch.

	/** Raw TBA payload, cached locally so a wifi dropout mid-selection doesn't
	 *  blank the board. */
	let alliancesRaw = $state(/** @type {any[]|null} */ (null));
	let alliancesAt = $state('');
	let alliancesBusy = $state(false);
	let alliancesError = $state('');
	let clock = $state(new Date());

	const standings = $derived(standingsByTeam(alliancesRaw));
	const selectionLive = $derived(selectionStarted(alliancesRaw));
	const upNext = $derived(selectionLive ? nextAvailable(primary, standings) : null);
	const takenFromList = $derived(primary.filter((r) => standings.has(r.teamNumber)).length);

	/** Local cache first so the board paints instantly, then whatever the
	 *  manager last published — which is the only source a device without a TBA
	 *  key has. */
	async function loadAlliances() {
		const cached = await getCachedAlliances(eventCode);
		if (cached) {
			alliancesRaw = cached.alliances;
			alliancesAt = cached.fetchedAt;
		}
		const pulled = await pullAlliances(eventCode);
		if (pulled && (!alliancesAt || pulled.fetchedAt > alliancesAt)) {
			alliancesRaw = pulled.alliances;
			alliancesAt = pulled.fetchedAt;
		}
	}

	/**
	 * Refresh the board.
	 *
	 * With a TBA key: ask TBA, then publish so the rest of the table sees it.
	 * Without one: pull whatever the key-holder last published. Both paths are
	 * the same button, because "check now" is what the user means either way and
	 * which of the two runs is an implementation detail they should not have to
	 * hold in their head during selection.
	 */
	async function refreshAlliances() {
		if (alliancesBusy || !eventCode) return;
		alliancesBusy = true;
		alliancesError = '';
		try {
			if (session.tbaApiKey?.trim()) {
				alliancesRaw = await fetchAndCacheAlliances(
					eventCode,
					session.tbaApiKey,
					session.tbaEventKey
				);
				alliancesAt = new Date().toISOString();
				// Best-effort. The local answer is already right on this device.
				publishAlliances(eventCode, alliancesRaw, { managerToken: session.managerToken });
			} else {
				const pulled = await pullAlliances(eventCode);
				if (pulled) {
					alliancesRaw = pulled.alliances;
					alliancesAt = pulled.fetchedAt;
				} else {
					alliancesError =
						'Nothing published yet. Whoever has the TBA API key needs to check first.';
				}
			}
		} catch (e) {
			// Keep whatever was cached. A stale board beats a blank one.
			alliancesError = e?.message ?? 'Could not reach The Blue Alliance.';
		} finally {
			alliancesBusy = false;
		}
	}

	$effect(() => {
		const id = setInterval(() => (clock = new Date()), 30_000);
		return () => clearInterval(id);
	});

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
		<a class="back" href="{base}/insights/" aria-label="Back to insights">←</a>
		<h1>Picklist</h1>
		{#if eventCode}<small class="event">· {eventCode}</small>{/if}
	</header>

	<!-- Who can change this list, and whether the change has landed. Both are
	     things a manager needs to know before alliance selection, not during. -->
	<p class="share" class:ro={!isManager}>
		{#if isManager}
			Shared with everyone on <strong>{eventCode || 'this event'}</strong>.
			{#if syncing}
				Saving…
			{:else if pendingCount > 0}
				<span class="stale">
					{pendingCount} {pendingCount === 1 ? 'change' : 'changes'} not saved yet — retrying.
				</span>
			{/if}
		{:else}
			Read-only on this device. Enter the manager passphrase on
			<a href="{base}/scouting/">Scouting</a> to edit the shared list.
		{/if}
	</p>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if (!summary || summary.totalEntries === 0) && rows.length === 0}
		<div class="empty">
			<p>No entries on file. Record some entries first, then come back to build a picklist.</p>
		</div>
	{:else}
		<!-- ── Alliance selection ───────────────────────────────────── -->
		<section class="block sel" class:live={selectionLive}>
			<div class="block-head">
				<h2>{selectionLive ? 'Selection in progress' : 'Alliance selection'}</h2>
				<div class="block-actions">
					{#if alliancesAt}
						<small class="muted">checked {relativeTime(alliancesAt, clock)}</small>
					{/if}
					<button class="link-btn" onclick={refreshAlliances} disabled={alliancesBusy}>
						{alliancesBusy ? 'Checking…' : 'Check now'}
					</button>
				</div>
			</div>

			{#if alliancesError}
				<p class="sel-err">
					{alliancesError}
					{#if alliancesAt}Showing the list from {relativeTime(alliancesAt, clock)}.{/if}
				</p>
			{/if}

			{#if !selectionLive}
				<p class="muted hint">
					{#if alliancesAt}
						Not started yet. Check again when captains are called.
					{:else}
						Once selection starts, check here to see which of your picks are gone.
					{/if}
				</p>
			{:else}
				<!-- The one number that matters when it is your turn. -->
				{#if upNext}
					<p class="up-next">
						<span class="up-label">Best still available</span>
						<strong class="up-team">Team {upNext.teamNumber}</strong>
						<span class="up-rank">#{primary.findIndex((r) => r.teamNumber === upNext.teamNumber) + 1} on your list</span>
					</p>
				{:else if primary.length > 0}
					<p class="up-next none">Every team on your list is taken.</p>
				{/if}
				<p class="muted small">
					{takenFromList} of your {primary.length}
					{primary.length === 1 ? 'pick' : 'picks'} taken.
					<!-- Stated rather than implied: a declined team is out of selection
					     entirely under FRC rules, and "declined" reads like "available". -->
					Teams that declined an invitation are gone too.
				</p>
			{/if}
		</section>

		<!-- ── Primary picklist ─────────────────────────────────────── -->
		<section class="block">
			<div class="block-head">
				<h2>Primary picks <small class="count">({primary.length})</small></h2>
				<div class="block-actions">
					<button class="link-btn" onclick={copyText} disabled={primary.length === 0 && doNotPick.length === 0}>
						Copy as text
					</button>
					<button
						class="link-btn danger-link"
						onclick={clearAll}
						disabled={!isManager || (primary.length === 0 && doNotPick.length === 0)}
					>
						Clear
					</button>
				</div>
			</div>
			{#if copyFlash}<small class="muted">{copyFlash}</small>{/if}
			{#if primary.length === 0}
				<p class="hint muted">Pick teams from the available list below to start ranking.</p>
			{:else}
				<ol class="picked">
					{#each primary as r, i (r.teamNumber)}
						{@const t = teamFor(r.teamNumber)}
						{@const gone = standings.get(r.teamNumber)}
						<li class:taken={gone}>
							<span class="rank">{i + 1}</span>
							<span class="team-num">Team {r.teamNumber}</span>
							{#if gone}
								<!-- Struck through AND labelled. Colour and weight alone
								     would be the only signal, which fails under gym glare
								     and for colourblind users. -->
								<span class="gone">{describe(gone)}</span>
							{:else if t}
								<span class="ministats">{t.entryCount}e · {t.matchesCovered}m{#if t.breakdownCount > 0} · {t.breakdownCount}b{/if}</span>
							{:else}
								<span class="ministats muted">no entries on this device</span>
							{/if}
							<div class="ops">
								<button
									onclick={() => move(r.teamNumber, -1)}
									disabled={i === 0 || !isManager}
									aria-label="Move Team {r.teamNumber} up"
								>↑</button>
								<button
									onclick={() => move(r.teamNumber, 1)}
									disabled={i === primary.length - 1 || !isManager}
									aria-label="Move Team {r.teamNumber} down"
								>↓</button>
								<button
									class="danger-btn"
									onclick={() => removeFromPick(r.teamNumber)}
									disabled={!isManager}
									aria-label="Remove Team {r.teamNumber} from the picklist"
								>×</button>
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
					{#each doNotPick as r (r.teamNumber)}
						{@const t = teamFor(r.teamNumber)}
						<li>
							<span class="team-num">Team {r.teamNumber}</span>
							{#if t}
								<span class="ministats">{t.entryCount}e{#if t.breakdownCount > 0} · {t.breakdownCount}b{/if}</span>
							{/if}
							<button class="link-btn" onclick={() => unavoid(r.teamNumber)} disabled={!isManager}>
								Remove
							</button>
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
								<button onclick={() => addToPick(s.teamNumber)} disabled={!isManager}>Pick</button>
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
						{@const gone = standings.get(t.teamNumber)}
						<li class:taken={gone}>
							<span class="team-num">Team {t.teamNumber}</span>
							{#if gone}
								<span class="gone">{describe(gone)}</span>
							{/if}
							<span class="ministats">
								{t.entryCount} {t.entryCount === 1 ? 'entry' : 'entries'}
								{#if t.breakdownCount > 0} · {t.breakdownCount} broken{/if}
								{#if t.discrepancyCount > 0} · ⚠ {t.discrepancyCount}{/if}
							</span>
							<div class="ops">
								<a class="peek" href="{base}/insights/team/{t.teamNumber}/" title="Open team page">peek</a>
								<button
									onclick={() => addToPick(t.teamNumber)}
									disabled={!isManager}
									aria-label="Add Team {t.teamNumber} to the picklist"
								>Pick</button>
								<button
									class="warn-btn"
									onclick={() => avoid(t.teamNumber)}
									disabled={!isManager}
									aria-label="Mark Team {t.teamNumber} do-not-pick"
								>Avoid</button>
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

	.share {
		margin: 0 0 var(--space-4);
		padding: var(--space-2) var(--space-3);
		font-size: var(--fs-sm);
		color: var(--text-muted);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.share.ro { background: var(--warning-bg); border-color: var(--warning-border); color: var(--warning); }
	.share a { color: inherit; font-weight: 600; }
	.stale { color: var(--danger); }

	/* ── alliance selection ───────────────────────────── */
	.sel.live { border-color: var(--accent); background: var(--accent-soft); }
	.sel .block-actions { align-items: baseline; gap: var(--space-3); }
	.sel-err { margin: 0 0 var(--space-2); font-size: var(--fs-sm); color: var(--danger); }

	.up-next {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
	}
	.up-label {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.up-team { font-size: var(--fs-xl); color: var(--accent); font-variant-numeric: tabular-nums; }
	.up-rank { font-size: var(--fs-sm); color: var(--text-muted); }
	.up-next.none { color: var(--warning); font-weight: 600; }

	/* A team already on an alliance. Dimmed, struck through AND labelled —
	   three signals, because this one gets read across a table under gym
	   lighting by someone who has ninety seconds. */
	li.taken { opacity: 0.55; }
	li.taken .team-num { text-decoration: line-through; }
	.gone {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
		color: var(--danger);
		margin-right: auto;
	}

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
