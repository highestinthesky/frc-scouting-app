<script>
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { session } from '$lib/session.svelte.js';
	import { auth, AUTH_ENFORCED } from '$lib/auth.svelte.js';

	let username = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');

	// Declining is remembered, so this asks once rather than on every load. It
	// exists because a scout who cannot sign in at the venue must still be able
	// to record — that is the invariant, not a convenience. AUTH_ENFORCED hides
	// it: after the cutover there is nothing left to carry on without.
	async function later() {
		await session.update({ loginDeferred: true });
		goto(`${base}/home/`, { replaceState: true });
	}

	async function submit(e) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await auth.signIn(username, password);
		busy = false;
		if (res.ok) await goto(`${base}/home/`);
		else error = res.message;
	}
</script>

<svelte:head><title>Sign in · FRC Scout</title></svelte:head>

<main>
	<header class="welcome">
		<h1>Sign in</h1>
	</header>

	<form onsubmit={submit}>
		<label class="field">
			<span class="label">Username</span>
			<input
				bind:value={username}
				autocomplete="username"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				required
			/>
		</label>

		<label class="field">
			<span class="label">Password</span>
			<input type="password" bind:value={password} autocomplete="current-password" required />
		</label>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<Button variant="primary" type="submit" full disabled={busy || !username || !password}>
			{busy ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>

	<p class="alt">
		<a href="{base}/register/">Create account</a>
	</p>

	{#if !AUTH_ENFORCED}
		<p class="later">
			<button type="button" class="later-btn" onclick={later}>
				Log in later <span class="warn">(not recommended)</span>
			</button>
		</p>
	{/if}
</main>

<style>
	.later { margin: var(--space-4) 0 0; text-align: center; }
	.later-btn {
		font: inherit;
		background: none;
		border: none;
		padding: var(--space-2) var(--space-3);
		min-height: var(--tap-min);
		color: var(--text-muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.later-btn:hover { color: var(--text-primary); }
	.warn { color: var(--warning); text-decoration: none; }

	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 28rem;
		margin: 0 auto;
		padding: calc(var(--space-8) + var(--safe-top)) var(--space-5) var(--space-7);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-page);
		letter-spacing: -0.02em;
		font-weight: 650;
		line-height: 1.2;
		max-width: 16ch;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}
	.label {
		font-weight: 600;
		font-size: var(--fs-sm);
	}
	input {
		font: inherit;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		margin: 0 0 var(--space-3);
	}
	.alt {
		margin: var(--space-5) 0 0;
		font-size: var(--fs-sm);
		color: var(--text-muted);
		text-align: center;
		line-height: 1.7;
	}
	.alt a {
		color: var(--accent);
		display: inline-block;
		padding: var(--space-1) 0;
	}

	.welcome { margin-bottom: var(--space-5); }

	form { padding: var(--space-5); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }

	@media (max-width: 40rem) { main { padding-top: calc(var(--space-7) + var(--safe-top)); padding-left: var(--space-4); padding-right: var(--space-4); } }

</style>
