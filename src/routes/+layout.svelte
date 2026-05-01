<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import SessionSetup from '$lib/components/SessionSetup.svelte';

	let { children } = $props();

	onMount(async () => {
		await Promise.all([session.load(), role.load()]);
	});

	function isActive(path) {
		// Active for exact match or any sub-route.
		const p = page.url.pathname;
		if (path === '/') return p === '/' || p === '';
		return p === path || p.startsWith(path + '/') || p === path.replace(/\/$/, '');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !session.loaded || !role.loaded}
	<p class="boot">Loading…</p>
{:else if !session.isConfigured}
	<SessionSetup />
{:else}
	<header class="app-bar">
		<div class="app-bar-inner">
			<strong class="event">{session.eventCode}</strong>
			<span class="sep">·</span>
			<span class="name">{session.scoutName}</span>
			<span class="role-badge" class:manager={role.isManager}>
				{role.value}
			</span>
		</div>
	</header>

	<nav class="tabs">
		<a href="/" class:active={isActive('/')}>
			Entries
		</a>
		{#if role.isManager}
			<a href="/manager/" class:active={isActive('/manager')}>
				Manager
			</a>
		{/if}
		<a href="/settings/" class:active={isActive('/settings')}>
			Settings
		</a>
	</nav>

	{@render children()}
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #fafafa;
		color: #1a1a1a;
	}
	.boot {
		text-align: center;
		margin-top: 4rem;
		color: #777;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.app-bar {
		background: #0b3d91;
		color: white;
		padding: 0.55rem 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.app-bar-inner {
		max-width: 42rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
	}
	.event { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
	.sep { opacity: 0.6; }
	.name { opacity: 0.95; }
	.role-badge {
		margin-left: auto;
		background: rgba(255, 255, 255, 0.18);
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.role-badge.manager {
		background: #ffb000;
		color: #0b3d91;
		font-weight: 700;
	}

	.tabs {
		background: white;
		border-bottom: 1px solid #e0e0e0;
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		padding: 0 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.tabs a {
		padding: 0.65rem 1rem;
		text-decoration: none;
		color: #555;
		font-weight: 600;
		font-size: 0.9rem;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.tabs a.active {
		color: #0b3d91;
		border-bottom-color: #0b3d91;
	}
	.tabs a:hover { color: #0b3d91; }
</style>
