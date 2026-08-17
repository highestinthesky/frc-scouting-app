<script>
	// Reminders that arrive, are read, and leave.
	//
	// ─── what this replaces ───────────────────────────────────────────────────
	//
	// A static stack under the nav: up to three at once, pushing every page down,
	// persisting until dismissed or expired. That is not a notification, it is
	// furniture — and furniture that costs vertical space on the one screen a
	// scout uses one-handed in a gym. Worse, a reminder that never leaves stops
	// being read; it becomes part of the layout.
	//
	// ─── two kinds, because two things happen ─────────────────────────────────
	//
	//   fly-by   informational. Slides in, sits for a few seconds, leaves on its
	//            own. Nothing is lost if it is missed, because it is also still
	//            in the list behind the bell.
	//   popup    actionable NOW. A match to scout, with a deep link into the
	//            pre-filled form. It waits to be answered rather than expiring,
	//            because "you are up in two matches" is not information, it is a
	//            job.
	//
	// The split is the presence of a match to scout, not the reminder's author. A
	// manager typing "check the pit" is informational; the automatic "you have
	// team 3419 in Q12" is not.
	//
	// ─── what it must not do ──────────────────────────────────────────────────
	//
	// Never steal focus. A scout mid-way through a form is recording a match that
	// is happening in front of them, and moving focus loses a half-typed field and
	// their place. The popup renders, it does not autofocus, and it never blocks
	// the page beneath it.

	import { base } from '$app/paths';
	import { reminders } from '$lib/reminders.svelte.js';
	import { SvelteSet } from 'svelte/reactivity';

	/** How long an informational reminder stays before it leaves by itself. */
	const FLYBY_MS = 8000;

	/** Ids already flown past, so a re-render does not replay them. */
	const flown = new SvelteSet();
	let showing = $state(/** @type {any[]} */ ([]));

	const list = $derived(reminders.visible);

	/**
	 * A reminder that names a match is a job; anything else is information.
	 * Auto reminders carry the exact team, manager ones may carry only the match.
	 */
	const isActionable = (r) => Number.isFinite(r?.match_number) && r.match_number > 0;

	const popups = $derived(list.filter(isActionable));

	// New informational reminders fly by once each.
	$effect(() => {
		for (const r of list) {
			if (isActionable(r) || flown.has(r.id)) continue;
			flown.add(r.id);
			showing = [...showing, r];
			setTimeout(() => {
				showing = showing.filter((x) => x.id !== r.id);
			}, FLYBY_MS);
		}
	});

	function scoutHref(r) {
		if (!isActionable(r)) return null;
		const qp = new URLSearchParams({ match: String(r.match_number) });
		if (Number.isFinite(r.team) && r.team > 0) qp.set('team', String(r.team));
		return `${base}/scouting/new/?${qp.toString()}`;
	}

	async function dismiss(r) {
		showing = showing.filter((x) => x.id !== r.id);
		await reminders.dismiss(r.id, r.expires_at);
	}
</script>

<!-- Fly-bys. aria-live polite, not assertive: a scout mid-form should hear this
     at the next natural pause, not have their sentence interrupted. -->
<div class="flyby-rail" aria-live="polite" aria-label="Reminders">
	{#each showing as r (r.id)}
		<div class="flyby">
			<span class="msg">{r.message}</span>
			{#if r.author}<small class="who">— {r.author}</small>{/if}
			<button type="button" class="x" aria-label="Dismiss" onclick={() => dismiss(r)}>✕</button>
		</div>
	{/each}
</div>

<!-- Jobs. One at a time: a stack of interruptions is the shelf again. -->
{#if popups.length > 0}
	{@const r = popups[0]}
	<div class="popup" role="alertdialog" aria-labelledby="rem-title">
		<div class="card">
			<strong id="rem-title" class="title">
				{r.kind === 'auto' ? "You're up" : 'From your manager'}
			</strong>
			<p class="body">{r.message}</p>
			{#if r.author}<small class="who">— {r.author}</small>{/if}
			<div class="actions">
				{#if scoutHref(r)}
					<a class="go" href={scoutHref(r)} onclick={() => dismiss(r)}>Scout it</a>
				{/if}
				<button type="button" class="later" onclick={() => dismiss(r)}>Dismiss</button>
			</div>
			{#if popups.length > 1}
				<small class="more">{popups.length - 1} more waiting</small>
			{/if}
		</div>
	</div>
{/if}

<style>
	.flyby-rail {
		position: fixed;
		/* Above the phone tab bar, which is where a thumb already is. */
		bottom: calc(var(--nav-bottom-h) + var(--space-3));
		right: var(--space-3);
		left: var(--space-3);
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		pointer-events: none; /* the page keeps working underneath */
	}
	@media (min-width: 40rem) {
		.flyby-rail {
			left: auto;
			width: min(24rem, calc(100vw - var(--space-6)));
			bottom: var(--space-4);
		}
	}

	.flyby {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-elev);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow-md);
		animation: slide-in var(--dur-short) var(--ease-out);
	}
	.msg {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--text-primary);
	}
	.who {
		font-size: var(--fs-xs);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.popup {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: var(--space-4);
		/* Sit above the tab bar rather than on it. The card claims attention; it
		   must not also take away the way out of the page, which would make it a
		   modal in everything but name. */
		padding-bottom: calc(var(--nav-bottom-h) + var(--space-3));
		/* No backdrop fill and no pointer capture: this interrupts attention, not
		   the app. A scout must still be able to reach the form behind it. */
		pointer-events: none;
	}
	@media (min-width: 40rem) {
		.popup {
			align-items: flex-start;
			/* Clear the app bar rather than landing on top of it — the bar carries
			   the event and the sync dot, which is exactly the context a scout needs
			   while deciding whether to act on this. Measured from the bar's own
			   token, not a guessed constant: the first attempt used a spacing sum and
			   sat 12px under it. */
			padding-top: calc(var(--app-bar-h) + var(--space-3));
		}
	}

	.card {
		pointer-events: auto;
		width: min(28rem, 100%);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--bg-card);
		border: 1px solid var(--accent);
		box-shadow: var(--shadow-md);
		animation: slide-in var(--dur-short) var(--ease-out);
	}
	.title {
		font-size: var(--fs-lg);
		color: var(--text-primary);
	}
	.body {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--text-primary);
		line-height: 1.45;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.go,
	.later,
	.x {
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.go {
		flex: 1;
		padding: 0 var(--space-4);
		background: var(--accent);
		color: var(--on-accent);
		text-decoration: none;
	}
	.later {
		padding: 0 var(--space-3);
		background: var(--bg-subtle);
		border: 1px solid var(--border-strong);
		color: var(--text-primary);
	}
	.x {
		min-width: var(--tap-min);
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: var(--fs-md);
	}
	.go:focus-visible,
	.later:focus-visible,
	.x:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.more {
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	/* Spatial motion collapses to a crossfade — a scout with vestibular
	   sensitivity should not get a card sliding at them mid-match. */
	@media (prefers-reduced-motion: reduce) {
		.flyby,
		.card {
			animation: fade-in 150ms var(--ease-out);
		}
		@keyframes fade-in {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}
	}
</style>
