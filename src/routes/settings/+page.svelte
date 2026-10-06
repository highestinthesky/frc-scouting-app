<script>
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { dialog } from '$lib/dialog.svelte.js';
	import { session } from '$lib/session.svelte.js';
	import { flush, resync, clearLocalEntries } from '$lib/sync.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import { auth } from '$lib/auth.svelte.js';
	import EventPicker from '$lib/components/EventPicker.svelte';

	let scoutName = $state(session.scoutName);
	let saving = $state(false);

	/**
	 * Does what this device records as differ from the account it is signed into?
	 *
	 * Only meaningful while scout_name is still a join key. Compared through
	 * scout-identity's normalisation rather than raw, because "Ning" and "ning"
	 * are one person and warning about that would be noise.
	 */
	const nameDiverges = $derived(
		auth.signedIn &&
			Boolean(auth.displayName) &&
			Boolean(session.scoutName?.trim()) &&
			session.scoutName.trim().toLowerCase() !== auth.displayName.trim().toLowerCase()
	);

	async function adoptAccountName() {
		saving = true;
		try {
			await session.update({ scoutName: auth.displayName, scoutNameAccount: auth.profile?.id ?? null });
			scoutName = auth.displayName;
			savedMsg = 'This device now records as your account name.';
		} finally {
			saving = false;
		}
	}
	let savedMsg = $state('');
	let clearMsg = $state('');

	async function saveSession(e) {
		e.preventDefault();
		saving = true;
		savedMsg = '';
		try {
			// The event is the picker's to set — this form only owns the name now.
			// Typed by hand, signed out: a name no account owns, so the next
			// sign-in leaves it alone unless it is that account's own name.
			await session.update({ scoutName: scoutName.trim(), scoutNameAccount: null });
			savedMsg = 'Saved.';
		} finally {
			saving = false;
		}
	}


	const entries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
	let flushing = $state(false);

	// Both of these make what is on this phone harder to reach, so each sends
	// what it can first and then says exactly what did not go — a count, not a
	// "may". A scout told "entries stay on the phone" will sign out with six
	// unsent matches and assume they went.
	async function signOut() {
		flushing = true;
		const waiting = await flush().finally(() => (flushing = false));
		const again =
			'Sign in again before your next event — the app needs a connection for ' +
			'that, and a venue is a poor place to discover it.';
		const ok = await dialog.confirm(
			waiting > 0
				? {
						title: `Sign out with ${entries(waiting)} unsent?`,
						body:
							`${entries(waiting)} ${waiting === 1 ? 'has' : 'have'} not reached your team. ` +
							`${waiting === 1 ? 'It stays' : 'They stay'} on this phone and send${waiting === 1 ? 's' : ''} under whoever signs in on it next.\n\n` +
							again,
						confirmLabel: 'Sign out anyway'
					}
				: {
						title: 'Sign out of this device?',
						body: 'Everything recorded here has reached your team.\n\n' + again,
						confirmLabel: 'Sign out'
					}
		);
		if (!ok) return;
		await auth.signOut();
	}

	async function clearAll() {
		flushing = true;
		const waiting = await flush().finally(() => (flushing = false));
		const ok = await dialog.confirm({
			title: waiting > 0 ? `Clear ${entries(waiting)} that never sent?` : 'Clear every entry on this device?',
			body:
				(waiting > 0
					? `${entries(waiting)} ${waiting === 1 ? 'has' : 'have'} not reached your team and will be lost. `
					: '') +
				"Your team's entries for this event download again.",
			confirmLabel: 'Clear entries',
			danger: true
		});
		if (!ok) return;
		await clearLocalEntries();
		// Straight back down. Clearing used to leave the device without its own
		// synced entries for good: the pull skipped rows this device recorded,
		// and it only re-read the event on a cold start.
		resync();
		clearMsg = 'Cleared. Downloading this event again.';
	}

</script>

<svelte:head>
	<title>Settings · FRC Scout</title>
</svelte:head>

<main>
	<!-- No back arrow. Settings is a top-level TAB — back to what? The nav is on
	     screen, so the arrow was a second, worse copy of it, and it pushed the
	     page title 56px right of every heading beneath it. That offset was the
	     "unaligned" complaint; the arrow was the cause. -->
	<header class="page-head">
		<h1>Settings</h1>
	</header>

	<section>
		<h2>Account</h2>
		{#if auth.signedIn && auth.profile}
			<p class="acct">
				<strong>{auth.displayName}</strong>
				<span class="uname">{auth.profile.username}</span>
				<span class="tag">{auth.profile.role}</span>
			</p>
			<!-- "Manage accounts" used to sit here as a bare <a> beside a real
			     <Button>, so the two were visibly different sizes. It is not restyled
			     — it moved. Managing accounts is running the team, which is Studio's
			     job, and Settings is left with the one control that belongs to this
			     device. -->
			<div class="acct-actions">
				<Button onclick={signOut} disabled={flushing}>{flushing ? 'Sending…' : 'Sign out'}</Button>
			</div>
		{:else if auth.orphaned}
			<p class="muted">
				Signed in as <strong>{auth.authEmail}</strong>, but account setup is incomplete.
				<a href="{base}/register/">Redeem an invite</a> to finish.
			</p>
			<Button onclick={signOut} disabled={flushing}>{flushing ? 'Sending…' : 'Sign out'}</Button>
		{:else}
			<p class="muted">
				Not signed in. <a href="{base}/">Sign in</a> or
				<a href="{base}/register/">create an account</a> .
			</p>
		{/if}
	</section>

	<section>
		<h2>Identity</h2>
		<form onsubmit={saveSession}>
			<!-- Wrapped in the page's own .field rather than passing a class to the
			     component: the scoping hash belongs to this file, so it lands on the
			     div and never on the picker's internals. See CLAUDE.md. -->
			<div class="field">
				<EventPicker />
			</div>

			<!-- Signed in, the account owns the name. 0023 makes the invite carry the
			     spelling the manager typed, so the profile and the assignments agree
			     by construction — and a free-text box here is the one place they can
			     be pulled apart again.
			     It is not silently overwritten. CLAUDE.md: the name is still a join
			     key, so replacing one a device already had would detach it from
			     everything addressed to the old spelling. A divergence is SHOWN and
			     fixed on request, which is the difference between repairing it and
			     doing it to someone. -->
			{#if auth.signedIn}
				{#if nameDiverges}
					<div class="field">
						<small class="help warn">
							This device still records as <strong>{session.scoutName}</strong>.
							Assignments addressed to your account name will not reach it.
						</small>
						<Button type="button" disabled={saving} onclick={adoptAccountName}>
							Use my account name
						</Button>
					</div>
				{/if}
			{:else}
				<label class="field">
					<span class="label">Your name</span>
					<small class="help">Use the name on your assignments.</small>
					<input bind:value={scoutName} autocomplete="name" />
				</label>

				<!-- Inside the signed-OUT branch, because that is the only branch with
				     anything to save. saveSession() writes scoutName and nothing else —
				     its own comment says the event is the picker's — and signed in the
				     name is read-only, so this button submitted a form with no editable
				     field in it. -->
				<Button variant="primary" type="submit" disabled={saving}>
					{saving ? 'Saving…' : 'Save'}
				</Button>
				{#if savedMsg}<small class="muted ok">{savedMsg}</small>{/if}
			{/if}
		</form>
	</section>

	<section>
		<h2 id="theme-label">Appearance</h2>
		<div class="theme-row" role="radiogroup" aria-labelledby="theme-label">
			{#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [value, label] (value)}
				<button
					type="button"
					role="radio"
					aria-checked={theme.value === value}
					class="theme-btn"
					class:selected={theme.value === value}
					onclick={() => theme.set(value)}
				>{label}</button>
			{/each}
		</div>
	</section>

	<section>
		<h2>Danger zone</h2>
		<p class="muted">Wipes every entry on this device. Synced copies are unaffected.</p>
		<Button variant="danger" onclick={clearAll} disabled={flushing}>Clear all entries</Button>
		{#if clearMsg}<small class="muted ok">{clearMsg}</small>{/if}
	</section>
</main>

<style>

	main {
		width: 100%;
		margin: var(--space-4) 0;
		padding: var(--space-5) var(--space-5) calc(var(--nav-bottom-h) + var(--space-5));
	}
	section { max-width: var(--w-form); }
	@media (max-width: 39.9375rem) {
		main { padding-left: var(--space-4); padding-right: var(--space-4); }
	}
	.page-head {
		margin: 0 0 var(--space-4);
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-page);
		letter-spacing: -0.02em;
	}
	h2 {
		margin: 0 0 var(--space-4);
		font-size: var(--fs-md);
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-primary);
		font-weight: 600;
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted a { color: var(--accent); }
	.ok { color: var(--accent); margin-left: var(--space-2); }
	.help { color: var(--text-faint); font-size: var(--fs-xs); }

	/* ── choice groups ──────────────────────────────────────────────────
	   Appearance is a row of mutually-exclusive options. This used to be shared
	   with a local Role picker; the role is the account's now, so only the one
	   selector is left. */
	.theme-row {
		display: flex;
		gap: 0;
		flex-wrap: wrap;
		padding: var(--space-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-subtle);
	}
	.theme-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	/* Selected is carried by border AND background AND text colour, not colour
	   alone — the same rule the alliance colours follow. */

	.theme-btn {
		flex: 1 1 0;
		min-width: 0;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: 600;
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-short) var(--ease-out);
		border-color: transparent;
		font-size: var(--fs-sm);
	}
	/* Selected is carried by border AND background AND text colour, not colour
	   alone — the same rule the alliance colours follow. */
	.theme-btn.selected {
		border-color: var(--border-strong);
		background: var(--bg-card);
		color: var(--text-primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-btn {
			transition-duration: 0.01ms;
		}
	}

	/* ── form ───────────────────────────────────────────────────────────── */
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
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}

	/* ── sync status ────────────────────────────────────────────────────── */
	.acct {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0 0 var(--space-3);
	}
	.uname { color: var(--text-faint); font-size: var(--fs-sm); }
	.tag {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.acct-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }


	section { padding-bottom: var(--space-6); margin-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
	section:last-child { border-bottom: 0; }

</style>
