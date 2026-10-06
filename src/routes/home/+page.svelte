<script>
	// Where a scout lands.
	//
	// The app used to open on /scouting, which is a list of what you have already
	// done. That is the wrong first thing: a scout opening the app in a gym is
	// asking "what now", and answering it with a history means they have to
	// derive the answer themselves, on a phone, between matches.
	//
	// So this page answers, in order, the questions actually being asked:
	//
	//   1. am I up?           the next match with one of my teams, unrecorded
	//   2. has anyone told me anything?   reminders from a manager
	//   3. what am I watching?            my teams for the event
	//   4. what have I recorded?          the entries, to check or to fix
	//
	// ─── /scouting folded in here ─────────────────────────────────────────────
	//
	// There were two pages and only the fourth question separated them. Of the
	// five things /scouting showed, three were already on this one — the next
	// unrecorded match, the assigned teams, and the count for today — and its
	// own tail link called the difference by its real name: "everything you have
	// recorded". So the list came here and the page went.
	//
	// The list is rebuilt in THIS page's idiom rather than moved across with its
	// markup. /scouting was a workbench — a heading, a CTA and a dense list;
	// this is a page that speaks to a person and quiets down as it goes. Pasting
	// one into the other would have produced a page with two voices, which is
	// what the two pages already were.
	//
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listEntries } from '$lib/db.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import { withdrawEntry } from '$lib/sync.svelte.js';
	import { getCachedSchedule, qualMatches, myMatches } from '$lib/tba.js';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { listAssignments } from '$lib/assignments.js';
	import { rowScout, sameScout } from '$lib/scout-identity.js';
	import { syncState } from '$lib/sync.svelte.js';
	import { reminders } from '$lib/reminders.svelte.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import Button from '$lib/components/Button.svelte';
	import ManagerHome from '$lib/components/ManagerHome.svelte';

	let entries = $state([]);
	let qmList = $state([]);
	let loading = $state(true);
	/** Refreshed once a minute to keep relative times current. */
	let now = $state(new Date());

	async function refresh() {
		if (auth.isManager) {
			await eventData.refreshEntries();
			entries = eventData.entries;
		} else {
			entries = await listEntries();
		}
	}
	async function refreshSchedule() {
		const cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
		qmList = cached ? qualMatches(cached.matches) : [];
	}

	onMount(() => {
		void Promise.all([refresh(), refreshSchedule()]).then(() => loading = false);
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

	// ── why is nothing assigned? ──────────────────────────────────────────────
	//
	// "Nothing assigned" has two causes and they need opposite responses: wait,
	// or go and find your manager. Carried over from MyAssignments when /scouting
	// folded into this page — it was the one thing that component knew and this
	// one did not, and losing it in a merge would have been the merge quietly
	// costing something.
	//
	// null while unknown, so nothing is claimed before the answer is in. A failed
	// read is not a diagnosis either: the network preventing the check is not
	// evidence about the schedule.
	let diagnosis = $state(/** @type {null | {kind: string, total: number}} */ (null));

	async function diagnose() {
		if (auth.isManager || !session.eventCode || myTeams.length > 0 || !auth.signedIn) {
			diagnosis = null;
			return;
		}
		try {
			const all = await listAssignments(session.eventCode);
			if (all.length === 0) {
				diagnosis = { kind: 'none-published', total: 0 };
				return;
			}
			const mine = all.filter((r) => sameScout(rowScout(r), auth.me));
			diagnosis = mine.length > 0 ? null : { kind: 'not-yours', total: all.length };
		} catch {
			diagnosis = null;
		}
	}

	$effect(() => {
		void syncState.inboundChanges;
		void session.eventCode;
		void myTeams.length;
		diagnose();
	});

	// ── what this scout has recorded ──────────────────────────────────────────
	//
	// Scoped to the current event, and that is a change from /scouting, which
	// listed every entry on the device from every event it had ever seen.
	//
	// Everything else on this page is event-scoped — "up next" comes from its
	// schedule, and the teams are its assignments —
	// so an all-events list would have been the one thing here that silently
	// meant something wider than the page around it. That is the same shape as
	// the pooling invariant in CLAUDE.md: a list that looks like one thing and is
	// another. Entries from elsewhere are counted in a line rather than dropped,
	// because they are still on the device and a scout who recorded them should
	// not conclude they are gone.
	const eventEntries = $derived(
		session.eventCode ? entries.filter((e) => e.eventCode === session.eventCode) : entries
	);
	const elsewhere = $derived(entries.length - eventEntries.length);

	/**
	 * Withdraw an entry.
	 *
	 * The confirmation says which of the two things is about to happen, because
	 * they are not the same act: an unsynced entry exists only here, and a synced
	 * one is the team's record and only a manager of the event may retract it.
	 */
	async function remove(entry, summary) {
		const synced = Boolean(entry.remoteId);
		const confirmed = await dialog.confirm({
			title: 'Delete this entry?',
			body: synced
				? `${summary}\n\nThis removes it for the whole team, not just this device. Only a manager of this event can do that.`
				: `${summary}\n\nThis entry has not synced yet, so it only exists on this device.`,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!confirmed) return;
		const res = await withdrawEntry(entry);
		if (!res.ok) {
			await dialog.confirm({ title: 'Not deleted', body: res.message, confirmLabel: 'OK' });
			return;
		}
		await refresh();
	}

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

	// ── the whole schedule ────────────────────────────────────────────────────
	//
	// Everything above lists only the matches one of MY teams is in. A scout
	// deciding whether they can leave the stand, or which match is on the field
	// now, needs the event's — v0.73 planned a read-only /schedule for it and it
	// was never built. It is a disclosure here instead of a page: the question is
	// occasional, and a tab for it would be a third tab on a bar that has been two
	// since it began.
	//
	// "Mine" is myRows — myMatches(), overrides applied — so a row marked as
	// yours here is exactly a row in Up next or After that, never a second answer
	// computed another way.
	let scheduleOpen = $state(false);
	const mineByMatch = $derived(new Map(myRows.map((r) => [r.match.match_number, r])));
	const sideOf = (m, color) =>
		(m.alliances?.[color]?.team_keys ?? []).map((k) => Number(String(k).replace(/^frc/, '')));

	const fromManager = $derived((reminders.visible ?? []).filter((r) => r.kind === 'manager'));

	const newEntryHref = (matchNumber, teamNumber) =>
		`${base}/scouting/new/?match=${matchNumber ?? ''}&team=${teamNumber ?? ''}`;
</script>

<svelte:head><title>Home · FRC Scout</title></svelte:head>

{#snippet scoutContent()}
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
				{#if diagnosis?.kind === 'not-yours'}
					<p class="muted">
						{diagnosis.total} assignments published for this event, none to you. Ask your
						manager.
					</p>
				{:else if diagnosis?.kind === 'none-published'}
					<p class="muted">No assignments published for this event yet.</p>
				{:else}
					<p class="muted">Nothing assigned yet.</p>
				{/if}
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

		<!-- ── the event's schedule, when asked for ─────────────────────────── -->
		{#if qmList.length > 0}
			<section>
				<h2>The schedule</h2>
				<details class="whole" bind:open={scheduleOpen}>
					<summary>All {qmList.length} quals</summary>
					<!-- Rendered only while open: eighty rows nobody asked to see are
					     eighty rows of work on every sync tick. -->
					{#if scheduleOpen}
						<ol class="whole-list">
							{#each qmList as m (m.key ?? m.match_number)}
								{@const mine = mineByMatch.get(m.match_number)}
								{@const when = timeOfDay(m.predicted_time ?? m.time ?? null)}
								<li class:mine={Boolean(mine)}>
									<span class="qm">Q{m.match_number}</span>
									<span class="sides">
										{#each /** @type {const} */ (['red', 'blue']) as color (color)}
											<span class="side {color}">
												{#each sideOf(m, color) as t, i (t)}
													{#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}
													<span class:watching={mine?.teams.includes(t)}>{t}</span>
												{/each}
											</span>
										{/each}
									</span>
									<span class="row-end">
										{#if mine}
											<span class="yours">{mine.done ? 'Yours · recorded' : 'Yours'}</span>
										{/if}
										{#if when}<span class="when">{when}</span>{/if}
									</span>
								</li>
							{/each}
						</ol>
					{/if}
				</details>
			</section>
		{/if}

		<!-- ── 4. what have I recorded? ─────────────────────────────────── -->
		<section class="mine">
			<div class="mine-head">
				<h2>Your entries</h2>
				<Button variant="primary" href="{base}/scouting/new/">+ New</Button>
			</div>

			{#if eventEntries.length === 0}
				<p class="muted">Nothing recorded here yet.</p>
			{:else}
				<ul class="entries">
					{#each eventEntries as e (e.id)}
						<li class="entry" data-color={e.allianceColor}>
							<div class="entry-row">
								<a
									class="entry-link"
									href="{base}/scouting/edit/?id={e.id}"
									aria-label="Edit entry Q{e.matchNumber} · Team {e.teamNumber}"
								>
									<span class="qm">Q{e.matchNumber}</span>
									<span class="team">{e.teamNumber}</span>
									<span class="alliance">{e.allianceColor}</span>
								</a>
								<button
									type="button"
									class="scrub"
									aria-label="Delete entry Q{e.matchNumber} · Team {e.teamNumber}"
									onclick={() => remove(e, `Q${e.matchNumber} · Team ${e.teamNumber}`)}
								>
									×
								</button>
							</div>
							{#if e.observations?.comments?.trim() || e.observations?.strengths?.trim()}
								<p class="entry-note">
									{e.observations.strengths?.trim() || e.observations.comments?.trim()}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<!-- Counted, not hidden. They are still on this device. -->
			{#if elsewhere > 0}
				<p class="muted elsewhere">
					{elsewhere}
					{elsewhere === 1 ? 'entry' : 'entries'} from another event, not shown here.
				</p>
			{/if}
		</section>
	{/if}

	<!-- Outside the loading branch: it needs no event, no schedule and no entries,
	     so it should not wait on any of them. -->
	<section>
		<Button href="{base}/practice/">Practice</Button>
	</section>
{/snippet}

{#if auth.isManager}
	<ManagerHome scouting={scoutContent} />
{:else}
	<main>
		<header class="page-head"><h1>Home</h1></header>
		{@render scoutContent()}
	</main>
{/if}

<style>

	main {
		max-width: var(--w-read);
		margin: var(--space-4) auto;
		padding: var(--space-6) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}

	/* Functional page heading. */
	.page-head {
		padding: 0 0 var(--space-5);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-page);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.15;
		/* Long headings stay inside the page. */
		overflow-wrap: anywhere;
	}

	/* ── sections: design.md's shared rhythm — uppercase tracked label, then
	   content. Every page in the app opens a section this way. */
	section {
		margin-top: var(--space-6);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-primary);
		font-weight: 600;
		margin-bottom: var(--space-3);
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
		padding: var(--space-5);
	}
	/* When there IS something to do, the card says so with a left rule rather
	   than a fill — a filled card here would be the loudest thing on a page whose
	   job is to be calm. */
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
		background: var(--bg-card);
		border: 1px solid var(--banner-info-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);

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
		gap: 0;
		border-top: 1px solid var(--border);
	}
	.later-link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--tap-min);
		padding: var(--space-3) 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-primary);
		text-decoration: none;
		border-bottom: 1px solid var(--border);
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
	/* ── the entries, in this page's voice ────────────────────────────────────
	   /scouting set its list against a full-width workbench: a big heading, a
	   CTA pinned opposite it, and rows that filled the page. Here the list is the
	   last of four sections and the quietest of them, so it takes the same
	   --fs-xs uppercase heading as the rest and the rows are the same card the
	   "After that" list already uses. One page, one voice. */
	.mine-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	/* h2 carries its own bottom margin for every other section; here the flex
	   row owns the spacing, so the heading gives it back. */
	.mine-head h2 {
		margin-bottom: 0;
	}
	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: clip;
	}
	.entry {
		border: 1px solid var(--border);

		border-radius: 0;
		background: var(--bg-card);
		border-top: 0;
		border-right: 0;
	}
	/* The alliance is on the edge of the card rather than only in the text: it
	   is the one property of an entry a scout scans for, and a rule down the side
	   survives being glanced at where a word does not. The word stays too —
	   colour is never the only signal. */
	.entry-row {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}
	.entry-link {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		color: var(--text-primary);
		text-decoration: none;
		padding-top: var(--space-3);
		padding-bottom: var(--space-3);
		min-width: 0;
	}
	.entry-link:hover {
		background: var(--bg-subtle);
	}
	.entry-link .qm {
		font-size: var(--fs-md);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.entry-link .team {
		font-size: var(--fs-sm);
		font-variant-numeric: tabular-nums;
	}
	.entry-link .alliance {
		margin-left: auto;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	/* Destructive, so it is not styled as one of the row's affordances — it is
	   quiet until reached for, and it keeps the full tap floor either way. */
	.scrub {
		flex: none;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border: none;
		background: none;
		color: var(--text-faint);
		font-size: var(--fs-lg);
		line-height: 1;
		cursor: pointer;
		border-radius: var(--radius-md);
	}
	.scrub:hover {
		color: var(--danger);
		background: var(--bg-subtle);
	}
	.scrub:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.entry-note {
		margin: 0;
		padding: 0 var(--space-3) var(--space-2);
		font-size: var(--fs-sm);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.elsewhere {
		margin-top: var(--space-2);
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

	.next-row .qm { font-size: var(--fs-xl); }

	.entry:last-child { border-bottom: 0; }


	/* ── the whole schedule ────────────────────────────────────────────── */
	.whole summary {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--accent);
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.whole summary:hover {
		background: var(--bg-subtle);
	}
	.whole summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.whole-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.whole-list li {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
		border-left: 3px solid transparent;
		font-size: var(--fs-sm);
		font-variant-numeric: tabular-nums;
	}
	/* Yours is a rule down the side and the word "Yours" — never colour alone. */
	.whole-list li.mine {
		border-left-color: var(--accent);
		background: var(--bg-card);
	}
	.whole-list .qm {
		font-size: var(--fs-sm);
	}
	.whole-list .sides {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.whole-list .side.red {
		color: var(--alliance-red);
	}
	.whole-list .side.blue {
		color: var(--alliance-blue);
	}
	.whole-list .watching {
		font-weight: 700;
		text-decoration: underline;
	}
	/* Spacing in CSS, not in the text node: Svelte trims the whitespace around
	   it and the numbers ran into the dots. */
	.whole-list .dot {
		margin: 0 0.3em;
		color: var(--text-faint);
	}
	.row-end {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		white-space: nowrap;
	}
	.yours {
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--accent);
	}
	.whole-list .when {
		font-size: var(--fs-xs);
	}


</style>
