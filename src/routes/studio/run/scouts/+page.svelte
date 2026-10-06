<script>
	// Run › Scouts — talking to the people recording, and collecting from a phone
	// that cannot sync.
	//
	// Reminders were on /studio/schedule, a match noun, and collecting a file was
	// on /studio/event, a membership noun. Both are things a manager does to or
	// for a scout during the event, so they are here. Coverage's "By scout" joins
	// them when Coverage folds into Run.

	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { createReminder, deleteReminder } from '$lib/reminders.js';
	import { reminders as reminderStore } from '$lib/reminders.svelte.js';
	import { scoutNames } from '$lib/plan-state.js';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import ReminderPanel from '$lib/components/studio/ReminderPanel.svelte';
	import ImportEntries from '$lib/components/studio/ImportEntries.svelte';

	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	let reminderTarget = $state(''); // '' = broadcast; otherwise a scout name
	let reminderMatch = $state('');
	let reminderText = $state('');

	const reminderScouts = $derived(scoutNames(eventData.savedRows));
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
