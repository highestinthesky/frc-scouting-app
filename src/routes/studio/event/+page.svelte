<script>
	// Who is on this event.
	//
	// This is the surface the event code used to stand in for. Access was "knows
	// a string published on The Blue Alliance"; it is now a row in event_scouts,
	// and this page is where those rows are made.
	//
	// ─── two lists, drag between them ──────────────────────────────────────────
	//
	// The draft asks for drag-and-drop, and it suits the task: staffing an event
	// is moving twenty names from "the team" to "here this weekend", and dragging
	// makes that one gesture per person with the two sets always visible.
	//
	// Every drag has a button beside it. Drag-and-drop is unreachable by keyboard,
	// awkward on a phone, and this is the only way to grant access to an event —
	// a manager who cannot drag must not be locked out of staffing their own
	// event. The buttons are the real control; dragging is the fast path.

	import { auth } from '$lib/auth.svelte.js';
	import { session } from '$lib/session.svelte.js';
	import {
		listMyEvents,
		eventRoster,
		addScoutToEvent,
		removeScoutFromEvent,
		setEventArchived
	} from '$lib/events.js';
	import { eventLabel } from '$lib/event-rules.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import Button from '$lib/components/Button.svelte';
	import Select from '$lib/components/Select.svelte';
	import EventPicker from '$lib/components/EventPicker.svelte';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import ImportEntries from '$lib/components/studio/ImportEntries.svelte';

	let events = $state([]);
	let selectedId = $state(null);
	let roster = $state([]);
	let team = $state([]);
	let busy = $state(false);
	let err = $state('');
	let msg = $state('');
	let dragging = $state(null);

	const selected = $derived(events.find((e) => e.id === selectedId) ?? null);
	const onEvent = $derived(new Set(roster.map((r) => r.profileId)));
	const available = $derived(team.filter((p) => !onEvent.has(p.id)));

	const personName = (p) =>
		`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username || 'Unnamed';

	async function load() {
		err = '';
		try {
			events = await listMyEvents();
			// Default to the event this device is actually scouting, so Studio opens
			// on the one the manager is standing at rather than the newest row.
			selectedId =
				events.find((e) => e.code === session.eventCode)?.id ?? events[0]?.id ?? null;
			team = await auth.listProfiles();
			await loadRoster();
		} catch (e) {
			err = e?.message ?? String(e);
		}
	}

	async function loadRoster() {
		roster = selectedId ? await eventRoster(selectedId) : [];
	}

	// Depends on session.eventCode as well as sign-in, because EventPicker sets it
	// — creating an event in the empty state left this page still saying "no event
	// yet" while the app bar already showed the new one. Tracking only
	// auth.signedIn meant the one action guaranteed to change the answer was the
	// one thing that did not re-run the query.
	$effect(() => {
		void auth.signedIn;
		void session.eventCode;
		load();
	});

	async function refreshRoster() {
		try {
			await loadRoster();
		} catch (e) {
			err = e?.message ?? String(e);
		}
	}

	async function add(profileId) {
		if (!selectedId) return;
		busy = true;
		err = '';
		msg = '';
		try {
			await addScoutToEvent(selectedId, profileId);
			await refreshRoster();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function remove(profileId) {
		if (!selectedId) return;
		// Removing someone mid-event cuts off their sync, and their phone will say
		// so rather than failing silently — but they will not know why unless
		// somebody tells them. Worth a confirm.
		const person = roster.find((r) => r.profileId === profileId);
		const ok = await dialog.confirm({
			title: `Take ${person ? personName(person) : 'this scout'} off ${eventLabel(selected ?? {})}?`,
			body:
				'They stop being able to sync this event immediately.\n\n' +
				'Entries they already recorded are kept, and anything still on their ' +
				'phone stays there — it will sync if you add them back.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		busy = true;
		err = '';
		try {
			await removeScoutFromEvent(selectedId, profileId);
			await refreshRoster();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function addEveryone() {
		busy = true;
		err = '';
		try {
			for (const p of available) await addScoutToEvent(selectedId, p.id);
			await refreshRoster();
			msg = 'Everyone on the team is on this event.';
		} catch (e) {
			err = e?.message ?? String(e);
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
		try {
			await setEventArchived(selected.id, archiving);
			await load();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	function onDrop(target) {
		return async (e) => {
			e.preventDefault();
			const id = dragging;
			dragging = null;
			if (!id) return;
			if (target === 'event' && !onEvent.has(id)) await add(id);
			if (target === 'team' && onEvent.has(id)) await remove(id);
		};
	}
</script>

<PageHead
	title="Event"
	sub="Who can see and sync this event. Access is this list — knowing the event code grants nothing."
>
	{#snippet actions()}
		{#if events.length > 1}
			<Select
				label="Editing"
				inline
				bind:value={selectedId}
				onchange={refreshRoster}
				disabled={busy}
				options={events.map((e) => ({
					value: e.id,
					label: eventLabel(e) + (e.archived_at ? ' (archived)' : '')
				}))}
			/>
		{/if}
	{/snippet}
</PageHead>

{#if !selected}
	<Panel tone="quiet">
		<p class="empty-line">No event yet. Create one and it becomes yours to staff.</p>
		<EventPicker />
	</Panel>
{:else}
	<div class="columns">
		<Panel
			title="On {eventLabel(selected)}"
			hint={roster.length === 0 ? 'Nobody yet. Drag a name across, or press +.' : ''}
		>
			{#snippet actions()}
				<span class="count">{roster.length}</span>
			{/snippet}
			<section
				class="col"
				ondragover={(e) => e.preventDefault()}
				ondrop={onDrop('event')}
				aria-label="Scouts on this event"
			>
			<ul>
				{#each roster as r (r.profileId)}
					<li
						draggable="true"
						ondragstart={() => (dragging = r.profileId)}
						ondragend={() => (dragging = null)}
						class:drag={dragging === r.profileId}
					>
						<span class="who">
							<span class="name">{personName(r)}</span>
							<span class="meta">{r.username}{r.role && r.role !== 'scout' ? ` · ${r.role}` : ''}</span>
						</span>
						<button
							type="button"
							class="act"
							disabled={busy}
							onclick={() => remove(r.profileId)}
							aria-label="Remove {personName(r)} from this event"
						>−</button>
					</li>
				{/each}
			</ul>
			</section>
		</Panel>

		<Panel
			title="Rest of the team"
			hint={available.length === 0 ? 'Everyone is on this event.' : ''}
		>
			{#snippet actions()}
				{#if available.length > 0}
					<Button variant="ghost" type="button" disabled={busy} onclick={addEveryone}>
						Add all {available.length}
					</Button>
				{/if}
				<span class="count">{available.length}</span>
			{/snippet}
			<section
				class="col"
				ondragover={(e) => e.preventDefault()}
				ondrop={onDrop('team')}
				aria-label="Team members not on this event"
			>
			<ul>
				{#each available as p (p.id)}
					<li
						draggable="true"
						ondragstart={() => (dragging = p.id)}
						ondragend={() => (dragging = null)}
						class:drag={dragging === p.id}
					>
						<span class="who">
							<span class="name">{personName(p)}</span>
							<span class="meta">{p.username}{p.role && p.role !== 'scout' ? ` · ${p.role}` : ''}</span>
						</span>
						<button
							type="button"
							class="act"
							disabled={busy}
							onclick={() => add(p.id)}
							aria-label="Add {personName(p)} to this event"
						>+</button>
					</li>
				{/each}
			</ul>
			</section>
		</Panel>
	</div>

	<div class="tail">
		<ImportEntries />

		<Panel
			title="This event"
			hint="{selected.code}{selected.starts_on ? ` · starts ${selected.starts_on}` : ''}"
		>
			{#snippet actions()}
				<Button variant="ghost" type="button" disabled={busy} onclick={toggleArchived}>
					{selected.archived_at ? 'Restore this event' : 'Archive this event'}
				</Button>
			{/snippet}
			<p class="hint">
				Archiving hides the event from pickers. Nothing recorded against it is
				deleted, and restoring puts it back exactly as it was.
			</p>
		</Panel>
	</div>
{/if}

{#if err}<p class="err">{err}</p>{/if}
{#if msg}<p class="ok">{msg}</p>{/if}

<style>
	/* Panel owns the two columns now. What is left is the roster row itself and
	   the drag state it carries. */

	.empty-line {
		margin: 0 0 var(--space-3);
		color: var(--text-muted);
	}
	.hint {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.tail {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.col {
		min-width: 0;
	}
	.count {
		font-size: var(--fs-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--bg-subtle);
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
	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--tap-min);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: grab;
	}
	li.drag {
		opacity: 0.5;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	/* 44px, not the 2rem it shipped at. This page's own header says the buttons
	   are the real control and dragging is the fast path — drag-and-drop is
	   unreachable by keyboard and awkward on a phone — and then sized them at 32.
	   The one control a manager MUST be able to hit was the smallest on the page. */
	.act {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		font: inherit;
		font-size: var(--fs-lg);
		line-height: 1;
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.act:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.act:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.err {
		color: var(--danger);
		font-size: var(--fs-sm);
	}
	.ok {
		color: var(--success);
		font-size: var(--fs-sm);
	}

	@media (max-width: 47.9375rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
