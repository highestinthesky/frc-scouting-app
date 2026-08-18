<script>
	// Collecting a scout's file when the gym has no wifi.
	//
	// The scout saves a bundle from the sync panel and hands it over — AirDrop, a
	// cable, a memory stick, email once there is signal. This is the other end.
	//
	// ─── it previews before it merges ─────────────────────────────────────────
	//
	// A manager pressing import at an event is merging someone else's afternoon
	// into their device, from a file they did not write. "Are you sure?" is not a
	// useful question at that moment. "47 new, 12 already here, 3 for another
	// event" is, because each of those numbers is one a manager can sanity-check
	// against what they expect — and a wrong file usually announces itself as a
	// number that makes no sense rather than as an error.
	//
	// Importing twice is safe regardless: the entries table indexes a content
	// fingerprint and importEntries() resolves every row against it. The preview
	// exists so a human can catch the wrong FILE, which no fingerprint can.

	import { listEntries, importEntries } from '$lib/db.js';
	import { parseBundle, planImport } from '$lib/transfer.js';
	import { session } from '$lib/session.svelte.js';
	import { relativeTime } from '$lib/format.js';
	import Panel from './Panel.svelte';
	import Button from '../Button.svelte';

	let { onImported = () => {} } = $props();

	let fileInput = $state(null);
	let bundle = $state(null);
	let plan = $state(null);
	let filename = $state('');
	let err = $state('');
	let busy = $state(false);
	let done = $state('');

	/**
	 * Clear the preview, but NOT the input.
	 *
	 * These were one function once, and clearing the input inside it was a bug
	 * that broke the whole panel: pick() called reset() first, reset() set
	 * fileInput.value = '', and setting value on a file input empties its
	 * FileList — so the very next line read the file the user had just chosen out
	 * of an input that no longer had it, got undefined, and returned silently.
	 * Nothing rendered, nothing errored. Every unit test still passed, because
	 * none of them go through the DOM.
	 */
	function clearPreview() {
		bundle = null;
		plan = null;
		filename = '';
		err = '';
		done = '';
	}

	/** Clear the preview AND forget the chosen file. For Cancel, and after a
	 *  successful import — where leaving the filename sitting there would suggest
	 *  the file is still pending. */
	function reset() {
		clearPreview();
		if (fileInput) fileInput.value = '';
	}

	async function pick(event) {
		// Read the file BEFORE clearing anything. See clearPreview().
		const file = event.currentTarget.files?.[0];
		clearPreview();
		if (!file) return;
		filename = file.name;
		busy = true;
		try {
			const parsed = parseBundle(await file.text());
			if (!parsed.ok) {
				err = parsed.error;
				return;
			}
			bundle = parsed.bundle;
			// Scoped to the event this device is operating on, so last week's data
			// cannot quietly join this week's numbers.
			plan = planImport(bundle, await listEntries(), { eventCode: session.eventCode });
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function confirm() {
		if (!plan?.fresh.length) return;
		busy = true;
		err = '';
		try {
			// $state.snapshot, not plan.fresh directly.
			//
			// `bundle` is $state, so every row inside it is a reactive PROXY, and
			// IndexedDB writes go through structured clone — which cannot clone a
			// proxy. Passing them straight through failed with
			// "DataCloneError: #<Object> could not be cloned", at the moment a
			// manager pressed the button, with the preview still on screen saying
			// two entries were about to be added.
			//
			// Every unit test passed throughout: they call planImport() on plain
			// objects and never touch a database. Only the browser could find this.
			const res = await importEntries($state.snapshot(plan.fresh));
			done = `${res.inserted} added${res.skipped ? `, ${res.skipped} already here` : ''}.`;
			bundle = null;
			plan = null;
			if (fileInput) fileInput.value = '';
			onImported();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Panel
	title="Collect from a file"
	hint="When the venue has no usable wifi, a scout saves a file from their sync panel and hands it over. Importing the same file twice is safe."
>
	<div class="row">
		<label class="pickbtn">
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				onchange={pick}
				disabled={busy}
			/>
			<span>Choose a file</span>
		</label>
		{#if filename}<span class="fname">{filename}</span>{/if}
	</div>

	{#if err}
		<p class="err" role="alert">{err}</p>
	{/if}

	{#if done}
		<p class="ok" role="status">{done}</p>
	{/if}

	{#if bundle && plan}
		<dl class="facts">
			<div>
				<dt>From</dt>
				<dd>{bundle.scoutName || 'an unnamed device'}</dd>
			</div>
			<div>
				<dt>Saved</dt>
				<dd>{bundle.exportedAt ? relativeTime(bundle.exportedAt) : 'unknown'}</dd>
			</div>
			<div>
				<dt>Event</dt>
				<dd>{bundle.eventCode || 'not stated'}</dd>
			</div>
		</dl>

		<ul class="plan">
			<li class="new">
				<strong>{plan.fresh.length}</strong>
				<span>new {plan.fresh.length === 1 ? 'entry' : 'entries'}</span>
			</li>
			<li>
				<strong>{plan.duplicate.length}</strong>
				<span>already here</span>
			</li>
			{#if plan.otherEvent.length}
				<li class="warn">
					<strong>{plan.otherEvent.length}</strong>
					<span>for another event — skipped</span>
				</li>
			{/if}
			{#if plan.malformed.length}
				<li class="warn">
					<strong>{plan.malformed.length}</strong>
					<span>unreadable — skipped</span>
				</li>
			{/if}
		</ul>

		<div class="acts">
			<Button
				variant="primary"
				disabled={busy || plan.fresh.length === 0}
				onclick={confirm}
			>
				{plan.fresh.length === 0
					? 'Nothing new to add'
					: `Add ${plan.fresh.length} ${plan.fresh.length === 1 ? 'entry' : 'entries'}`}
			</Button>
			<Button variant="ghost" disabled={busy} onclick={reset}>Cancel</Button>
		</div>
	{/if}
</Panel>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	/* The native file input is unstylable and says "No file chosen" in the
	   platform's own voice. The label IS the button; the input inside it stays
	   in the accessibility tree and keeps the keyboard behaviour, rather than
	   being display:none with a click() forwarded to it. */
	.pickbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		font-weight: 600;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.pickbtn:hover {
		background: var(--bg-subtle);
	}
	.pickbtn:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.pickbtn input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.fname {
		font-size: var(--fs-sm);
		color: var(--text-muted);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin: var(--space-4) 0 var(--space-3);
	}
	.facts dt {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.facts dd {
		margin: 2px 0 0;
		font-size: var(--fs-sm);
		font-weight: 600;
	}

	.plan {
		list-style: none;
		margin: 0 0 var(--space-4);
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.plan li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.plan strong {
		font-size: var(--fs-lg);
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.plan .new strong {
		color: var(--success);
	}
	.plan .warn {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.plan .warn strong {
		color: var(--warning);
	}

	.acts {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.err {
		margin: var(--space-3) 0 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--danger-bg);
		border: 1px solid var(--banner-red-border);
		color: var(--danger);
		font-size: var(--fs-sm);
	}
	.ok {
		margin: var(--space-3) 0 0;
		font-size: var(--fs-sm);
		color: var(--success);
		font-weight: 600;
	}
</style>
