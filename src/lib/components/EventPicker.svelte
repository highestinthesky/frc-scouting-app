<script>
	// Choosing an event, now that events are rows rather than a typed string.
	//
	// The field this replaces was a free-text box: type any code and you shared
	// data with everyone who typed the same one. That was the whole security
	// model, and the code is published on The Blue Alliance, so it was never a
	// secret. Membership replaced it in 0019.
	//
	// ─── what this component has to be honest about ───────────────────────────
	//
	// Three states, and the reason each exists is that guessing wrong loses a
	// scout's afternoon:
	//
	//   signed out    events is granted to `authenticated` and nobody else, so
	//                 there is nothing to list. Recording still works — that
	//                 invariant does not move — so this says so rather than
	//                 looking broken or, worse, looking fine.
	//   no events     signed in but on nothing. A scout cannot fix this alone;
	//                 a manager adds them. Saying "ask a manager" is the whole
	//                 remedy, so it is the whole message.
	//   has events    a picker FOR A MANAGER only. The stored setting stays the
	//                 CODE, because IndexedDB keys entries on eventCode and every
	//                 local query goes through it.
	//
	// ─── a scout does not choose ──────────────────────────────────────────────
	//
	// Which event a scout is on is a membership fact a manager sets, not a
	// preference. Offering the list let a scout point their device at a different
	// event and record an afternoon into the wrong one — recoverable only by
	// noticing, and the entries carry the event code they were recorded under.
	//
	// So a scout SEES their event and cannot change it. If they belong to exactly
	// one and nothing is selected yet, it is adopted automatically: the alternative
	// is a scout staring at a surface with no event and no control to fix it,
	// which is the dead end this component exists to avoid.
	//
	// Owns its styles rather than taking a class prop: the scoping hash belongs
	// to the parent and a child never sees it, which is how two layouts broke
	// silently before. See CLAUDE.md.

	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { listMyEvents, createEvent } from '$lib/events.js';
	import { eventLabel, looksLikeTbaKey } from '$lib/event-rules.js';
	import { setEventCode, syncState } from '$lib/sync.svelte.js';
	import Button from './Button.svelte';

	let events = $state(/** @type {Array<object>} */ ([]));
	let loading = $state(false);
	let error = $state('');
	let creating = $state(false);
	let newCode = $state('');
	let newName = $state('');

	/**
	 * Advisory, not a gate.
	 *
	 * events.code IS the TBA key — 0019's table comment says so, and
	 * PublishSchedule already defaults its lookup to it — so a code invented here
	 * means typing a second, different string into a second box later, and
	 * wondering why the schedule will not fetch.
	 *
	 * Not enforced, because an offseason scrimmage has no TBA entry and still has
	 * to be scoutable. Warn, and let the manager proceed.
	 */
	const codeLooksOff = $derived(newCode.trim().length > 0 && !looksLikeTbaKey(newCode));
	let busy = $state(false);

	async function load() {
		if (!auth.signedIn) {
			events = [];
			return;
		}
		loading = true;
		error = '';
		try {
			events = await listMyEvents();
		} catch (e) {
			error = e?.message ?? String(e);
		} finally {
			loading = false;
		}
	}

	// Reruns when sign-in state changes, which is exactly when the answer moves:
	// signing in is what makes the list readable at all.
	$effect(() => {
		void auth.signedIn;
		load();
	});

	/** A scout may look but not switch; a manager runs events and may. */
	const canChoose = $derived(auth.isManager);

	/** The event this device is on, as a row, when we can name it. */
	const currentEvent = $derived(events.find((e) => e.code === session.eventCode) ?? null);

	// A scout on exactly one event, with nothing selected, is adopted into it.
	// Without this, removing the picker would leave them with no event and no way
	// to get one.
	$effect(() => {
		if (!auth.signedIn || canChoose) return;
		if (session.eventCode || events.length !== 1) return;
		choose(events[0].code);
	});

	async function choose(code) {
		busy = true;
		error = '';
		try {
			await session.update({ eventCode: code });
			// Tell sync directly rather than waiting for the layout's effect. The
			// scout pressed a control and expects the status to move now.
			await setEventCode(code);
		} catch (e) {
			error = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function submitNew(e) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			await createEvent({ code: newCode, name: newName });
			await load();
			await choose(newCode.trim().toLowerCase());
			creating = false;
			newCode = '';
			newName = '';
		} catch (err) {
			error = err?.message ?? String(err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="picker">
	<span class="label">Event</span>

	{#if !auth.signedIn}
		<p class="note">
			{#if session.eventCode}
				Recording to <strong>{session.eventCode}</strong>. Not signed in.
			{:else}
				Sign in to choose an event.
			{/if}
		</p>
	{:else if loading}
		<p class="note">Loading your events…</p>
	{:else if events.length === 0}
		Not on any event yet.
	{:else if !canChoose}
		<!-- A scout sees the event, and that is all. See the header note. -->
		{#if currentEvent}
			<p class="current-event">
				<span class="name">{eventLabel(currentEvent)}</span>
				<span class="meta">
					{currentEvent.code}{#if currentEvent.starts_on} · {currentEvent.starts_on}{/if}
				</span>
			</p>
		{:else if session.eventCode}
			<p class="current-event">
				<span class="name">{session.eventCode}</span>
			</p>
		{:else}
			<p class="note">A manager puts you on an event.</p>
		{/if}
	{:else}
		<ul class="events">
			{#each events as ev (ev.id)}
				<li>
					<button
						type="button"
						class="event"
						class:current={session.eventCode === ev.code}
						aria-current={session.eventCode === ev.code ? 'true' : undefined}
						disabled={busy}
						onclick={() => choose(ev.code)}
					>
						<span class="name">{eventLabel(ev)}</span>
						<span class="meta">
							{ev.code}{#if ev.starts_on} · {ev.starts_on}{/if}{#if ev.archived_at} · archived{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>

		{#if syncState.reason === 'no-such-event'}
			<p class="warn">
				This device is set to <strong>{session.eventCode}</strong>, which is not an
				event you are on.
				{canChoose ? 'Pick one above.' : 'Ask a manager to add you.'}
				Recording still works meanwhile.
			</p>
		{/if}
	{/if}

	{#if auth.signedIn && auth.isManager}
		{#if creating}
			<form class="new" onsubmit={submitNew}>
				<label class="field">
					<span class="sub">TBA event key</span>
					<input
						bind:value={newCode}
						autocomplete="off"
						autocapitalize="none"
						placeholder="2026nyny"
						required
					/>
					{#if codeLooksOff}
						<small class="hint-off">
							Not a Blue Alliance key. The schedule fetch uses this — an offseason
							event with no TBA entry is fine, anything else will not pull.
						</small>
					{/if}
				</label>
				<label class="field">
					<span class="sub">Name</span>
					<input bind:value={newName} placeholder="e.g. Ontario Provincials" />
				</label>
				<div class="row">
					<Button variant="primary" type="submit" disabled={busy}>
						{busy ? 'Creating…' : 'Create event'}
					</Button>
					<Button variant="ghost" type="button" onclick={() => (creating = false)}>Cancel</Button>
				</div>
			</form>
		{:else}
			<!-- Wrapped so it does not stretch. `.picker` is a column flex with the
			     default align-items: stretch, so a bare Button spans the full width —
			     and a GHOST button has no fill, so all that showed was its centred
			     label floating in the middle of a left-aligned page. It read as a
			     misalignment because it was one. -->
			<div class="start">
				<Button variant="ghost" type="button" onclick={() => (creating = true)}>
					Create an event
				</Button>
			</div>
		{/if}
	{/if}

	{#if error}<p class="err">{error}</p>{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	/* Anything that should sit at its natural width rather than filling the
	   column.
	   Pulled left by the button's own horizontal padding so its LABEL lines up
	   with the text above it. A ghost button draws no box, so that padding is
	   invisible and reads as a 16px indent rather than as spacing. */
	.hint-off {
		font-size: var(--fs-xs);
		color: var(--warning);
	}

	.current-event {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-card);
	}

	.start {
		display: flex;
		justify-content: flex-start;
		margin-left: calc(var(--space-4) * -1);
	}
	.label {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text-primary);
	}
	.note,
	.warn,
	.err {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.45;
	}
	.note {
		color: var(--text-muted);
	}
	.warn {
		color: var(--text-primary);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		padding: var(--space-2);
	}
	.err {
		color: var(--danger);
	}

	.events {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.event {
		width: 100%;
		min-height: var(--tap-min);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: var(--space-2);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-short) var(--ease-out);
	}
	.event:hover:not(:disabled) {
		background: var(--bg-elev);
	}
	.event:disabled {
		opacity: 0.6;
		cursor: default;
	}
	/* The selected event is marked with a border and a filled dot, not colour
	   alone — a red/green pair is the one distinction a colourblind scout in a
	   loud gym cannot make. */
	.event.current {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.event.current .name::before {
		content: '● ';
		color: var(--accent);
	}

	.name {
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.meta {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.new {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}
	.row {
		display: flex;
		gap: var(--space-2);
	}
</style>
