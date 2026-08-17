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
	import { sameScout } from '$lib/scout-identity.js';

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
	const perScout = $derived(
		roster
			.map((r) => ({
				person: r,
				count: entries.filter(
					(e) => e.eventCode === session.eventCode && sameScout(e, r)
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

<header>
	<h1>Coverage</h1>
	<p class="lede">
		{#if session.eventCode}
			{session.eventCode} — what has actually been recorded, against what the
			schedule says should have been.
		{:else}
			Choose an event first.
		{/if}
	</p>
</header>

{#if loading}
	<p class="muted">Loading…</p>
{:else if err}
	<p class="err">{err}</p>
{:else if qmList.length === 0}
	<p class="muted">
		No schedule cached for this event yet. Publish one from Scouting and this
		fills in.
	</p>
{:else}
	<div class="tiles">
		<div class="tile">
			<span class="big">{pct === null ? '—' : `${pct}%`}</span>
			<span class="cap">robot-matches recorded</span>
			<span class="sub">{rollup.teamMatchesScouted} of {rollup.teamMatchesTotal}</span>
		</div>
		<div class="tile">
			<span class="big">{rollup.matchesComplete}</span>
			<span class="cap">matches fully covered</span>
			<span class="sub">of {rollup.matchesTotal} scheduled</span>
		</div>
		<div class="tile" class:warn={partial.length > 0}>
			<span class="big">{partial.length}</span>
			<span class="cap">matches with gaps</span>
			<span class="sub">started but incomplete</span>
		</div>
	</div>

	<section>
		<h2>Gaps</h2>
		{#if partial.length === 0}
			<p class="muted">
				Nothing started is unfinished. Every match anyone has recorded is complete.
			</p>
		{:else}
			<p class="muted">
				Someone recorded part of these and not the rest — the most likely place a
				scout drifted off their assignment.
			</p>
			<ul class="gaps">
				{#each partial as { match, cov } (match.match_number ?? match.matchNumber)}
					<li>
						<span class="qm">Q{match.match_number ?? match.matchNumber}</span>
						<span class="bar" aria-hidden="true">
							<span class="fill" style="width: {(cov.scoutedTeams / cov.totalTeams) * 100}%"></span>
						</span>
						<span class="frac">{cov.scoutedTeams}/{cov.totalTeams}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2>By scout</h2>
		{#if perScout.length === 0}
			<p class="muted">Nobody is on this event yet — add scouts on the Event tab.</p>
		{:else}
			<p class="muted">
				Fewest first, because the useful end of this list is the top. A zero here
				usually means a phone that has not synced rather than a scout who has not
				worked.
			</p>
			<ul class="scouts">
				{#each perScout as { person, count } (person.profileId)}
					<li class:zero={count === 0}>
						<span class="who">{personName(person)}</span>
						<span class="n">{count}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	header {
		margin-bottom: var(--space-4);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
	}
	.lede {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--fs-sm);
		max-width: 42rem;
	}
	h2 {
		margin: 0 0 var(--space-1);
		font-size: var(--fs-md);
	}
	section {
		margin-top: var(--space-5);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-sm);
		margin: 0 0 var(--space-2);
		max-width: 42rem;
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--space-3);
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	/* Gaps get a border and a background, not a red number — the count is the
	   signal and colour alone is not readable to everyone. */
	.tile.warn {
		border-color: var(--warning-border);
		background: var(--warning-bg);
	}
	.big {
		/* A token, not 2rem. check_components.mjs enforces this and caught the
		   hardcoded value — one page inventing its own type scale is how a design
		   system stops being one. */
		font-size: var(--fs-xl);
		font-weight: 700;
		line-height: 1.1;
		color: var(--text-primary);
	}
	.cap {
		font-size: var(--fs-sm);
		color: var(--text-primary);
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.gaps li {
		display: grid;
		grid-template-columns: 3.5rem 1fr 3rem;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border-radius: var(--radius-md);
	}
	.qm {
		font-weight: 600;
	}
	.frac {
		font-size: var(--fs-sm);
		color: var(--text-muted);
		text-align: right;
	}
	.bar {
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

	.scouts li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap-min);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.scouts li.zero {
		border-color: var(--warning-border);
		background: var(--warning-bg);
	}
	.who {
		font-weight: 600;
	}
	.n {
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
</style>
