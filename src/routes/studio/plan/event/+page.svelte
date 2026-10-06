<script>
	// Plan › Event — the event row itself: its name, its dates, archiving it, and
	// wiping its planning data.
	//
	// Three of these existed and one was reachable. Archive sat at the bottom of
	// /studio/event; resetting the planning data was a fully written function in
	// /studio/schedule that no control ever called; and dates could not be set
	// at all, which is what strands a scout on two undated events (currentEvent()
	// cannot choose between them). They are one page now because they are all
	// "this event, as a thing", rather than anything happening at it.

	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { listMyEvents, setEventArchived, setEventDetails } from '$lib/events.js';
	import { resetEventData } from '$lib/event-meta.js';
	import { eventLabel } from '$lib/event-rules.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import Button from '$lib/components/Button.svelte';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';

	let events = $state(/** @type {any[]} */ ([]));
	let loaded = $state(false);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	let name = $state('');
	let startsOn = $state('');
	let endsOn = $state('');

	const selected = $derived(events.find((e) => e.code === session.eventCode) ?? null);
	const dirty = $derived(
		Boolean(selected) &&
			(name.trim() !== (selected.name ?? '') ||
				startsOn !== (selected.starts_on ?? '') ||
				endsOn !== (selected.ends_on ?? ''))
	);

	async function load() {
		err = '';
		try {
			events = await listMyEvents();
			const ev = events.find((e) => e.code === session.eventCode);
			name = ev?.name ?? '';
			startsOn = ev?.starts_on ?? '';
			endsOn = ev?.ends_on ?? '';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		void auth.signedIn;
		void session.eventCode;
		load();
	});

	async function saveDetails(e) {
		e.preventDefault();
		if (!selected) return;
		busy = true;
		err = '';
		msg = '';
		try {
			await setEventDetails(selected.id, { name, startsOn, endsOn });
			await load();
			msg = 'Saved.';
		} catch (e2) {
			err = e2?.message ?? String(e2);
		} finally {
			busy = false;
		}
	}

	async function toggleArchived() {
		if (!selected) return;
		const archiving = !selected.archived_at;
		const ok = await dialog.confirm({
			title: archiving ? `Archive ${eventLabel(selected)}?` : `Restore ${eventLabel(selected)}?`,
			body: archiving
				? 'It drops to the bottom of every picker and frees its code for reuse ' +
					'next season.\n\nNothing is deleted, and you can restore it here.'
				: 'It becomes a current event again.',
			confirmLabel: archiving ? 'Archive' : 'Restore'
		});
		if (!ok) return;
		busy = true;
		err = '';
		msg = '';
		try {
			await setEventArchived(selected.id, archiving);
			await load();
			msg = archiving ? 'Archived.' : 'Restored.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function resetScheduling() {
		err = '';
		msg = '';
		try {
			const ok = await dialog.confirm({
				title: `Reset planning for ${session.eventCode}?`,
				body:
					`Removes the published schedule, assignments, overrides, reminders and shared ` +
					`picklist for this event.\n\nScout-collected entries are NOT touched.`,
				confirmLabel: 'Reset planning',
				danger: true
			});
			if (!ok) return;
			busy = true;
			await resetEventData(session.eventCode);
			await eventData.load(session.eventCode);
			msg = 'Planning data reset. Scouting entries were kept.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Event · Plan · FRC Scout</title></svelte:head>

<PageHead title="Plan" />
<SubNav mode="plan" current="Event" />

{#if !loaded}
	<p class="muted">Loading…</p>
{:else if !selected}
	<Panel tone="quiet">
		<p class="muted">
			{session.eventCode
				? `${session.eventCode} is not an event you are on. Choose another from the event button in the bar above.`
				: 'No event chosen. Choose or create one from the event button in the bar above.'}
		</p>
	</Panel>
{:else}
	<div class="stack">
		<Panel title="Details" hint={selected.code}>
			<form class="details" onsubmit={saveDetails}>
				<label class="field">
					<span class="label">Name</span>
					<input bind:value={name} autocomplete="off" required />
				</label>
				<div class="dates">
					<label class="field">
						<span class="label">Starts</span>
						<input type="date" bind:value={startsOn} />
					</label>
					<label class="field">
						<span class="label">Ends</span>
						<input type="date" bind:value={endsOn} min={startsOn || undefined} />
					</label>
				</div>
				<p class="help">
					Dates let a scout who is on more than one event land on the right one
					without asking.
				</p>
				<div>
					<Button variant="primary" type="submit" disabled={busy || !dirty}>Save</Button>
				</div>
			</form>
		</Panel>

		<Panel
			title={selected.archived_at ? 'Archived' : 'Archive'}
			hint={selected.archived_at
				? 'Restoring makes it a current event again.'
				: 'When the event is over. Frees the code for next season; deletes nothing.'}
		>
			{#snippet actions()}
				<Button type="button" disabled={busy} onclick={toggleArchived}>
					{selected.archived_at ? 'Restore this event' : 'Archive this event'}
				</Button>
			{/snippet}
		</Panel>

		<Panel
			title="Reset planning"
			hint="Removes the published schedule, assignments, overrides, reminders and picklist. Keeps every scouting entry."
		>
			{#snippet actions()}
				<Button variant="danger" type="button" disabled={busy} onclick={resetScheduling}>
					Reset planning
				</Button>
			{/snippet}
		</Panel>
	</div>
{/if}

{#if msg}<p class="banner ok" role="status">{msg}</p>{/if}
{#if err}<p class="banner err" role="alert">{err}</p>{/if}

<style>
	.stack {
		max-width: var(--w-read);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.details {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.dates {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		font-weight: 600;
		font-size: var(--fs-md);
	}
	input {
		font: inherit;
		font-size: var(--fs-control);
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.help {
		margin: 0;
		color: var(--text-faint);
		font-size: var(--fs-sm);
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
