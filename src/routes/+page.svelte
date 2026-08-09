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
	<h1>FRC Scout</h1>
	<p class="lede">Sign in to record matches for your team.</p>

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
		Got an invite code? <a href="{base}/register/">Create your account</a>.
	</p>

	{#if !AUTH_ENFORCED}
		<p class="later">
			<button type="button" class="later-btn" onclick={later}>
				Log in later <span class="warn">(not recommended)</span>
			</button>
		</p>
	{/if}

	<p class="hint">
		Sign in before you leave for an event. Once you have, the app keeps working
		without signal — matches you record are saved on the phone and sent when
		you are back in range.
	</p>
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
		max-width: 22rem;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		letter-spacing: -0.02em;
	}
	.lede {
		margin: var(--space-1) 0 var(--space-6);
		color: var(--text-muted);
		font-size: var(--fs-md);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label { font-weight: 600; font-size: var(--fs-md); }
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
		font-size: var(--fs-md);
		color: var(--text-muted);
	}
	.alt a { color: var(--accent); }
	.hint {
		margin-top: var(--space-6);
		font-size: var(--fs-sm);
		color: var(--text-faint);
		line-height: 1.5;
	}
</style>
