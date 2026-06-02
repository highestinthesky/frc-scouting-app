<script>
	import { base } from '$app/paths';
	import { reminders } from '$lib/reminders.svelte.js';

	let expanded = $state(false);

	const list = $derived(reminders.visible);

	// Show up to N inline; collapse the rest behind a "+M more" toggle so the
	// banner doesn't push everything else off the screen on a busy event.
	const VISIBLE_LIMIT = 3;
	const shown = $derived(expanded ? list : list.slice(0, VISIBLE_LIMIT));
	const extra = $derived(Math.max(0, list.length - VISIBLE_LIMIT));

	async function onDismiss(r) {
		await reminders.dismiss(r.id, r.expires_at);
	}

	// Deeplink a reminder straight into a pre-filled entry form. Auto reminders
	// carry the exact team; manager reminders carry only the match, so /new
	// resolves the scout's team for that match. No match → no link.
	function scoutHref(r) {
		if (!Number.isFinite(r?.match_number) || r.match_number <= 0) return null;
		const qp = new URLSearchParams({ match: String(r.match_number) });
		if (Number.isFinite(r.team) && r.team > 0) qp.set('team', String(r.team));
		return `${base}/new/?${qp.toString()}`;
	}
</script>

{#if list.length > 0}
	<aside class="reminder-stack" aria-label="Reminders">
		{#each shown as r (r.id)}
			<div class="reminder" class:auto={r.kind === 'auto'} class:manager={r.kind === 'manager'}>
				<div class="r-body">
					<strong class="r-label">
						{#if r.kind === 'auto'}Heads up{:else}Reminder{/if}
					</strong>
					<span class="r-msg">{r.message}</span>
					{#if r.kind === 'manager' && r.author}
						<small class="r-author">— {r.author}</small>
					{/if}
				</div>
				{#if scoutHref(r)}
					<a class="r-scout" href={scoutHref(r)}>Scout →</a>
				{/if}
				<button
					type="button"
					class="r-x"
					aria-label="Dismiss reminder"
					onclick={() => onDismiss(r)}
				>✕</button>
			</div>
		{/each}
		{#if !expanded && extra > 0}
			<button type="button" class="r-more" onclick={() => (expanded = true)}>
				+ {extra} more reminder{extra === 1 ? '' : 's'}
			</button>
		{:else if expanded && list.length > VISIBLE_LIMIT}
			<button type="button" class="r-more" onclick={() => (expanded = false)}>
				Collapse
			</button>
		{/if}
	</aside>
{/if}

<style>
	.reminder-stack {
		max-width: 42rem;
		margin: 0.5rem auto 0;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.reminder {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		font-size: 0.88rem;
		border: 1px solid;
	}
	.reminder.auto {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.reminder.manager {
		background: var(--banner-info-bg);
		border-color: var(--banner-info-border);
		color: var(--text-primary);
	}

	.r-body {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.r-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		opacity: 0.85;
	}
	.r-msg { font-weight: 600; }
	.r-author {
		color: var(--text-muted);
		font-size: 0.8rem;
		font-style: italic;
	}
	.r-x {
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1rem;
		cursor: pointer;
		opacity: 0.65;
		padding: 0.1rem 0.3rem;
		border-radius: 0.25rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.r-x:hover { opacity: 1; background: rgba(0, 0, 0, 0.05); }

	.r-scout {
		flex-shrink: 0;
		align-self: center;
		font-size: 0.78rem;
		font-weight: 700;
		text-decoration: none;
		color: inherit;
		border: 1px solid currentColor;
		border-radius: 0.3rem;
		padding: 0.15rem 0.5rem;
		opacity: 0.9;
		white-space: nowrap;
	}
	.r-scout:hover { opacity: 1; }

	.r-more {
		align-self: flex-start;
		background: transparent;
		border: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
	}
	.r-more:hover { text-decoration: underline; }
</style>
