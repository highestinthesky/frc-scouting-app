<script>
	// What the sync layer is doing, in words, from anywhere in the app.
	//
	// ─── why this is not just a dot ───────────────────────────────────────────
	//
	// The app bar had a four-state coloured dot with a `title` attribute. A title
	// needs a mouse to hover, which a scout in a gym does not have, so on the
	// device this app is actually used on the dot said nothing at all. Everything
	// legible — the pending count, the last sync time, the retry — lived on
	// Settings, two taps away from every screen.
	//
	// That matters more than it sounds. The single question a scout asks at an
	// event is "is my work safe", and the honest answers are different enough to
	// need different responses:
	//
	//   offline          keep scouting, it will go up later
	//   signed out       keep scouting, but sign in before you leave
	//   not on the event ask a manager to add you — you cannot fix this yourself
	//   error            something is wrong and a manager should know
	//
	// A dot cannot say any of those. It can only be a colour that someone learns
	// to ignore.
	//
	// ─── the count is the reassurance ─────────────────────────────────────────
	//
	// "3 entries waiting" is not a warning, it is the app saying it still has them.
	// A scout who records six matches in a dead corner of a venue needs to see the
	// number go up and then go down, or they will re-record from paper.

	import { syncState, resync } from '$lib/sync.svelte.js';
	import { session } from '$lib/session.svelte.js';
	import { relativeTime } from '$lib/format.js';

	let open = $state(false);

	const view = $derived.by(() => {
		if (!session.eventCode) {
			return {
				tone: 'idle',
				head: 'No event chosen',
				body: 'Pick an event in Settings to share what you record with your team.'
			};
		}
		if (syncState.reason === 'signed-out') {
			return {
				tone: 'idle',
				head: 'Paused — not signed in',
				body: 'Everything you record is saved on this phone. Sign in to send it to your team — do that before you leave the venue.'
			};
		}
		if (syncState.reason === 'no-such-event') {
			return {
				tone: 'warn',
				head: 'Not on this event',
				body: `You are set to ${session.eventCode}, which is not an event you belong to. A manager has to add you — recording still works meanwhile.`
			};
		}
		if (syncState.status === 'offline') {
			return {
				tone: 'warn',
				head: 'Offline',
				body: 'Keep scouting. Everything is saved here and goes up the moment you have signal again.'
			};
		}
		if (syncState.status === 'error') {
			return {
				tone: 'err',
				head: 'Sync problem',
				body: syncState.error || 'Something went wrong talking to the server. It will keep retrying.'
			};
		}
		if (syncState.status === 'connecting') {
			return { tone: 'pending', head: 'Syncing…', body: 'Sending and collecting entries.' };
		}
		return { tone: 'ok', head: 'Synced', body: 'Everything on this device has reached your team.' };
	});

	const pending = $derived(syncState.pendingCount ?? 0);
</script>

<button
	type="button"
	class="chip {view.tone}"
	aria-expanded={open}
	onclick={() => (open = !open)}
>
	<span class="dot" aria-hidden="true"></span>
	<!-- The count sits in the bar, not behind the tap. It is the one number worth
	     surfacing without asking, and its absence is the good news. -->
	{#if pending > 0}
		<span class="count">{pending}</span>
	{/if}
	<span class="sr-only">Sync status: {view.head}{pending > 0 ? `, ${pending} waiting` : ''}</span>
</button>

{#if open}
	<!-- Click-away. A plain button rather than a div so it is reachable by
	     keyboard and announced, instead of being an invisible trap. -->
	<button type="button" class="scrim" aria-label="Close sync details" onclick={() => (open = false)}
	></button>
	<div class="sheet {view.tone}" role="status">
		<strong class="head">{view.head}</strong>
		<p class="body">{view.body}</p>

		<dl class="facts">
			<div>
				<dt>Waiting to upload</dt>
				<dd>{pending === 0 ? 'Nothing' : `${pending} ${pending === 1 ? 'entry' : 'entries'}`}</dd>
			</div>
			<div>
				<dt>Last synced</dt>
				<dd>{syncState.lastSyncedAt ? relativeTime(syncState.lastSyncedAt) : 'Not yet'}</dd>
			</div>
		</dl>

		<button
			type="button"
			class="retry"
			disabled={!session.eventCode || syncState.status === 'connecting'}
			onclick={() => {
				resync();
				open = false;
			}}
		>
			{syncState.status === 'connecting' ? 'Syncing…' : 'Sync now'}
		</button>
	</div>
{/if}

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--tap-min);
		min-width: var(--tap-min);
		justify-content: center;
		padding: 0 var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
		font: inherit;
	}
	.chip:hover {
		background: var(--bar-chip-bg);
	}
	.chip:focus-visible {
		outline: 2px solid var(--bar-ink);
		outline-offset: 2px;
	}

	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		flex: none;
	}
	/* Shape and count carry the state as well as hue — a red/green pair is the one
	   distinction a colourblind scout in a loud gym cannot make. */
	.ok .dot { background: var(--dot-ok); }
	.pending .dot { background: var(--dot-pending); }
	.offline .dot,
	.warn .dot { background: var(--dot-offline); }
	.err .dot { background: var(--dot-err); }
	.idle .dot { background: var(--dot-idle); }

	.count {
		font-size: var(--fs-xs);
		font-weight: 700;
		color: var(--bar-badge-ink);
		background: var(--bar-badge-bg);
		border-radius: var(--radius-pill);
		padding: 0 var(--space-1);
		min-width: 1.25rem;
		text-align: center;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: none;
		border: none;
		cursor: default;
	}

	.sheet {
		position: fixed;
		z-index: 81;
		top: calc(var(--app-bar-h) + var(--space-2));
		right: var(--space-3);
		left: var(--space-3);
		max-width: 22rem;
		margin-left: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow-md);
	}
	.sheet.warn { border-color: var(--warning-border); }
	.sheet.err { border-color: var(--danger); }
	.sheet.ok { border-color: var(--success-border); }

	.head {
		font-size: var(--fs-lg);
		color: var(--text-primary);
	}
	.body {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.45;
		color: var(--text-muted);
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-2) 0 0;
		border-top: 1px solid var(--border);
	}
	.facts div {
		min-width: 0;
	}
	dt {
		font-size: var(--fs-xs);
		color: var(--text-faint);
	}
	dd {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text-primary);
	}

	.retry {
		min-height: var(--tap-min);
		margin-top: var(--space-1);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-strong);
		background: var(--bg-subtle);
		color: var(--text-primary);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.retry:hover:not(:disabled) {
		background: var(--bg-elev);
	}
	.retry:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.retry:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
