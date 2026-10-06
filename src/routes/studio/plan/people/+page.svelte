<script>
	// Plan › People — who is on this event, and who is actually recording.
	//
	// Was /studio/event, which also picked the event (a second `selectedId` that
	// could disagree with the one in Studio's own badge), archived it and
	// imported files. The event is chosen in the app bar now, so this page edits
	// exactly the one the device is on; archiving moved to Plan › Event and
	// importing to Run › Scouts. "Scouts in this event" moved here from the
	// schedule page, because "who is scouting" was split across the two.
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
		removeScoutFromEvent
	} from '$lib/events.js';
	import { eventLabel } from '$lib/event-rules.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import { eventData } from '$lib/event-data.svelte.js';
	import { scoutRoster } from '$lib/plan-state.js';
	import Button from '$lib/components/Button.svelte';
	import PageHead from '$lib/components/studio/PageHead.svelte';
	import SubNav from '$lib/components/studio/SubNav.svelte';
	import Panel from '$lib/components/studio/Panel.svelte';
	import ScoutRoster from '$lib/components/studio/ScoutRoster.svelte';

	let events = $state([]);
	let loaded = $state(false);
	let roster = $state([]);
	let team = $state([]);
	let busy = $state(false);
	let err = $state('');
	let msg = $state('');
	let dragging = $state(null);
	let dropTarget = $state(null);

	// The event is the device's — chosen in the app bar — never a second
	// selection kept by this page.
	const selected = $derived(events.find((e) => e.code === session.eventCode) ?? null);
	const selectedId = $derived(selected?.id ?? null);

	// Assigned + recording, from the shared event data. This event's entries
	// only: the schedule page counted every entry on the device.
	const scoutsInEvent = $derived(scoutRoster(eventData.savedRows, eventData.eventEntries));
	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});
	const onEvent = $derived(new Set(roster.map((r) => r.profileId)));
	const available = $derived(team.filter((p) => !onEvent.has(p.id)));

	const personName = (p) =>
		`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username || 'Unnamed';

	async function load() {
		err = '';
		try {
			events = await listMyEvents();
			team = await auth.listProfiles();
			await loadRoster();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			loaded = true;
		}
	}

	async function loadRoster() {
		roster = selectedId ? await eventRoster(selectedId) : [];
	}

	// Depends on session.eventCode as well as sign-in, because the event switcher
	// in the app bar sets it — and creating or switching an event is the one action
	// guaranteed to change the answer. Tracking only auth.signedIn left this page
	// on the old event while the bar already showed the new one.
	$effect(() => {
		void auth.signedIn;
		void session.eventCode;
		load();
	});

	async function refreshRoster() {
		try {
			await loadRoster();
			// The shared copy too, so Run › Scouts and Home count the new roster.
			void eventData.refreshRoster();
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

	/**
	 * A manager must not be able to take THEMSELVES off an event.
	 *
	 * manages_event() is `is_super() OR (member AND role = manager)`, so the
	 * moment a manager stops being a member they stop being able to manage it —
	 * including the ability to add themselves back. The roster query returns
	 * nothing, the page shows an empty event, and the only way out is another
	 * manager, a super, or SQL.
	 *
	 * Found by doing it: removing the seeded manager emptied the whole roster on
	 * screen, because RLS had stopped returning it. The remove itself was correct;
	 * being allowed to ask for it was not.
	 *
	 * Same shape as the role picker on Accounts, which already refuses to let a
	 * manager change their own role. A super is exempt — is_super() does not
	 * depend on membership, so they can leave and return.
	 */
	const isSelf = (profileId) => profileId === auth.profile?.id;
	const canRemove = (profileId) => !isSelf(profileId) || auth.role === 'super';

	async function remove(profileId) {
		if (!selectedId) return;
		if (!canRemove(profileId)) {
			err =
				'You cannot take yourself off an event you manage — you would lose access to it, ' +
				'including the ability to add yourself back. Ask another manager or a super.';
			return;
		}
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

	/**
	 * Begin a drag.
	 *
	 * dataTransfer is set even though nothing reads it: Firefox will not START a
	 * drag without it, so the whole gesture was a no-op there while working in
	 * Chrome, which is lenient. The payload is the profile id so a future drop
	 * target could read it instead of the module-level `dragging`.
	 */
	function startDrag(e, id) {
		dragging = id;
		try {
			e.dataTransfer.setData('text/plain', String(id));
			e.dataTransfer.effectAllowed = 'move';
		} catch {
			// Some browsers lock dataTransfer outside a real user gesture. The
			// drag still works via `dragging`; do not let this abort it.
		}
	}

	function overZone(e, target) {
		// preventDefault on dragover is what MAKES an element a drop target. An
		// element without it rejects every drop silently.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropTarget = target;
	}

	function onDrop(target) {
		return async (e) => {
			e.preventDefault();
			const id = dragging;
			dragging = null;
			dropTarget = null;
			if (!id) return;
			if (target === 'event' && !onEvent.has(id)) await add(id);
			if (target === 'team' && onEvent.has(id)) await remove(id);
		};
	}
</script>

<svelte:head><title>People · Plan · FRC Scout</title></svelte:head>

<PageHead title="Plan" />
<SubNav mode="plan" current="People" />

{#if !loaded}
	<p class="empty-line">Loading…</p>
{:else if !selected}
	<Panel tone="quiet">
		<p class="empty-line">
			{session.eventCode
				? `${session.eventCode} is not an event you are on. Choose another from the event button in the bar above.`
				: 'No event chosen. Choose or create one from the event button in the bar above.'}
		</p>
	</Panel>
{:else}
	<div class="columns">
		<Panel
			title="On {eventLabel(selected)}">
			{#snippet actions()}
				<span class="count">{roster.length}</span>
			{/snippet}
			<section
				class="col"
				class:over={dropTarget === 'event'}
				ondragover={(e) => overZone(e, 'event')}
				ondragleave={() => (dropTarget = null)}
				ondrop={onDrop('event')}
				aria-label="Scouts on this event"
			>
				{#if roster.length === 0}
					<p class="drop-hint">Drag a name here, or press +</p>
				{/if}
			<ul>
				{#each roster as r (r.profileId)}
					<li
						draggable={canRemove(r.profileId)}
						ondragstart={(e) => startDrag(e, r.profileId)}
						ondragend={() => (dragging = null)}
						class:drag={dragging === r.profileId}
						class:pinned={!canRemove(r.profileId)}
					>
						<span class="who">
							<span class="name">{personName(r)}</span>
							<span class="meta">{r.username}{r.role && r.role !== 'scout' ? ` · ${r.role}` : ''}</span>
						</span>
						<button
							type="button"
							class="act"
							disabled={busy || !canRemove(r.profileId)}
							title={canRemove(r.profileId)
								? undefined
								: 'You cannot take yourself off an event you manage'}
							onclick={() => remove(r.profileId)}
							aria-label="Remove {personName(r)} from this event"
						>−</button>
					</li>
				{/each}
			</ul>
			</section>
		</Panel>

		<Panel
			title="Rest of the team">
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
				class:over={dropTarget === 'team'}
				ondragover={(e) => overZone(e, 'team')}
				ondragleave={() => (dropTarget = null)}
				ondrop={onDrop('team')}
				aria-label="Team members not on this event"
			>
				{#if available.length === 0}
					<p class="drop-hint">Everyone is on this event. Drag a name here to take them off.</p>
				{/if}
			<ul>
				{#each available as p (p.id)}
					<li
						draggable="true"
						ondragstart={(e) => startDrag(e, p.id)}
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
		<ScoutRoster {scoutsInEvent} {now} />
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

	/* A drop zone with no height is not a drop zone.
	   "Rest of the team" is empty whenever everyone is on the event — the normal
	   case — so this section collapsed to nothing and there was physically no
	   target to drop a scout onto. Dragging IN worked, because that list had rows
	   and therefore height; dragging back OUT could not, and looked like the
	   handler was broken when the handler was never reached. */
	.col {
		min-width: 0;
		min-height: var(--space-6);
		border-radius: var(--radius-md);
		border: 1px dashed transparent;
		transition: background var(--dur-short) var(--ease-out);
	}
	/* Feedback while a drag is over it, because an invisible target that happens
	   to work is only marginally better than one that does not. */
	.col.over {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.drop-hint {
		margin: 0;
		padding: var(--space-3);
		text-align: center;
		font-size: var(--fs-sm);
		color: var(--text-faint);
	}

	@media (prefers-reduced-motion: reduce) {
		.col {
			transition-duration: 0.01ms;
		}
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
	/* Not draggable, so it must not offer the grab cursor. */
	li.pinned {
		cursor: default;
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
