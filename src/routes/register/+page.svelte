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
	// Never bound to an input any more. They stay in the register() call because
	// redeem_invite still takes them as its pre-0023 fallback, and sending empty
	// strings is what makes the invite's own name win by construction.
	let firstName = $state('');
	let lastName = $state('');
	let username = $state('');
	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');
	const resuming = $derived(auth.orphaned && Boolean(auth.authEmail));

	// signUp may have succeeded before invite redemption failed. That auth
	// username is immutable, so make the retry form use it instead of creating
	// a second account or a profile whose login name would not work.
	$effect(() => {
	});

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
		(() => {
			const f = invite?.first_name || firstName;
			const l = invite?.last_name || lastName;
			return f && l ? `${f}.${l}`.toLowerCase().replace(/[^a-z0-9._-]/g, '') : '';
		})()
	);

	/** A named invite carries the name, so the form never collects it. */
	const inviteNamed = $derived(Boolean(invite?.valid && invite?.first_name));

	const canSubmit = $derived(
		invite?.valid &&
			// The invite's name, and only the invite's name. A code minted before
			// 0026 could carry none, and the honest response is to refuse rather
			// than to collect one here: a profile named by its own owner detaches
			// from every assignment addressed to the manager's spelling.
			inviteNamed &&
			username &&
			!nameProblem &&
			(resuming || (email.includes('@') && password.length >= 8))
	);

	async function submit(e) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await auth.register({
			code,
			username,
			email,
			password,
			firstName,
			lastName
		});
		busy = false;
		if (res.ok) await goto(`${base}/home/`);
		else error = res.message;
	}
</script>

<svelte:head><title>Create account · FRC Scout</title></svelte:head>

<main>
	<h1>{resuming ? 'Finish account setup' : 'Create your account'}</h1>
	<p class="lede">
		{resuming
			? 'Your login exists, but its invite was not redeemed. Enter a valid invite code to finish.'
			: 'Ask a manager for an invite code.'}
	</p>

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
				<small class="note good">
				✓ Valid — you'll join as {invite.role}{invite.first_name
					? ` (${invite.first_name} ${invite.last_name ?? ''})`.trimEnd() + ''
					: ''}.
			</small>
			{:else if invite}
				<small class="note bad">Not valid, already used, or expired.</small>
			{/if}
			{#if invite?.valid && !invite.first_name}
				<small class="note bad">
					This code carries no name. Ask your manager for a new one.
				</small>
			{/if}
		</label>

		<!-- The name comes from the invite and there is no field for it any more.
		     0023 made redeem_invite prefer the invite's spelling; 0026 made
		     create_invite refuse to mint without one, so a nameless invite cannot
		     exist and the fallback field this used to show has nothing to fall
		     back for. It was also the last way a scout could register as a
		     spelling their manager never typed — and `scout_name` is a join key,
		     so that spelling is what every assignment is addressed to.
		     Checked before removing it: zero live invites on production. -->
		{#if invite?.valid && invite.first_name}
			<p class="named">
				Joining as <strong>{invite.first_name} {invite.last_name ?? ''}</strong>.
				<small
					>Your manager set this so your assignments reach you. Not you? Ask them for your
					own code.</small
				>
			</p>
		{/if}

		<label class="field">
			<span class="label">Username</span>
			<small class="help">Cannot be changed later.</small>
			<input
				bind:value={username}
				autocomplete="username"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				readonly={resuming}
				required
			/>
			{#if nameProblem}
				<small class="note bad">{nameProblem}</small>
			{:else if suggestion && !username}
				<small class="note">Suggested: {suggestion}</small>
			{/if}
		</label>

		{#if resuming}
			<p class="resume-note">
				Signed in as <strong>{auth.authEmail}</strong>. Your existing password is unchanged.
			</p>
		{:else}
			<label class="field">
				<span class="label">Email</span>
				<small class="help">If this is wrong, nobody can get you back into your account.</small>
				<input type="email" bind:value={email} autocomplete="email" required />
			</label>

			<label class="field">
				<span class="label">Password</span>
				<small class="help">At least 8 characters.</small>
				<input type="password" bind:value={password} autocomplete="new-password" required />
			</label>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<Button variant="primary" type="submit" full disabled={busy || !canSubmit}>
			{busy ? (resuming ? 'Finishing…' : 'Creating…') : (resuming ? 'Finish setup' : 'Create account')}
		</Button>
	</form>

	{#if resuming}
		<p class="alt">
			Not {auth.authEmail}?
			<button type="button" class="text-button" onclick={() => auth.signOut()}>Sign out</button>
		</p>
	{:else}
		<p class="alt">Already have one? <a href="{base}/">Sign in</a>.</p>
	{/if}
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
	}
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	.lede {
		margin: var(--space-1) 0 var(--space-5);
		color: var(--text-muted);
		font-size: var(--fs-md);
	}
	.named {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--bg-subtle);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--fs-md);
		color: var(--text-primary);
	}
	.named small {
		font-size: var(--fs-xs);
		color: var(--text-muted);
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
	.resume-note {
		margin: 0 0 var(--space-4);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		background: var(--warning-bg);
		color: var(--warning);
		font-size: var(--fs-sm);
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
	.text-button {
		border: 0;
		padding: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
