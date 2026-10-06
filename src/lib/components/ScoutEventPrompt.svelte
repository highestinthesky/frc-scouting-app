<script>
	import { base } from '$app/paths';
	import { auth } from '$lib/auth.svelte.js';
	import EventPicker from './EventPicker.svelte';
	import Button from './Button.svelte';

	let modal = $state(null);
	let open = $state(true);
	$effect(() => {
		if (!modal) return;
		if (open && !modal.open) modal.showModal();
		else if (!open && modal.open) modal.close();
	});
</script>

<main class="waiting">
	<h1>Connect to an event</h1>
	<p>Choose your event before recording matches.</p>
	<div class="actions"><Button variant="primary" onclick={() => open = true}>Choose event</Button><Button href="{base}/practice/">Practice</Button><Button onclick={() => auth.signOut()}>Sign out</Button></div>
</main>

<dialog bind:this={modal} onclose={() => open = false} aria-labelledby="event-prompt-title" aria-describedby="event-prompt-description">
	<div class="prompt-head"><h2 id="event-prompt-title">Which event are you scouting?</h2><button class="close" type="button" aria-label="Close event picker" onclick={() => open = false}>×</button></div>
	<p id="event-prompt-description">Choose an event your manager has added you to.</p>
	<EventPicker />
</dialog>

<style>
	/* Hallmark · component: event prompt · genre: modern-minimal
	 * design-system: design.md · designed-as-app
	 */
	.waiting { max-width: var(--w-list); margin: var(--space-6) auto; padding: var(--space-6) var(--space-4); }
	h1 { font-size: var(--fs-page); margin: 0 0 var(--space-3); }
	p { color: var(--text-muted); font-size: var(--fs-md); line-height: 1.5; margin: 0 0 var(--space-5); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	dialog:not([open]) { display: none; }
	dialog { width: calc(100% - var(--space-6)); max-width: var(--w-form); max-height: calc(100dvh - var(--space-6)); padding: var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-card); color: var(--text-primary); box-shadow: var(--shadow-md); overflow-y: auto; }
	dialog::backdrop { background: var(--overlay-scrim); }
	.prompt-head { display: flex; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-3); }
	h2 { font-size: var(--fs-xl); font-weight: 650; line-height: 1.25; margin: 0; flex: 1; }
	.close { flex: none; display: flex; align-items: center; justify-content: center; min-width: var(--tap-min); min-height: var(--tap-min); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); font-size: var(--fs-xl); cursor: pointer; }
	.close:hover { background: var(--bg-subtle); color: var(--text-primary); }
	.close:active { background: var(--bg-elev); }
	@media (max-width: 39.9375rem) { dialog { margin-bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px)); } }
</style>
