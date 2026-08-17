<script>
	import MyAssignments from '$lib/components/scouting/MyAssignments.svelte';
	import { onMount } from 'svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { base } from '$app/paths';
	import { listEntries } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { syncState, withdrawEntry } from '$lib/sync.svelte.js';
	import {
		getCachedSchedule,
		qualMatches,
		nextUnscoutedMatch,
		allianceForTeamInMatch
	} from '$lib/tba.js';
	import { relativeTime } from '$lib/format.js';

	let entries = $state([]);
	let loading = $state(true);

	/** Cached qual matches for the current event — populated on mount and
	 *  refreshed when the sync layer brings new schedule data down. */
	let qmList = $state([]);
	/** Wallclock refreshed once a minute so "in 8 min" labels stay current. */
	let now = $state(new Date());

	async function refresh() {
		entries = await listEntries();
	}

	async function refreshSchedule() {
		const cached = session.eventCode
			? await getCachedSchedule(session.eventCode)
			: null;
		qmList = cached ? qualMatches(cached.matches) : [];
	}

	onMount(async () => {
		await Promise.all([refresh(), refreshSchedule()]);
		loading = false;
		const tickHandle = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(tickHandle);
	});

	// Re-read entries whenever the sync layer brings new peer rows.
	$effect(() => {
		syncState.inboundChanges; // tracked dependency
		if (!loading) refresh();
	});

	// Re-read the schedule cache when the event code changes, and (best-effort)
	// after each successful sync tick so a freshly-pulled schedule shows up
	// without a manual refresh.
	$effect(() => {
		syncState.lastSyncedAt;
		session.eventCode;
		if (!loading) refreshSchedule();
	});

	// ── next-match suggestion for the home banner ──────────────────────────────

	/** {match, teams} for the soonest match where any of my teams plays and
	 *  hasn't been recorded yet; null if nothing pending. */
	const nextSuggestion = $derived.by(() => {
		const teams = session.assignedTeams;
		const overrides = session.overrides ?? [];
		if (!qmList.length || (!teams.length && !overrides.length)) return null;
		return nextUnscoutedMatch(qmList, entries, {
			assignedTeams: teams,
			overrides,
			scout: auth.me
		});
	});

	const nextMatchTime = $derived(
		nextSuggestion?.match
			? nextSuggestion.match.predicted_time ?? nextSuggestion.match.time ?? null
			: null
	);

	function homeBannerHref() {
		if (!nextSuggestion) return `${base}/scouting/new/`;
		const { match, teams } = nextSuggestion;
		// If only one of my teams is in the match, pre-fill that team + the
		// schedule-correct alliance. Otherwise route to /new and let the
		// banner there do the multi-team chooser.
		if (teams.length === 1) {
			const t = teams[0];
			const color = allianceForTeamInMatch(match, t);
			const qp = new URLSearchParams({
				match: String(match.match_number),
				team: String(t),
				...(color ? { color } : {})
			});
			return `${base}/scouting/new/?${qp.toString()}`;
		}
		return `${base}/scouting/new/`;
	}

	// ── live entry counter ─────────────────────────────────────────────────────

	/** Entries that belong to the current event code (for the pace counter). */
	const eventEntries = $derived(
		session.eventCode
			? entries.filter((e) => e.eventCode === session.eventCode)
			: entries
	);

	/** Entries recorded today (local calendar date). */
	const todayEntries = $derived.by(() => {
		const today = new Date().toDateString();
		return eventEntries.filter((e) => new Date(e.createdAt).toDateString() === today);
	});

	// ── actions ────────────────────────────────────────────────────────────────

	/**
	 * Delete an entry.
	 *
	 * The old version called db.deleteEntry() and nothing else, and its own
	 * confirmation said so: "A copy already synced to your team stays with them."
	 * That was accurate and it was the bug — the row came back on the next pull,
	 * or lived on every teammate's phone for the rest of the event.
	 *
	 * withdrawEntry() writes the tombstone first and removes the local row only if
	 * that succeeds, so a refusal leaves the entry visibly present rather than
	 * silently gone here and alive everywhere else.
	 */
	async function remove(entry, summary) {
		const synced = Boolean(entry.remoteId);
		const ok = await dialog.confirm({
			title: 'Delete this entry?',
			body: synced
				? `${summary}\n\nThis removes it for the whole team, not just this device. Only a manager of this event can do that.`
				: `${summary}\n\nThis entry has not synced yet, so it only exists on this device.`,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		const res = await withdrawEntry(entry);
		if (!res.ok) {
			await dialog.confirm({
				title: 'Not deleted',
				body: res.message,
				confirmLabel: 'OK'
			});
			return;
		}
		await refresh();
	}
</script>

<svelte:head>
	<title>Scouting · FRC Scout</title>
</svelte:head>

<main>
	<!-- The draft asks Home to greet you and act as a directory. The greeting is
	     the cheapest possible proof that signing in did something — before this,
	     a signed-in device looked identical to one that was not. -->
	<p class="greet">
		{#if auth.displayName}
			Welcome back, <strong>{auth.displayName}</strong>.
		{:else}
			Welcome.
		{/if}
	</p>

	<!-- The next match is the only thing a scout needs the instant they open
	     the app, so it leads — above the page title, not below it. -->
	{#if nextSuggestion}
		{@const teams = nextSuggestion.teams}
		{@const m = nextSuggestion.match}
		{@const singleColor = teams.length === 1 ? allianceForTeamInMatch(m, teams[0]) : null}
		<a class="home-next" data-color={singleColor} href={homeBannerHref()}>
			<div class="next-body">
				<strong class="next-label">Next match</strong>
				<span class="next-detail">
					Q{m.match_number}
					{#if teams.length === 1}
						· Team {teams[0]}
						{#if singleColor} · {singleColor}{/if}
					{:else}
						· {teams.length} of your teams
					{/if}
					{#if nextMatchTime}
						<span class="next-time">· {relativeTime(nextMatchTime, now)}</span>
					{/if}
				</span>
			</div>
			<span class="next-go">Scout →</span>
		</a>
	{/if}

	<div class="top">
		<div class="titles">
			<h1>Scouting</h1>

	<!-- Assignments first: what a scout is meant to record comes before the record
	     of what they already did. -->
	<MyAssignments />
			{#if !loading && entries.length > 0}
				<p class="pace">
					{eventEntries.length}
					{eventEntries.length === 1 ? 'entry' : 'entries'} this event
					{#if todayEntries.length > 0}
						· <strong>{todayEntries.length}</strong> today
					{/if}
				</p>
			{/if}
		</div>
		<a class="cta" href="{base}/scouting/new/">+ New</a>
	</div>

	{#if loading}
		<p class="muted">Loading…</p>

	{:else if entries.length === 0}
		<div class="empty">
			<p class="empty-title">No entries yet</p>
			<p class="muted">Tap <strong>+ New</strong> to scout your first robot.</p>
		</div>

	{:else}
		<ul class="entries">
			{#each entries as e (e.id)}
				<li class="entry" data-color={e.allianceColor}>
					<div class="row">
						<!-- Tapping the identity area navigates to the edit page -->
						<a class="entry-link" href="{base}/scouting/edit/?id={e.id}" aria-label="Edit entry Q{e.matchNumber} · Team {e.teamNumber}">
							<span class="match">Q{e.matchNumber}</span>
							<span class="team">Team {e.teamNumber}</span>
							<span class="alliance">{e.allianceColor}</span>
						</a>
						<button
							class="delete"
							aria-label="Delete entry Q{e.matchNumber} · Team {e.teamNumber}"
							onclick={() => remove(e, `Q${e.matchNumber} · Team ${e.teamNumber}`)}
						>
							×
						</button>
					</div>
					{#if e.observations}
						{#if e.observations.strengths}
							<p><strong>+</strong> {e.observations.strengths}</p>
						{/if}
						{#if e.observations.weaknesses}
							<p><strong>−</strong> {e.observations.weaknesses}</p>
						{/if}
						{#if e.observations.defense}
							<p><strong>D</strong> {e.observations.defense}</p>
						{/if}
						{#if e.observations.brokeDown === true}
							<p class="brokedown"><strong>!</strong> Broke down</p>
						{/if}
						{#if e.observations.comments}
							<p><strong>·</strong> {e.observations.comments}</p>
						{/if}
						{#if e.observations.failures && e.observations.brokeDown === undefined}
							<p><strong>!</strong> {e.observations.failures}</p>
						{/if}
					{/if}
					<small class="muted timestamp">
						{e.scoutName} · {new Date(e.createdAt).toLocaleString()}
						<span class="edit-hint">Tap to edit</span>
					</small>
				</li>
			{/each}
		</ul>
	{/if}
	<!-- The directory that stood here is gone. It listed Scouting (this page),
	     Insights, Accounts and Settings — after v0.73 the first is circular, the
	     middle two live in Studio behind the button in the bar, and Settings is a
	     tab. A directory whose every row is already one tap away is furniture.
	     This page is now only what a scout came here to do. -->
</main>

<style>
	.greet {
		margin: 0 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--fs-md);
	}
	.greet strong { color: var(--text-primary); }
	.directory {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-6);
	}
	.directory a {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-height: var(--tap-min);
		padding: var(--space-3) var(--space-4);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		text-decoration: none;
	}
	.directory a:hover { border-color: var(--accent); }
	.directory small { color: var(--text-faint); font-size: var(--fs-sm); }
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: var(--w-list); /* An entry list. More rows visible is the point, and on a phone it is capped by the viewport anyway. */
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: var(--space-3);
		margin: var(--space-4) 0 var(--space-3);
	}
	.titles { min-width: 0; }
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.muted { color: var(--text-faint); }

	/* A link, not a button — it navigates. Styled to match Button's primary
	   variant, including the tap floor, because it is the same affordance. */
	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-4);
		background: var(--accent);
		color: var(--on-accent);
		text-decoration: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: var(--fs-md);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.cta:hover { background: var(--accent-hover); }
	.cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

	/* ── next-match banner ───────────────────────────────────────── */
	.home-next {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--tap-min);
		padding: var(--space-3);
		margin: var(--space-4) 0 0;
		border-radius: var(--radius-lg);
		border: 1.5px solid var(--banner-info-border);
		background: var(--banner-info-bg);
		color: inherit;
		text-decoration: none;
	}
	.home-next[data-color='red'] {
		background: var(--banner-red-bg);
		border-color: var(--banner-red-border);
	}
	.home-next[data-color='blue'] {
		background: var(--banner-blue-bg);
		border-color: var(--banner-blue-border);
	}
	.home-next:hover { filter: brightness(0.98); }
	.home-next:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.next-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1 1 auto;
	}
	.next-label {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.next-detail {
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text-primary);
	}
	.next-time { font-weight: 400; color: var(--text-muted); }
	.next-go {
		font-weight: 700;
		color: var(--accent);
		font-size: var(--fs-md);
		white-space: nowrap;
	}

	/* ── pace counter ─────────────────────────────────────────────── */
	.pace {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.pace strong { color: var(--accent); }

	/* ── entry list ───────────────────────────────────────────────── */
	.empty {
		margin-top: var(--space-6);
		text-align: center;
		padding: var(--space-6) var(--space-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
	}
	.empty-title { margin: 0 0 var(--space-2); font-weight: 600; font-size: var(--fs-lg); }
	.empty .muted { margin: 0; font-size: var(--fs-md); }

	.entries {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.entry {
		border: 1px solid var(--border);
		border-left: 4px solid var(--border-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		background: var(--bg-card);
	}
	.entry[data-color='red'] { border-left-color: var(--alliance-red); }
	.entry[data-color='blue'] { border-left-color: var(--alliance-blue); }

	/* ── tappable entry link ──────────────────────────────────────── */
	.row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--fs-md);
	}
	.entry-link {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex: 1 1 0;
		min-width: 0;
		min-height: var(--tap-min);
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
		margin: 0 calc(-1 * var(--space-1));
	}
	.entry-link:hover { background: var(--bg-subtle); }
	.entry-link:focus-visible { outline: 2px solid var(--accent); }
	.match { font-weight: 700; color: var(--accent); }
	.team { font-weight: 600; }
	.alliance {
		text-transform: capitalize;
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}
	/* 44px square. The old 0.1rem × 0.5rem padding made destroying an entry a
	   16px target sitting next to a full-width link — easy to hit by accident
	   and hard to hit on purpose. Both wrong ways round. */
	.delete {
		background: transparent;
		border: none;
		font-size: var(--fs-xl);
		line-height: 1;
		color: var(--text-faint);
		cursor: pointer;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	.delete:hover { color: var(--danger); background: var(--bg-subtle); }
	.delete:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

	.entry p {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-md);
		line-height: 1.4;
	}
	.entry p strong {
		display: inline-block;
		width: 1rem;
		color: var(--accent);
	}
	.entry p.brokedown { color: var(--danger); font-weight: 600; }
	.entry p.brokedown strong { color: var(--danger); }

	.timestamp {
		display: block;
		margin-top: var(--space-2);
		font-size: var(--fs-xs);
	}
	.edit-hint { margin-left: var(--space-2); color: var(--text-faint); font-style: italic; }
</style>
