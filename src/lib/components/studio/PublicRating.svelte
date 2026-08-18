<script>
	// Your scouts versus the public rating.
	//
	// Deliberately NOT a column of EPA numbers in the main table. EPA is free and
	// public — showing it next to your own work adds a number a manager could
	// already have looked up, and invites reading it as a score rather than as a
	// second opinion. What your team paid for with eleven matches of attention is
	// the DISAGREEMENT: a team EPA rates highly that your scouts keep marking as
	// broken down is a pick won or lost, and it is invisible in either dataset
	// alone.
	//
	// Opt-in, because it is N requests to somebody else's server on behalf of a
	// manager who may be on a phone tether at a venue. Nothing fetches on load.

	import { fetchTeamRating, disagreements } from '$lib/statbotics.js';
	import Panel from './Panel.svelte';
	import Table from './Table.svelte';
	import Button from '../Button.svelte';

	/**
	 * @type {{
	 *   rows: {team: number, ours: number|null}[],
	 *   metricLabel: string,
	 *   year: number|null
	 * }}
	 */
	let { rows = [], metricLabel = 'your numbers', year = null } = $props();

	let state = $state('idle'); // idle | loading | done
	let compared = $state([]);
	let reached = $state(0);
	let failed = $state(0);
	let unreadable = $state([]);
	let reason = $state('');

	async function check() {
		if (!year) {
			reason = 'No season year — pick an event first.';
			state = 'done';
			return;
		}
		state = 'loading';
		reason = '';
		unreadable = [];
		reached = 0;
		failed = 0;

		const withRating = [];
		for (const r of rows) {
			const res = await fetchTeamRating(r.team, year);
			if (!res.ok) {
				failed += 1;
				// First failure explains the rest; they are all the same outage.
				if (!reason) reason = res.detail;
				withRating.push({ team: r.team, ours: r.ours, theirs: null });
				continue;
			}
			reached += 1;
			if (res.epa === null && res.sawKeys?.length) {
				// A response ARRIVED and could not be read. Completely different
				// from the service being down, and it must not look the same —
				// otherwise a wrong field mapping is indistinguishable from an
				// outage, forever. Name the keys so it is a thirty-second fix.
				unreadable = res.sawKeys;
			}
			withRating.push({ team: r.team, ours: r.ours, theirs: res.epa });
		}

		compared = disagreements(withRating);
		state = 'done';
	}
</script>

<Panel
	title="Second opinion"
	hint="Statbotics rates every team from match results, for free. What your scouts add is what it cannot see — so this shows where the two disagree, not what it says."
>
	{#snippet actions()}
		<Button variant="secondary" disabled={state === 'loading' || rows.length === 0} onclick={check}>
			{state === 'loading' ? 'Checking…' : 'Check against Statbotics'}
		</Button>
	{/snippet}

	{#if state === 'idle'}
		<p class="muted">
			Compares your <strong>{metricLabel}</strong> ranking against theirs. Nothing is fetched until
			you ask.
		</p>
	{:else if state === 'loading'}
		<p class="muted">Asking about {rows.length} {rows.length === 1 ? 'team' : 'teams'}…</p>
	{:else}
		{#if failed > 0}
			<!-- Not an error state. Statbotics being unavailable is a normal
			     afternoon, and every number on this page is still true without it. -->
			<p class="note">
				Statbotics did not answer for {failed}
				{failed === 1 ? 'team' : 'teams'}{reached > 0 ? `, answered for ${reached}` : ''}.
				{reason}
				Your own numbers are unaffected.
			</p>
		{/if}

		{#if unreadable.length > 0}
			<p class="note warn">
				Statbotics answered but this app could not find a rating in the reply. It sent:
				<code>{unreadable.join(', ')}</code>. That is a mapping to fix in
				<code>statbotics.js</code>, not an outage.
			</p>
		{/if}

		{#if compared.length === 0}
			<p class="muted">
				Nothing to compare yet — a team needs both a rating and enough of your own data.
			</p>
		{:else}
			<Table dense>
				{#snippet head()}
					<tr>
						<th>Team</th>
						<th data-num>Your rank</th>
						<th data-num>Their rank</th>
						<th>Read</th>
					</tr>
				{/snippet}
				{#each compared as d (d.team)}
					<tr>
						<td class="team">{d.team}</td>
						<td data-num>{d.ourRank}</td>
						<td data-num>{d.theirRank}</td>
						<td>
							{#if d.direction === 'agree'}
								<span class="tag agree">agreed</span>
							{:else if d.direction === 'we-rate-higher'}
								<span class="tag up">your scouts rate it {d.gap} higher</span>
							{:else}
								<span class="tag down">EPA rates it {d.gap} higher</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</Panel>

<style>
	.muted {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.note {
		margin: 0 0 var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.note.warn {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.note code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: var(--fs-xs);
	}
	.team {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	.tag {
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.tag.agree {
		color: var(--text-faint);
	}
	/* Direction is carried by the words, not only by the colour — "your scouts
	   rate it 4 higher" reads the same in greyscale. */
	.tag.up {
		color: var(--success);
	}
	.tag.down {
		color: var(--studio-blue);
	}
</style>
