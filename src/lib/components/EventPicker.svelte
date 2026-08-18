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
	//   has events    a picker. The stored setting stays the CODE, because
	//                 IndexedDB keys entries on eventCode and every local query
	//                 goes through it.
	//
	// Owns its styles rather than taking a class prop: the scoping hash belongs
	// to the parent and a child never sees it, which is how two layouts broke
	// silently before. See CLAUDE.md.

	import { session } from '$lib/session.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import { listMyEvents, createEvent } from '$lib/events.js';
	import { eventLabel } from '$lib/event-rules.js';
	import { setEventCode, syncState } from '$lib/sync.svelte.js';
	import Button from './Button.svelte';

	let events = $state(/** @type {Array<object>} */ ([]));
	let loading = $state(false);
	let error = $state('');
	let creating = $state(false);
	let newCode = $state('');
	let newName = $state('');
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
				event you are on. Pick one above — recording still works meanwhile.
			</p>
		{/if}
	{/if}

	{#if auth.signedIn && auth.isManager}
		{#if creating}
			<form class="new" onsubmit={submitNew}>
				<label class="field">
					<span class="sub">Event code</span>
					<input
						bind:value={newCode}
						autocomplete="off"
						autocapitalize="none"
						placeholder="e.g. 2026onto"
						required
					/>
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
			<Button variant="ghost" type="button" onclick={() => (creating = true)}>
				Create an event
			</Button>
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
