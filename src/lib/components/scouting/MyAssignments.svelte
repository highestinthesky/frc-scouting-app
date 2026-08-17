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
	});

	async function onRefresh() {
		resync();
		await loadCache();
	}
</script>

<MyTeams {assignedTeams} {cached} {qmList} {busy} {now} {onRefresh} />
