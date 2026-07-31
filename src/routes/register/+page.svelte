<script>
	// Self-registration against an invite code.
	//
	// The manager mints a code and reads it out; the scout picks their own
	// username and password here. That inversion is what removes the need for
	// the service_role key, and with it temp passwords, delivery and activation
	// tracking. See docs/adr-001-auth.md § 1.
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { auth, usernameProblem } from '$lib/auth.svelte.js';
	import { getAuthClient } from '$lib/supabase.js';

	let code = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let username = $state('');
	let password = $state('');
	let recoveryEmail = $state('');
	let busy = $state(false);
	let error = $state('');

	/** null = not checked yet, otherwise { valid, role }. */
	let invite = $state(/** @type {null | {valid: boolean, role: string}} */ (null));
	let checking = $state(false);

	// Look the code up as it's typed, so the scout learns it's wrong before
	// filling in the rest of the form rather than after.
	$effect(() => {
		const c = code.trim().toUpperCase();
		invite = null;
		if (c.length < 6) return;
		checking = true;
		const id = setTimeout(async () => {
			const { data } = await getAuthClient().rpc('peek_invite', { p_code: c });
			invite = data?.[0] ?? { valid: false, role: 'scout' };
			checking = false;
		}, 350);
		return () => {
			clearTimeout(id);
			checking = false;
		};
	});

	const nameProblem = $derived(username ? usernameProblem(username) : null);
	const suggestion = $derived(
		firstName && lastName
			? `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '')
			: ''
	);

	const canSubmit = $derived(
		invite?.valid &&
			firstName.trim() &&
			lastName.trim() &&
			username &&
			!nameProblem &&
			password.length >= 8
	);

	async function submit(e) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await auth.register({
			code,
			username,
			password,
			firstName,
			lastName,
			recoveryEmail
		});
		busy = false;
		if (res.ok) await goto(`${base}/`);
		else error = res.message;
	}
</script>

<svelte:head><title>Create account · FRC Scout</title></svelte:head>

<main>
	<h1>Create your account</h1>
	<p class="lede">Ask a manager for an invite code.</p>

	<form onsubmit={submit}>
		<label class="field">
			<span class="label">Invite code</span>
			<input
				bind:value={code}
				autocapitalize="characters"
				autocorrect="off"
				spellcheck="false"
				placeholder="e.g. K7QPXM"
				required
			/>
			{#if checking}
				<small class="note">Checking…</small>
			{:else if invite?.valid}
				<small class="note good">✓ Valid — you'll join as {invite.role}.</small>
			{:else if invite}
				<small class="note bad">Not valid, already used, or expired.</small>
			{/if}
		</label>

		<div class="row">
			<label class="field">
				<span class="label">First name</span>
				<input bind:value={firstName} autocomplete="given-name" required />
			</label>
			<label class="field">
				<span class="label">Last name</span>
				<input bind:value={lastName} autocomplete="family-name" required />
			</label>
		</div>

		<label class="field">
			<span class="label">Username</span>
			<small class="help">
				How you sign in. Lowercase letters, numbers, dot, dash, underscore.
				You can't change it later.
			</small>
			<input
				bind:value={username}
				autocomplete="username"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				required
			/>
			{#if nameProblem}
				<small class="note bad">{nameProblem}</small>
			{:else if suggestion && !username}
				<small class="note">Suggested: {suggestion}</small>
			{/if}
		</label>

		<label class="field">
			<span class="label">Password</span>
			<small class="help">At least 8 characters.</small>
			<input type="password" bind:value={password} autocomplete="new-password" required />
		</label>

		<label class="field">
			<span class="label">Recovery email <span class="opt">optional</span></span>
			<small class="help">
				The only way to reset your own password. Without one, a manager has to
				revoke your account and re-invite you — and you'd lose this username.
			</small>
			<input type="email" bind:value={recoveryEmail} autocomplete="email" />
		</label>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<Button variant="primary" type="submit" full disabled={busy || !canSubmit}>
			{busy ? 'Creating…' : 'Create account'}
		</Button>
	</form>

	<p class="alt">Already have one? <a href="{base}/login/">Sign in</a>.</p>
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.lede {
		margin: var(--space-1) 0 var(--space-5);
		color: var(--text-muted);
		font-size: var(--fs-md);
	}
	.row { display: flex; gap: var(--space-3); }
	.row .field { flex: 1 1 0; min-width: 0; }
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label { font-weight: 600; font-size: var(--fs-md); }
	.opt {
		font-weight: 400;
		color: var(--text-faint);
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-left: var(--space-1);
	}
	.help { color: var(--text-faint); font-size: var(--fs-xs); line-height: 1.45; }
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
	.note { font-size: var(--fs-xs); color: var(--text-faint); }
	.note.good { color: var(--success); font-weight: 600; }
	.note.bad { color: var(--danger); font-weight: 600; }
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
</style>
