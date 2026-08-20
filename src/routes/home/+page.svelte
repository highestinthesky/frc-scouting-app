<script>
	// Hallmark · genre: modern-minimal · macrostructure: Workbench
	// design-system: design.md (locked — this page follows it, it does not differ)
	// enrichment: none — design.md forbids it on app pages; function carries it
	// contrast: AA pass, all four palettes
	//
	// Where a scout lands.
	//
	// The app used to open on /scouting, which is a list of what you have already
	// done. That is the wrong first thing: a scout opening the app in a gym is
	// asking "what now", and answering it with a history means they have to
	// derive the answer themselves, on a phone, between matches.
	//
	// So this page answers, in order, the three questions actually being asked:
	//
	//   1. am I up?           the next match with one of my teams, unrecorded
	//   2. has anyone told me anything?   reminders from a manager
	//   3. what am I watching?            my teams for the event
	//
	// ─── on "pretty" ──────────────────────────────────────────────────────────
	//
	// design.md § Per-page allowances: app pages must not use enrichment — no
	// hero art, no decorative SVG, no illustration. Function carries the page.
	// That rule is not suspended because this page is the friendly one, so the
	// warmth here is typographic: one large greeting in the display size, real
	// generosity of space around it, and everything below it quiet. A gradient
	// and an illustration would be the easy version and would make this the only
	// page in the app that looks like a different app.
	//
	// ─── and no invented numbers ──────────────────────────────────────────────
	//
	// design.md again: every number on screen traces to a recorded entry. The
	// counts below are computed from IndexedDB, and when there is nothing to
	// count the line is absent rather than showing a zero that looks like data.

	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listEntries } from '$lib/db.js';
	import { getCachedSchedule, qualMatches, myMatches } from '$lib/tba.js';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { reminders } from '$lib/reminders.svelte.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';
	import { greetingFor } from '$lib/greeting.js';
	import Button from '$lib/components/Button.svelte';

	let entries = $state([]);
	let qmList = $state([]);
	let loading = $state(true);
	/** Refreshed once a minute so "in 8 min" and the greeting stay honest. */
	let now = $state(new Date());

	async function refresh() {
		entries = await listEntries();
	}
	async function refreshSchedule() {
		const cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
		qmList = cached ? qualMatches(cached.matches) : [];
	}

	onMount(async () => {
		await Promise.all([refresh(), refreshSchedule()]);
		loading = false;
		const tick = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(tick);
	});

	$effect(() => {
		syncState.inboundChanges;
		if (!loading) refresh();
	});
	$effect(() => {
		syncState.lastSyncedAt;
		session.eventCode;
		if (!loading) refreshSchedule();
	});

	// ── the greeting ──────────────────────────────────────────────────────────
	//
	// greeting.js owns the choice, and owns the one hard constraint: `now` ticks
	// every 60 seconds to keep relative times honest, which re-runs this derived.
	// Anything seeded on the clock would reshuffle the greeting under whoever is
	// reading it. It is seeded on the day and the person instead.

	// auth.displayName, not session.scoutName. The typed name is the JOIN KEY and
	// may be a lowercase handle; this is the one place the app is speaking TO the
	// person rather than about their rows. scout-identity.js owns that split.
	const who = $derived(auth.displayName || session.scoutName || '');

	// ── what a scout is actually asking ───────────────────────────────────────

	const myTeams = $derived(session.assignedTeams ?? []);

	/**
	 * Every match I am on, with the team I am actually watching in each.
	 *
	 * myMatches() applies overrides; this page used to intersect the base
	 * assignment with the match roster itself and therefore showed both robots of
	 * a clash that had already been resolved. One resolver, in tba.js — see the
	 * note there about auto-assign.js depending on the same answer.
	 */
	const myRows = $derived.by(() => {
		if (!qmList.length) return [];
		return myMatches(qmList, entries, {
			assignedTeams: myTeams,
			overrides: session.overrides ?? [],
			scout: auth.me
		});
	});

	const greeting = $derived(greetingFor(now, who));

	const nextRow = $derived(myRows.find((r) => r.pending.length > 0) ?? null);
	const nextUp = $derived(
		nextRow ? { match: nextRow.match, teams: nextRow.pending } : null
	);

	/**
	 * When the next match is due, as a clock time.
	 *
	 * Derived here rather than with {@const} in the markup: {@const} has to be an
	 * immediate child of a block, which is a rule that already broke a build this
	 * series, and a derivation this small does not belong in the template anyway.
	 *
	 * The TBA value is passed RAW. format.js's toDate() already converts Unix
	 * seconds itself — multiplying by 1000 first happens to land in the right
	 * decade only because its seconds-vs-ms heuristic then catches the doubled
	 * number, which is not a thing to rely on.
	 */
	const nextWhen = $derived.by(() => {
		const m = nextUp?.match;
		if (!m) return null;
		return timeOfDay(m.predicted_time ?? m.time ?? null) || null;
	});

	/**
	 * Everything after the one I am on now that still needs recording.
	 *
	 * Not sliced here. A scout deciding whether they can leave the stand needs to
	 * know whether they are up in three matches or eleven, and a list truncated
	 * at four cannot answer that. The markup shows FIRST_FEW and offers the rest.
	 */
	const upcoming = $derived.by(() => {
		const from = nextUp?.match?.match_number ?? 0;
		return myRows.filter((r) => !r.done && (r.match.match_number ?? 0) > from);
	});

	/** How many of `upcoming` show before the scout asks for the rest. */
	const FIRST_FEW = 5;
	let showAllUpcoming = $state(false);
	const visibleUpcoming = $derived(
		showAllUpcoming ? upcoming : upcoming.slice(0, FIRST_FEW)
	);

	/**
	 * The one robot to watch in a match.
	 *
	 * A scout watches one robot; they cannot watch two. Where resolution still
	 * leaves more than one, that is a real unresolved clash — auto-assign.js
	 * counts the second as lost coverage — so the extra is named rather than
	 * dropped, and the first is what the link records.
	 *
	 * @param {{teams: number[], pending: number[]}} row
	 */
	const watchOne = (row) => (row.pending.length ? row.pending[0] : row.teams[0]);
	const clashCount = (row) => Math.max(0, row.teams.length - 1);

	/** Entries this device recorded today. Real rows only — see the header note. */
	const todayCount = $derived.by(() => {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		return entries.filter((e) => new Date(e.createdAt) >= start).length;
	});

	const fromManager = $derived((reminders.visible ?? []).filter((r) => r.kind === 'manager'));

	const newEntryHref = (matchNumber, teamNumber) =>
		`${base}/scouting/new/?match=${matchNumber ?? ''}&team=${teamNumber ?? ''}`;
</script>

<svelte:head><title>Home · FRC Scout</title></svelte:head>

<main>
	<!-- The one warm moment, carried by type rather than decoration. -->
	<header class="hello">
		<h1>
			{greeting}{#if who}, <span class="name">{who}</span>{/if}
		</h1>
		{#if session.eventCode}
			<p class="context">
				<span class="event">{session.eventCode}</span>
				{#if todayCount > 0}
					<span class="sep" aria-hidden="true">·</span>
					{todayCount} {todayCount === 1 ? 'entry' : 'entries'} recorded today
				{/if}
			</p>
		{/if}
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else}
		<!-- ── 1. am I up? ──────────────────────────────────────────────── -->
		<section class="up-next" class:ready={Boolean(nextUp)}>
			<h2>Up next</h2>
			{#if nextUp?.match}
				<div class="next-row">
					<div class="next-what">
						<span class="qm">Q{nextUp.match.match_number}</span>
						<span class="team">{watchOne(nextRow)}</span>
						{#if nextWhen}<span class="when">{nextWhen}</span>{/if}
						{#if clashCount(nextRow) > 0}
							<span class="clash">
								+{clashCount(nextRow)} unassigned — tell your manager
							</span>
						{/if}
					</div>
					<Button
						variant="primary"
						href={newEntryHref(nextUp.match.match_number, watchOne(nextRow))}
					>
						Record it
					</Button>
				</div>
			{:else if !session.eventCode}
				<p class="muted">No event chosen. <a href="{base}/settings/">Settings</a></p>
			{:else if !myTeams.length}
				<p class="muted">Nothing assigned yet.</p>
			{:else if !qmList.length}
				<p class="muted">No schedule published for this event yet.</p>
			{:else}
				<p class="muted">All caught up.</p>
			{/if}
		</section>

		<!-- ── 2. has anyone told me anything? ──────────────────────────── -->
		{#if fromManager.length > 0}
			<section>
				<h2>From your manager</h2>
				<ul class="notes">
					{#each fromManager as r (r.id)}
						<li>
							<p class="note-text">{r.message}</p>
							<span class="note-meta">
								{#if r.match_number}Q{r.match_number} · {/if}{r.author ?? 'a manager'}
								{#if r.created_at}· {relativeTime(r.created_at)}{/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- ── 3. what am I watching? ───────────────────────────────────── -->
		{#if upcoming.length > 0}
			<section>
				<h2>After that</h2>
				<ul class="later">
					{#each visibleUpcoming as row (row.match.match_number)}
						<li>
							<a class="later-link" href={newEntryHref(row.match.match_number, watchOne(row))}>
								<span class="qm">Q{row.match.match_number}</span>
								<span class="team">{watchOne(row)}</span>
								{#if clashCount(row) > 0}
									<span class="clash">+{clashCount(row)}</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
				{#if upcoming.length > FIRST_FEW}
					<button
						type="button"
						class="more"
						aria-expanded={showAllUpcoming}
						onclick={() => (showAllUpcoming = !showAllUpcoming)}
					>
						{#if showAllUpcoming}
							Show fewer
						{:else}
							Show all {upcoming.length}
						{/if}
					</button>
				{/if}
			</section>
		{/if}

		{#if myTeams.length > 0}
			<section>
				<h2>Your teams</h2>
				<ul class="teams-list">
					{#each myTeams as t (t)}
						<li>{t}</li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="tail">
			<a class="tail-link" href="{base}/scouting/">Everything you have recorded →</a>
		</div>
	{/if}
</main>

<style>
	main {
		max-width: var(--w-list);
		/* One page rhythm across Home, Scouting and Settings. The top space lives
		   HERE rather than on the first child, because each page has a different
		   first child — Scouting can open with a next-match banner — and hanging
		   it off the child made the three tabs start at three different heights. */
		margin: var(--space-4) auto;
		padding: var(--space-6) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}

	/* ── the greeting ──────────────────────────────────────────────────────
	   The only place in the app that gets this much air. It is the first thing
	   read eleven times a day, so it is large, quiet, and says the person's name
	   properly rather than their join key. */
	.hello {
		padding: 0 0 var(--space-5);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-display);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.15;
		/* Long names must break inside the word rather than push the page wide. */
		overflow-wrap: anywhere;
	}
	.name {
		color: var(--accent);
	}
	.context {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.event {
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 600;
	}
	.sep {
		margin: 0 var(--space-1);
		color: var(--text-faint);
	}

	/* ── sections: design.md's shared rhythm — uppercase tracked label, then
	   content. Every page in the app opens a section this way. */
	section {
		margin-top: var(--space-5);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		font-weight: 700;
	}

	.muted {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.muted a {
		color: var(--accent);
	}

	/* ── up next: the one action on the page ───────────────────────────── */
	.up-next {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}
	/* When there IS something to do, the card says so with a left rule rather
	   than a fill — a filled card here would be the loudest thing on a page whose
	   job is to be calm. */
	.up-next.ready {
		border-left: 3px solid var(--accent);
	}
	.next-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.next-what {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		min-width: 0;
	}
	.qm {
		font-weight: 700;
		font-size: var(--fs-lg);
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	.team {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.when {
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	/* An unresolved clash is the scout being asked to watch two robots at once.
	   auto-assign counts the second as lost coverage, so it is named here rather
	   than dropped — but quietly, because it is the manager's problem to fix. */
	.clash {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--warning);
		background: var(--warning-bg);
		border-radius: var(--radius-pill);
		padding: 0 var(--space-2);
	}
	.more {
		margin-top: var(--space-2);
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.more:hover {
		background: var(--bg-subtle);
	}
	.more:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* ── manager notes ─────────────────────────────────────────────────── */
	.notes,
	.later,
	.teams-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.notes li {
		background: var(--banner-info-bg);
		border: 1px solid var(--banner-info-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}
	.note-text {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.45;
	}
	.note-meta {
		display: block;
		margin-top: var(--space-1);
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	/* ── after that ────────────────────────────────────────────────────── */
	.later {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.later-link {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		text-decoration: none;
	}
	.later-link:hover {
		background: var(--bg-subtle);
	}
	.later-link .qm {
		font-size: var(--fs-md);
	}

	/* ── teams ─────────────────────────────────────────────────────────── */
	.teams-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.teams-list li {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		font-size: var(--fs-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.tail {
		margin-top: var(--space-6);
	}
	.tail-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
	}
	.tail-link:hover {
		text-decoration: underline;
	}
</style>
