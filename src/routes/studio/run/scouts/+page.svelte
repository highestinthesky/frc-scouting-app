<script>
	// Run › Scouts — who is recording, talking to them, and collecting from a
	// phone that cannot sync.
	//
	// Reminders were on /studio/schedule, a match noun; collecting a file was on
	// /studio/event, a membership noun; and "By scout" was half of
	// /studio/coverage. All three are things a manager does about a person during
	// the event. By scout comes first because it is what sends a manager to the
	// other two: a zero is a phone to sync, or a scout to remind.

	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { createReminder, deleteReminder } from '$lib/reminders.js';
	import { reminders as reminderStore } from '$lib/reminders.svelte.js';
	import { scoutNames, scoutCounts } from '$lib/plan-state.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import ReminderPanel from '$lib/components/studio/ReminderPanel.svelte';
	import ImportEntries from '$lib/components/studio/ImportEntries.svelte';
	import Table from '$lib/components/studio/Table.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	let reminderTarget = $state(''); // '' = broadcast; otherwise a scout name
	let reminderMatch = $state('');
	let reminderText = $state('');

	const reminderScouts = $derived(scoutNames(eventData.savedRows));

	// ── by scout ───────────────────────────────────────────────────────────
	//
	// The one panel here that needs the network, and the only thing a dead
	// connection is allowed to empty: the entries are on the device, the roster
	// is not.
	const perScout = $derived(scoutCounts(eventData.roster, eventData.eventEntries));

	// How long the roster may spin before it says so. Not a cancel: supabase-js
	// retries a rejected fetch rather than surfacing it, and a hung socket never
	// rejects at all, so this only stops "Loading…" claiming progress it cannot
	// demonstrate. The request is left running and fills in if it lands.
	const ROSTER_PATIENCE_MS = 8000;
	let rosterSlow = $state(false);
	$effect(() => {
		const waiting = !eventData.rosterReady;
		rosterSlow = false;
		if (!waiting) return;
		const t = setTimeout(() => (rosterSlow = true), ROSTER_PATIENCE_MS);
		return () => clearTimeout(t);
	});
	const managerName = $derived(auth.displayName || auth.profile?.username || '');

	async function sendReminder() {
		err = '';
		msg = '';
		try {
			if (!reminderText.trim()) throw new Error('Reminder message is empty.');
			busy = true;
			const matchNum = Number(reminderMatch);
			await createReminder(session.eventCode, {
				scoutName: reminderTarget || undefined,
				matchNumber: Number.isFinite(matchNum) && matchNum > 0 ? matchNum : undefined,
				message: reminderText,
				author: managerName || null,
				roster: eventData.profiles
			});
			reminderText = '';
			reminderMatch = '';
			msg = reminderTarget
				? `Reminder sent to ${reminderTarget}.`
				: 'Reminder broadcast to every scout in this event.';
			// The list here, and the global store so the banner sees it too.
			await eventData.refreshReminders();
			await reminderStore.pull();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function removeReminder(id) {
		err = '';
		msg = '';
		try {
			busy = true;
			await deleteReminder(session.eventCode, id);
			await eventData.refreshReminders();
			await reminderStore.pull();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Scouts · Run · FRC Scout</title></svelte:head>

<PageHead title="Run" />
<SubNav mode="run" current="Scouts" />

{#if !session.eventCode}
	<Panel tone="quiet">
		<p class="muted">Choose an event from the event button in the bar above first.</p>
	</Panel>
{:else}
	<Panel
		title="By scout"
		hint={!eventData.rosterReady || eventData.rosterError
			? ''
			: perScout.length === 0
				? ''
				: 'Fewest first, because the useful end of this list is the top. A zero usually means a phone that has not synced rather than a scout who has not worked.'}
		flush={eventData.rosterReady && !eventData.rosterError && perScout.length > 0}
	>
		{#if !eventData.rosterReady}
			<p class="muted">{rosterSlow ? 'Still waiting on the network.' : 'Loading…'}</p>
		{:else if eventData.rosterError}
			<p class="err">{eventData.rosterError}</p>
		{:else if perScout.length === 0}
			<p class="muted">
				Nobody is on this event yet. Add scouts on <a href="{base}/studio/plan/people/">Plan › People</a>.
			</p>
		{:else}
			<Table dense>
				{#snippet head()}
					<tr>
						<th>Scout</th>
						<th data-num>Entries</th>
					</tr>
				{/snippet}
				{#each perScout as { person, name, count } (person.profileId)}
					<tr>
						<td class="who">{name}</td>
						<td data-num>
							<!-- Marked on the number, not the row: most of this list is
							     short at an event, and a wall of amber rows says
							     "everything is wrong" when the point is which ONE is. -->
							<span class:zero-n={count === 0}>{count === 0 ? '0 — nothing recorded' : count}</span>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</Panel>

	<div class="board">
		<ReminderPanel
			bind:reminderTarget
			bind:reminderMatch
			bind:reminderText
			{reminderScouts}
			recentReminders={eventData.reminders}
			{busy}
			onSend={sendReminder}
			onRemove={removeReminder}
		/>
		<ImportEntries onImported={() => eventData.refreshEntries()} />
	</div>
{/if}

{#if msg}<p class="banner ok" role="status">{msg}</p>{/if}
{#if err}<p class="banner err" role="alert">{err}</p>{/if}

<style>
	.board {
		margin-top: var(--space-4);
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
		gap: var(--space-4);
		align-items: start;
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--fs-md);
		margin: 0;
	}
	.muted a {
		color: var(--accent);
	}
	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
		margin: 0;
	}
	.who {
		font-weight: 600;
	}
	.zero-n {
		color: var(--warning);
		font-weight: 700;
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
