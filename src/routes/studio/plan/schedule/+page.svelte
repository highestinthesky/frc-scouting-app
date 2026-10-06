<script>
	// Plan › Schedule — fetch the match list from The Blue Alliance and publish it.
	//
	// One panel from the old /studio/schedule, which held seven. Publishing is a
	// before-the-event job done once or twice, and it shared a page with the
	// reminders and match overrides a manager uses every few minutes during it.
	// The match list it produces is on Run › Matches.

	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import {
		fetchAndCacheSchedule,
		publishSchedule,
		clearScheduleCache,
		qualMatches
	} from '$lib/tba.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import PublishSchedule from '$lib/components/studio/PublishSchedule.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	let tbaApiKey = $state(session.tbaApiKey);
	// The canonical TBA key to fetch from (e.g. "2027nyny"), decoupled from the
	// team's event code. Empty falls back to the code.
	let tbaEventKey = $state(session.tbaEventKey);
	// The event data adopts a key a teammate already published; take it up here
	// too, unless the manager has started typing their own.
	$effect(() => {
		const published = session.tbaEventKey;
		if (!tbaEventKey && published) tbaEventKey = published;
	});

	// Who published, by account. Attributing a publish to whatever name this
	// device happened to have typed is how "who published this?" became
	// unanswerable.
	const managerName = $derived(auth.displayName || auth.profile?.username || '');

	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	/**
	 * Safety net for a hung request (a stale service worker intercepting a fetch,
	 * an IndexedDB transaction stuck on a lock): never leave the page wedged in
	 * "…". The normal finally clears it first.
	 */
	function armSafetyTimer(maxMs = 25_000) {
		return setTimeout(() => {
			if (busy) {
				busy = false;
				err =
					err ||
					'That took longer than expected and was cancelled. Try again, or do a hard refresh if it keeps happening.';
			}
		}, maxMs);
	}

	async function fetchFromTba() {
		busy = true;
		err = '';
		msg = '';
		const safety = armSafetyTimer();
		try {
			const effectiveTbaKey = (tbaEventKey || '').trim() || session.eventCode;
			const matches = await fetchAndCacheSchedule(
				session.eventCode,
				tbaApiKey || session.tbaApiKey,
				effectiveTbaKey
			);
			// Persist the keys on this device so a reload does not lose them.
			if (tbaApiKey && tbaApiKey !== session.tbaApiKey) {
				await session.update({ tbaApiKey });
			}
			if ((tbaEventKey || '').trim() !== session.tbaEventKey) {
				await session.update({ tbaEventKey: (tbaEventKey || '').trim() });
			}
			await eventData.refreshSchedule();
			msg = `Fetched ${qualMatches(matches).length} qual matches from TBA (${effectiveTbaKey}). Now tap “Publish to teammates”.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			clearTimeout(safety);
			busy = false;
		}
	}

	async function publishToTeammates() {
		err = '';
		msg = '';
		let safety;
		try {
			const cached = eventData.cached;
			if (!cached) throw new Error('Fetch the schedule from TBA first.');
			const qmCount = eventData.qmList.length;
			// Confirm, so a stray tap — especially on the wrong event — cannot
			// silently overwrite everyone's schedule.
			const ok = await dialog.confirm({
				title: `Publish ${qmCount} qual match${qmCount === 1 ? '' : 'es'}?`,
				body:
					`${cached.matches.length} total, for ${session.eventCode}.\n\n` +
					`This replaces the current published schedule. Scouts pull the new one within 30 seconds.`,
				confirmLabel: 'Publish'
			});
			if (!ok) return;
			busy = true;
			safety = armSafetyTimer();
			const res = await publishSchedule(session.eventCode, cached.matches, {
				fetchedBy: managerName || null,
				tbaEventKey: (tbaEventKey || '').trim() || session.eventCode
			});
			msg = `Published — teammates will pull within 30 seconds. (${new Date(res.fetchedAt).toLocaleTimeString()})`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			if (safety) clearTimeout(safety);
			busy = false;
		}
	}

	async function clearLocalCache() {
		await clearScheduleCache(session.eventCode);
		await eventData.refreshSchedule();
		msg = 'Local schedule cache cleared. (This does not delete the published schedule.)';
	}
</script>

<svelte:head><title>Schedule · Plan · FRC Scout</title></svelte:head>

<PageHead title="Plan" />
<SubNav mode="plan" current="Schedule" />

{#if !session.eventCode}
	<Panel tone="quiet">
		<p class="muted">Choose an event from the event button in the bar above first.</p>
	</Panel>
{:else}
	<div class="narrow">
		<PublishSchedule
			bind:tbaEventKey
			bind:tbaApiKey
			{busy}
			cached={eventData.cached}
			qmList={eventData.qmList}
			{now}
			onFetch={fetchFromTba}
			onPublish={publishToTeammates}
			onClearCache={clearLocalCache}
		/>
		{#if eventData.qmList.length}
			<p class="muted">
				The match list, with coverage and per-match overrides, is on
				<a href="{base}/studio/run/matches/">Run › Matches</a>.
			</p>
		{/if}
	</div>
{/if}

{#if msg}<p class="banner ok" role="status">{msg}</p>{/if}
{#if err}<p class="banner err" role="alert">{err}</p>{/if}

<style>
	.narrow {
		max-width: var(--w-read);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-md);
		margin: 0;
	}
	.muted a {
		color: var(--accent);
	}
	.banner {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-top: var(--space-4);
		font-size: var(--fs-md);
	}
	.banner.ok {
		background: var(--success-bg);
		color: var(--success);
		border: 1px solid var(--success-border);
	}
	.banner.err {
		background: var(--danger-bg);
		color: var(--danger);
		border: 1px solid var(--danger);
	}
</style>
