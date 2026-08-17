<script>
	// What this scout has been assigned, on the page a scout actually opens.
	//
	// ─── the bug this exists to fix ───────────────────────────────────────────
	//
	// v0.73 moved the manager surfaces to Studio, and MyTeams went with them
	// because it lived on the same page. Studio is manager-gated, so a scout was
	// left with no surface showing their assignments at all: a manager could
	// publish teams and the scout would never see them. The data was syncing
	// correctly the whole time — there was simply nowhere to look.
	//
	// It is its own component rather than markup on /scouting so that the manager
	// page and the scout page cannot drift into showing different answers to the
	// same question.
	//
	// ─── why it owns its own loading ──────────────────────────────────────────
	//
	// Almost nothing is needed. `session.assignedTeams` is already kept current by
	// the sync layer, and the schedule is already in the local cache — so this
	// reads two things that exist rather than re-fetching either. Refresh is the
	// sync layer's own resync(), not a private fetch path that could disagree
	// with it.

	import { onMount } from 'svelte';
	import { session } from '$lib/session.svelte.js';
	import { syncState, resync } from '$lib/sync.svelte.js';
	import { getCachedSchedule, qualMatches } from '$lib/tba.js';
	import { listAssignments } from '$lib/assignments.js';
	import { auth } from '$lib/auth.svelte.js';
	import { rowScout, sameScout } from '$lib/scout-identity.js';
	import MyTeams from './MyTeams.svelte';

	let cached = $state(/** @type {any} */ (null));
	let now = $state(new Date());

	const qmList = $derived(cached ? qualMatches(cached.matches) : []);
	const assignedTeams = $derived(session.assignedTeams ?? []);
	// The sync layer already knows whether it is mid-flight; a second busy flag
	// here would be a second source of truth for the same fact.
	const busy = $derived(syncState.status === 'connecting');

	async function loadCache() {
		cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
	}

	/**
	 * Why is this empty?
	 *
	 * "Nothing assigned" has two completely different causes and they need
	 * opposite responses: wait, or go find your manager. The old copy guessed —
	 * it told the scout to check that their name matched what the manager typed,
	 * which since 0023 is advice they cannot act on, because the account owns the
	 * name and the field is read-only.
	 *
	 * null while unknown, so nothing is claimed before the answer is in.
	 */
	let diagnosis = $state(/** @type {null | {kind: string, total: number}} */ (null));

	async function diagnose() {
		if (!session.eventCode || assignedTeams.length > 0 || !auth.signedIn) {
			diagnosis = null;
			return;
		}
		try {
			const all = await listAssignments(session.eventCode);
			if (all.length === 0) {
				diagnosis = { kind: 'none-published', total: 0 };
				return;
			}
			// Assignments exist and none is this account's. That is a manager
			// action, not something the scout can fix, and saying so is the
			// difference between waiting and asking.
			const mine = all.filter((r) => sameScout(rowScout(r), auth.me));
			diagnosis = mine.length > 0
				? null
				: { kind: 'not-yours', total: all.length };
		} catch {
			// A failed read is not a diagnosis. Stay quiet rather than assert a
			// cause the network prevented us from checking.
			diagnosis = null;
		}
	}

	onMount(() => {
		loadCache();
		// Match times are relative ("in 12 min"), so the clock has to move or they
		// silently go stale on a page left open between matches.
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	// A pull that lands new assignments also lands a new schedule; re-read the
	// cache when the sync layer reports movement rather than polling for it.
	$effect(() => {
		void syncState.inboundChanges;
		void session.eventCode;
		loadCache();
		diagnose();
	});

	async function onRefresh() {
		resync();
		await loadCache();
	}
</script>

<MyTeams {assignedTeams} {cached} {qmList} {busy} {now} {onRefresh} />

{#if diagnosis}
	<p class="why">
		{#if diagnosis.kind === 'none-published'}
			No assignments have been published for this event yet. Your manager does
			that from Studio — nothing is wrong on your end.
		{:else}
			There {diagnosis.total === 1 ? 'is' : 'are'} {diagnosis.total} assignment{diagnosis.total ===
			1
				? ''
				: 's'} for this event, none of them yours. Ask your manager to assign you —
			this is not something you can fix from this device.
		{/if}
	</p>
{/if}

<style>
	.why {
		margin: calc(var(--space-2) * -1) 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		font-size: var(--fs-sm);
		line-height: 1.45;
		color: var(--text-muted);
	}
</style>
