<script>
	// Is this event actually being scouted?
	//
	// The draft asks for a drag-and-drop graph builder and marks it "to be
	// developed later due to difficulty", which is right. What a manager needs at
	// an event is not a chart-building tool — it is one screen that answers the
	// question they keep walking around asking, and the ROADMAP says to start
	// with a small fixed set and see what gets used at the offseason.
	//
	// So: one number that says whether the event is covered, and the specific
	// gaps under it. Everything here is derived from data the app already syncs;
	// nothing new is stored.
	//
	// ─── why per-scout counts sit beside per-match ─────────────────────────────
	//
	// "Match 34 is missing a red robot" is actionable in the next four minutes.
	// "Ning has recorded two things all day" is actionable now and explains the
	// first. Both, on one screen, because chasing one without the other is how a
	// manager fixes symptoms all afternoon.

	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { listEntries } from '$lib/db.js';
	import { getCachedSchedule, qualMatches } from '$lib/tba.js';
	import { buildEntryIndex, scheduleRollup, matchCoverage } from '$lib/coverage.js';
	import { eventRoster, listMyEvents } from '$lib/events.js';
	import { sameScout, rowScout, scoutRef } from '$lib/scout-identity.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Table from '$lib/components/studio/Table.svelte';

	// ─── two loads, because they can fail in different ways ────────────────────
	//
	// Everything on this page except the roster is already on the device: entries
	// are IndexedDB and the schedule is a cached setting. The roster is the one
	// thing that needs Supabase.
	//
	// They used to share a `loading` flag and a try block, and that put the local
	// numbers behind a network round trip with no timeout on it. One request that
	// never settles — a gym with no usable wifi, which CLAUDE.md says is the
	// normal case — left a manager looking at "Loading…" on a page whose every
	// statistic was sitting in IndexedDB. Measured: one hung fetch, and the page
	// never rendered a number again.
	//
	// So the local half gates the statistics and the network half gates only the
	// panel that needs it. An event with no signal now reads as coverage plus one
	// panel that says why it is empty, which is the offline-first promise the rest
	// of the app keeps.
	let entries = $state([]);
	let cached = $state(null);
	let loading = $state(true);
	let err = $state('');

	let roster = $state([]);
	let rosterLoading = $state(true);
	let rosterErr = $state('');
	let rosterSlow = $state(false);

	// How long the roster may spin before it says so.
	//
	// Not a cancel: supabase-js retries a rejected fetch rather than surfacing it
	// (measured — three attempts and still going at 4.8s), and a hung socket never
	// rejects at all, so "loading" is a state this panel can sit in indefinitely.
	// The request is left running and fills in if it lands; this only stops the
	// spinner claiming progress it cannot demonstrate.
	const ROSTER_PATIENCE_MS = 8000;

	// qualMatches(), not `cached.matches`. The variable was named qmList and was
	// not one.
	//
	// A published schedule is the RAW TBA payload, playoffs included — production's
	// is 68 quals, 13 semifinals and 2 finals. Every other consumer of the cache
	// filters (home, scouting, MyAssignments, the match page, the schedule page,
	// reminders); this page alone read it straight, so 83 matches were counted as
	// the event.
	//
	// The inflated denominator was the smaller half of it. `cellKey()` is
	// (match_number, team) and playoff numbering restarts, so THIRTEEN semifinals
	// and a final all carry match_number 1 and collide with qual 1. Measured on
	// production's own data: three entries reported as five robot-matches
	// recorded, and the Gaps list showed "Q1" three times — twice for semifinals.
	//
	// A numerator larger than the number of entries is the same failure this file
	// already carries a comment about, where strays counted toward coverage. A
	// number that looks like one thing and is another.
	const qmList = $derived(cached ? qualMatches(cached.matches) : []);
	const entryIndex = $derived(buildEntryIndex(entries, session.eventCode));
	const rollup = $derived(scheduleRollup(qmList, entryIndex));

	const pct = $derived(
		rollup.teamMatchesTotal === 0
			? null
			: Math.round((rollup.teamMatchesScouted / rollup.teamMatchesTotal) * 100)
	);

	// Matches that have started but are not finished. A match nobody has touched
	// yet is usually just in the future; a match with two of six robots recorded
	// is a gap that happened.
	const partial = $derived(
		qmList
			.map((m) => ({ match: m, cov: matchCoverage(m, entryIndex) }))
			.filter(({ cov }) => cov.scoutedTeams > 0 && !cov.complete)
	);

	// Per-scout counts through sameScout(), never a raw string compare. CLAUDE.md:
	// the codebase used to disagree with itself about whether "Ning" and "ning"
	// were one person, in three places out of six.
	//
	// Both sides have to be ScoutRefs, and this call site was passing neither — a
	// raw entry and a raw roster row. sameScout() then read `undefined` off both:
	// the profileId branch was skipped because the entry has no `.profileId`, and
	// `a.key !== '' && a.key === b.key` became `undefined !== '' && undefined ===
	// undefined`, which is TRUE. Every scout was credited with every entry on the
	// event, so this list read "everyone has 20" and the one number it exists to
	// surface — the scout at zero — could never appear.
	//
	// It is the exact failure scout-identity.js was written to end, in the one
	// call site whose comment says it is using it. The other six wrap both sides.
	const scoutIdentity = (p) =>
		scoutRef(
			// Not personName(): its 'Unnamed' fallback would become a join key and
			// match an entry recorded by someone who typed "Unnamed".
			`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username || '',
			p.profileId
		);

	const perScout = $derived(
		roster
			.map((r) => ({
				person: r,
				count: entries.filter(
					(e) => e.eventCode === session.eventCode && sameScout(rowScout(e), scoutIdentity(r))
				).length
			}))
			.sort((a, b) => a.count - b.count)
	);

	// The event code is read SYNCHRONOUSLY, before any await, in both effects.
	//
	// Svelte only tracks reads that happen before the first suspension, so reading
	// it after `await listEntries()` — which is where it used to be read — made
	// this effect dependency-free: it ran once on mount and never again. Switching
	// events left the page showing the previous event's coverage under the new
	// event's name.
	//
	// Which is also why both loads carry a `stale` flag. Now that they DO re-run,
	// two event switches in quick succession have two loads in flight, and the
	// slower one is not necessarily the older one — without this, the first
	// event's roster lands under the second event's heading.
	$effect(() => {
		const code = session.eventCode;
		let stale = false;
		(async () => {
			loading = true;
			err = '';
			try {
				const rows = await listEntries();
				const sched = code ? await getCachedSchedule(code) : null;
				if (stale) return;
				entries = rows;
				cached = sched;
			} catch (e) {
				if (!stale) err = e?.message ?? String(e);
			} finally {
				if (!stale) loading = false;
			}
		})();
		return () => {
			stale = true;
		};
	});

	$effect(() => {
		const code = session.eventCode;
		let stale = false;
		const slow = setTimeout(() => {
			if (!stale) rosterSlow = true;
		}, ROSTER_PATIENCE_MS);
		(async () => {
			rosterLoading = true;
			rosterErr = '';
			rosterSlow = false;
			try {
				const events = await listMyEvents();
				const here = events.find((e) => e.code === code);
				const rows = here ? await eventRoster(here.id) : [];
				if (stale) return;
				roster = rows;
			} catch (e) {
				if (stale) return;
				roster = [];
				rosterErr = e?.message ?? String(e);
			} finally {
				if (!stale) {
					clearTimeout(slow);
					rosterSlow = false;
					rosterLoading = false;
				}
			}
		})();
		return () => {
			stale = true;
			clearTimeout(slow);
		};
	});

	const personName = (p) =>
		`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username || 'Unnamed';
</script>

<svelte:head><title>Coverage · FRC Scout</title></svelte:head>

<PageHead
	title="Coverage"
	sub={session.eventCode
		? `${session.eventCode} — what has actually been recorded, against what the schedule says should have been.`
		: 'Choose an event first.'}
/>

{#if loading}
	<p class="muted">Loading…</p>
{:else if err}
	<p class="err">{err}</p>
{:else if qmList.length === 0}
	<Panel tone="quiet">
		<p class="muted">
			No schedule cached for this event yet. Publish one from Scouting and this
			fills in.
		</p>
	</Panel>
{:else}
	<Stats>
		<Stat
			label="Robot-matches recorded"
			value={pct === null ? '—' : `${pct}%`}
			note="{rollup.teamMatchesScouted} of {rollup.teamMatchesTotal}"
		/>
		<Stat
			label="Matches fully covered"
			value={rollup.matchesComplete}
			note="of {rollup.matchesTotal} scheduled"
		/>
		<!-- Toned, and the note carries the same fact in words. Colour alone is
		     not a signal everyone receives. -->
		<Stat
			label="Matches with gaps"
			value={partial.length}
			note="started but incomplete"
			tone={partial.length > 0 ? 'warn' : 'default'}
		/>
	</Stats>

	<!-- Two independent lists, so they sit side by side on a laptop rather than
	     one below the other with the second below the fold. They answer the two
	     halves of the same question — which match has a hole, and who is not
	     recording — and chasing one without the other is how a manager fixes
	     symptoms all afternoon. -->
	<div class="cols">
		<Panel
			title="Gaps"
			hint={partial.length === 0
				? 'Every match anyone has recorded is complete.'
				: 'Someone recorded part of these and not the rest — the most likely place a scout drifted off their assignment.'}
			flush={partial.length > 0}
		>
			{#if partial.length === 0}
				<p class="muted">Nothing started is unfinished.</p>
			{:else}
				<Table dense>
					{#snippet head()}
						<tr>
							<th>Match</th>
							<th>Recorded</th>
							<th data-num>Robots</th>
						</tr>
					{/snippet}
					<!-- Keyed on TBA's own match key, not the number.
					     A match_number is only unique WITHIN a competition level, and
					     playoff numbering restarts — production's schedule has thirteen
					     semifinals all numbered 1. Keyed on the number, Svelte threw
					     `each_key_duplicate`, which aborts the render and leaves the DOM
					     showing whatever it painted last: the "Loading…" paragraph. A
					     page frozen on a spinner, with no network fault anywhere near it.
					     The qualMatches() filter above is what makes the numbers right;
					     this is what stops a duplicate key being fatal if a non-qual ever
					     reaches this list again. -->
					{#each partial as { match, cov } (match.key ?? match.match_number ?? match.matchNumber)}
						<tr>
							<td class="qm">
								<!-- Straight to the match: its six seats, who recorded what,
								     and the auto replay of every track on it. Note this list
								     holds only matches with GAPS, so Studio → Schedule is the
								     complete index and links the same way. -->
								<a href="{base}/studio/{session.eventCode}/q{match.match_number ?? match.matchNumber}/">
									Q{match.match_number ?? match.matchNumber}
								</a>
							</td>
							<td>
								<span class="bar" aria-hidden="true">
									<span
										class="fill"
										style="width: {(cov.scoutedTeams / cov.totalTeams) * 100}%"
									></span>
								</span>
							</td>
							<td data-num>{cov.scoutedTeams}/{cov.totalTeams}</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</Panel>

		<!-- The one panel that needs the network, and the only thing a dead
		     connection is now allowed to empty. -->
		<Panel
			title="By scout"
			hint={rosterLoading || rosterErr
				? ''
				: perScout.length === 0
					? 'Nobody is on this event yet — add scouts on the Event tab.'
					: 'Fewest first, because the useful end of this list is the top. A zero usually means a phone that has not synced rather than a scout who has not worked.'}
			flush={!rosterLoading && !rosterErr && perScout.length > 0}
		>
			{#if rosterLoading}
				<p class="muted">{rosterSlow ? 'Still waiting on the network.' : 'Loading…'}</p>
			{:else if rosterErr}
				<p class="err">{rosterErr}</p>
			{:else if perScout.length === 0}
				<p class="muted">No roster.</p>
			{:else}
				<Table dense>
					{#snippet head()}
						<tr>
							<th>Scout</th>
							<th data-num>Entries</th>
						</tr>
					{/snippet}
					{#each perScout as { person, count } (person.profileId)}
						<tr>
							<td class="who">{personName(person)}</td>
							<td data-num>
								<span class:zero-n={count === 0} title={count === 0 ? 'Nothing recorded' : undefined}>
									{count}
								</span>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</Panel>
	</div>
{/if}

<style>
	/* Panel, Stat and Table own the boxes now. What is left is the two marks this
	   page draws and the state its rows carry. */

	.muted {
		color: var(--text-muted);
		font-size: var(--fs-sm);
		margin: 0;
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
	}

	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
		margin-top: var(--space-4);
	}

	.qm {
		font-weight: 600;
		white-space: nowrap;
	}
	.qm a {
		color: var(--accent);
		text-decoration: none;
	}
	.qm a:hover,
	.qm a:focus-visible {
		text-decoration: underline;
	}
	.who {
		font-weight: 600;
	}

	/* How much of the match got recorded. A mark, so the accent is used at its
	   non-text floor rather than as a label. */
	.bar {
		display: block;
		min-width: 4rem;
		height: 0.5rem;
		background: var(--bg-elev);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}

	/* A scout with nothing recorded. Marked on the number rather than by filling
	   the whole row: at an event most of this list is short, and a wall of amber
	   rows says "everything is wrong" when the point is which ONE is. */
	.zero-n {
		color: var(--warning);
		font-weight: 700;
	}
</style>
