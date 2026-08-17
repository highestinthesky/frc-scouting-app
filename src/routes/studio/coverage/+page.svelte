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

	import { session } from '$lib/session.svelte.js';
	import { listEntries } from '$lib/db.js';
	import { getCachedSchedule } from '$lib/tba.js';
	import { buildEntryIndex, scheduleRollup, matchCoverage } from '$lib/coverage.js';
	import { eventRoster, listMyEvents } from '$lib/events.js';
	import { sameScout, rowScout, scoutRef } from '$lib/scout-identity.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import Stats from '$lib/components/studio/Stats.svelte';
	import Stat from '$lib/components/studio/Stat.svelte';
	import Table from '$lib/components/studio/Table.svelte';

	let entries = $state([]);
	let cached = $state(null);
	let roster = $state([]);
	let loading = $state(true);
	let err = $state('');

	const qmList = $derived(cached?.matches ?? []);
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

	$effect(() => {
		(async () => {
			loading = true;
			err = '';
			try {
				entries = await listEntries();
				cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
				const events = await listMyEvents();
				const here = events.find((e) => e.code === session.eventCode);
				roster = here ? await eventRoster(here.id) : [];
			} catch (e) {
				err = e?.message ?? String(e);
			} finally {
				loading = false;
			}
		})();
	});

	const personName = (p) =>
		`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username || 'Unnamed';
</script>

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
					{#each partial as { match, cov } (match.match_number ?? match.matchNumber)}
						<tr>
							<td class="qm">Q{match.match_number ?? match.matchNumber}</td>
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

		<Panel
			title="By scout"
			hint={perScout.length === 0
				? 'Nobody is on this event yet — add scouts on the Event tab.'
				: 'Fewest first, because the useful end of this list is the top. A zero usually means a phone that has not synced rather than a scout who has not worked.'}
			flush={perScout.length > 0}
		>
			{#if perScout.length === 0}
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
		grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
		gap: var(--space-4);
		align-items: start;
		margin-top: var(--space-4);
	}

	.qm {
		font-weight: 600;
		white-space: nowrap;
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
