<script>
	// A manager's Home: one tile per manager page, directly under the greeting.
	//
	// A snapshot, not a sixth place to work. Every number is real state and
	// every number is a link into the page that owns it. No prose and no helper
	// text: a tile that needs explaining has the wrong number on it.
	//
	// A new event reads as a checklist by simple absence — "No schedule", "No
	// scouts on the event" — which is a setup guide that cost nothing and cannot
	// go stale. So a line that is not KNOWN yet is not drawn at all: "No scouts"
	// while the roster is still loading would be a checklist item that is false.
	//
	// The Review tile is the load-bearing one. "Next match, six teams, tap one" is
	// the review workflow, and putting it on the page a manager lands on means the
	// replay is found by arriving rather than by being told about.
	//
	// Everything comes from event-data.svelte.js, the store the manager pages
	// themselves read, so a tile and its page cannot disagree. The picklist and
	// the invites are the two reads it makes itself, each on its own failure path.

	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { gapMatches } from '$lib/coverage.js';
	import { scoutCounts } from '$lib/plan-state.js';
	import { reviewSplit } from '$lib/review.js';
	import { teamsInMatch } from '$lib/tba.js';
	import { localRows } from '$lib/picklist-store.js';

	const code = $derived(session.eventCode);
	const ready = $derived(eventData.localReady && eventData.code === code);

	const quals = $derived(eventData.qmList.length);
	const rollup = $derived(eventData.rollup);
	const pct = $derived(
		rollup.teamMatchesTotal
			? Math.round((rollup.teamMatchesScouted / rollup.teamMatchesTotal) * 100)
			: null
	);
	const gaps = $derived(gapMatches(eventData.qmList, eventData.entryIndex).length);
	const rosterKnown = $derived(eventData.rosterReady && !eventData.rosterError);
	const atZero = $derived(
		scoutCounts(eventData.roster, eventData.eventEntries).filter((s) => s.count === 0).length
	);
	const assigned = $derived(eventData.savedRows.length);
	const assignedKnown = $derived(eventData.remoteReady && !eventData.remoteError);

	const split = $derived(reviewSplit(eventData.qmList, eventData.entryIndex));
	const next = $derived(split.next);
	const nextTeams = $derived(next ? teamsInMatch(next) : null);
	const last = $derived(split.recent[0] ?? null);

	const teamsSeen = $derived(new Set(eventData.eventEntries.map((e) => Number(e.teamNumber))).size);

	// ── the two reads this makes itself ───────────────────────────────────

	let picklist = $state(/** @type {number|null} */ (null));
	$effect(() => {
		const c = code;
		picklist = null;
		if (!c) return;
		let stale = false;
		localRows(c)
			.then((rows) => {
				if (!stale) picklist = rows.length;
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	});

	let invites = $state(/** @type {number|null} */ (null));
	$effect(() => {
		const signedIn = auth.signedIn;
		invites = null;
		if (!signedIn) return;
		let stale = false;
		auth
			.listInvites()
			.then((rows) => {
				const now = Date.now();
				if (stale) return;
				invites = rows.filter(
					(i) => !i.redeemed_at && (!i.expires_at || new Date(i.expires_at).getTime() > now)
				).length;
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	});
	const people = $derived(eventData.profiles.length);

	const matchHref = (n) => `${base}/studio/${code}/q${n}/`;
	const teamHref = (t) => `${base}/studio/${code}/team/${t}/`;
</script>

<section class="tiles" aria-label="Manager overview">
	{#if code}
		<article class="tile">
			<h2><a href="{base}/studio/plan/people/">Plan</a></h2>
			{#if ready}
				<ul>
					<li>
						<a href="{base}/studio/plan/schedule/">
							{#if quals}<strong>{quals}</strong> quals published{:else}No schedule{/if}
						</a>
					</li>
					{#if rosterKnown}
						<li>
							<a href="{base}/studio/plan/people/">
								{#if eventData.roster.length}
									<strong>{eventData.roster.length}</strong>
									{eventData.roster.length === 1 ? 'scout' : 'scouts'} on the event
								{:else}No scouts on the event{/if}
							</a>
						</li>
					{/if}
					{#if assignedKnown}
						<li>
							<a href="{base}/studio/plan/assignments/">
								{#if assigned}<strong>{assigned}</strong>
									{assigned === 1 ? 'scout' : 'scouts'} assigned{:else}No assignments{/if}
							</a>
						</li>
					{/if}
				</ul>
			{/if}
		</article>

		<article class="tile">
			<h2><a href="{base}/studio/run/matches/">Run</a></h2>
			{#if ready && quals}
				<ul>
					<li>
						<a href="{base}/studio/run/matches/">
							<strong>{pct ?? 0}%</strong> recorded
						</a>
					</li>
					<li>
						<a href="{base}/studio/run/matches/?show=gaps" class:warn={gaps > 0}>
							{#if gaps}<strong>{gaps}</strong>
								{gaps === 1 ? 'match' : 'matches'} with gaps{:else}No gaps{/if}
						</a>
					</li>
					{#if rosterKnown && eventData.roster.length}
						<li>
							<a href="{base}/studio/run/scouts/" class:warn={atZero > 0}>
								{#if atZero}<strong>{atZero}</strong>
									{atZero === 1 ? 'scout' : 'scouts'} at zero{:else}Nobody at zero{/if}
							</a>
						</li>
					{/if}
				</ul>
			{:else if ready}
				<ul>
					<li><a href="{base}/studio/plan/schedule/">No schedule</a></li>
				</ul>
			{/if}
		</article>

		<article class="tile review">
			<h2><a href="{base}/studio/review/">Review</a></h2>
			{#if ready && quals}
				{#if next && nextTeams}
					<p class="next">
						<a class="qm" href={matchHref(next.match_number)}>
							Next <strong>Q{next.match_number}</strong>
						</a>
					</p>
					<div class="six">
						{#each /** @type {const} */ (['red', 'blue']) as color (color)}
							<ul class="side" data-color={color} aria-label="{color} alliance">
								{#each nextTeams[color].filter((t) => t != null) as t (t)}
									<li><a class="team" href={teamHref(t)}>{t}</a></li>
								{/each}
							</ul>
						{/each}
					</div>
				{:else}
					<p class="next"><a href="{base}/studio/review/">Every qual played</a></p>
				{/if}
				{#if last}
					<ul>
						<li>
							<a href={matchHref(last.match_number)}>
								Last played <strong>Q{last.match_number}</strong>
							</a>
						</li>
					</ul>
				{/if}
			{:else if ready}
				<ul>
					<li><a href="{base}/studio/review/">Find a team</a></li>
				</ul>
			{/if}
		</article>

		<article class="tile">
			<h2><a href="{base}/studio/pick/">Pick</a></h2>
			{#if ready}
				<ul>
					<li>
						<a href="{base}/studio/pick/">
							{#if teamsSeen}<strong>{teamsSeen}</strong>
								{teamsSeen === 1 ? 'team' : 'teams'} seen{:else}No teams seen yet{/if}
						</a>
					</li>
					{#if picklist !== null}
						<li>
							<a href="{base}/studio/pick/picklist/">
								{#if picklist}Picklist <strong>{picklist}</strong> long{:else}No picklist{/if}
							</a>
						</li>
					{/if}
				</ul>
			{/if}
		</article>
	{/if}

	<article class="tile">
		<h2><a href="{base}/studio/accounts/">Accounts</a></h2>
		<ul>
			{#if eventData.remoteReady && people}
				<li>
					<a href="{base}/studio/accounts/"><strong>{people}</strong> {people === 1 ? 'person' : 'people'}</a>
				</li>
			{/if}
			{#if invites !== null}
				<li>
					<a href="{base}/studio/accounts/">
						{#if invites}<strong>{invites}</strong>
							{invites === 1 ? 'invite' : 'invites'} outstanding{:else}No invites outstanding{/if}
					</a>
				</li>
			{/if}
		</ul>
	</article>
</section>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: var(--space-3);
		margin-top: var(--space-5);
	}
	.tile {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-2) var(--space-3) var(--space-3);
		min-width: 0;
	}
	/* Home's section label, and a link: the tile's name opens its page. */
	h2 {
		margin: 0;
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
	}
	h2 a {
		display: flex;
		align-items: center;
		min-height: var(--tap-min);
		color: var(--text-muted);
		text-decoration: none;
	}
	h2 a:hover {
		color: var(--accent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li a,
	.next a {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-min);
		color: var(--text-primary);
		font-size: var(--fs-sm);
		text-decoration: none;
	}
	li a:hover,
	.next a:hover {
		color: var(--accent);
	}
	strong {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	/* Something to act on. The word says so too; the colour is the second
	   signal. */
	a.warn {
		color: var(--warning);
	}
	.next {
		margin: 0;
	}
	.next .qm strong {
		color: var(--accent);
		margin-left: var(--space-1);
	}
	.six {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-1);
	}
	.side {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-1);
		padding-left: var(--space-2);
		border-left: 3px solid var(--border);
	}
	.side[data-color='red'] {
		border-left-color: var(--alliance-red);
	}
	.side[data-color='blue'] {
		border-left-color: var(--alliance-blue);
	}
	.side a.team {
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.side a.team:hover {
		border-color: var(--accent);
	}
</style>
