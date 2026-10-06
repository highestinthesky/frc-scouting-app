<script>
	// Select only events available to this account through server-side membership
	// rules. Scouts explicitly choose; managers may adopt the current dated event.

	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { listMyEvents, createEvent } from '$lib/events.js';
	import { eventLabel, looksLikeTbaKey, currentEvent as pickCurrentEvent } from '$lib/event-rules.js';
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
	let loadVersion = 0;

	async function load() {
		const version = ++loadVersion;
		if (!auth.signedIn) {
			events = [];
			loading = false;
			return;
		}
		loading = true;
		error = '';
		try {
			const rows = await listMyEvents();
			if (version === loadVersion) events = rows;
		} catch (e) {
			if (version === loadVersion) error = e?.message ?? String(e);
		} finally {
			if (version === loadVersion) loading = false;
		}
	}

	$effect(() => {
		void auth.signedIn;
		void auth.profile?.id;
		load();
	});

	$effect(() => {
		if (!auth.isManager || session.eventCode || events.length === 0) return;
		const pick = pickCurrentEvent(events);
		if (pick) choose(pick.code);
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
		<p class="note">Loading…</p>
	{:else if events.length === 0 && !error}
		<p class="note">No events available. Ask your manager to add you to an event, then refresh.</p>
		<div class="start"><Button onclick={load} disabled={loading}>Refresh events</Button></div>
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
				<strong>{session.eventCode}</strong> is not one of your events.
				Pick one above.
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
							Not a TBA key. Schedule fetching may be unavailable.
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

	{#if error}<p class="err" role="alert">{error}</p><div class="retry"><Button onclick={load} disabled={loading || busy}>Try again</Button></div>{/if}
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


	.start {
		display: flex;
		justify-content: flex-start;

	}
	.retry { display: flex; }
	.event .name, .event .meta { overflow-wrap: anywhere; max-width: 100%; }
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
		cursor: not-allowed;
	}
	.event:active:not(:disabled) { background: var(--bg-elev); }
	@media (prefers-reduced-motion: reduce) { .event { transition-duration: 0.01ms; } }
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
