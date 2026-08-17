<script>
	import Select from '$lib/components/Select.svelte';
	// Manager surface: invite people, change roles, revoke access.
	//
	// Every restriction here is also enforced in Postgres (migration 0008) —
	// a manager cannot promote themselves, and only a super can mint a super,
	// whether or not this page hides the control. Hiding a button is not
	// enforcement; this UI just avoids offering something that would fail.
	import { base } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import { auth } from '$lib/auth.svelte.js';
	import { dialog } from '$lib/dialog.svelte.js';
	import { relativeTime } from '$lib/format.js';

	let profiles = $state(/** @type {any[]} */ ([]));
	let invites = $state(/** @type {any[]} */ ([]));
	let busy = $state(false);
	let err = $state('');
	let msg = $state('');
	let freshCode = $state('');
	let inviteRole = $state(/** @type {'scout'|'manager'|'super'} */ ('scout'));

	// Create-an-account form. The draft's flow: type a name, hand over what comes
	// back. Email is ours, not the draft's — an account with no routable address
	// cannot be recovered, and that has already locked someone out once.
	let newFirst = $state('');
	let newLast = $state('');
	let newEmail = $state('');
	let newRole = $state(/** @type {'scout'|'manager'|'super'} */ ('scout'));
	/** Shown once, then gone. Nothing stores the temporary password. */
	let handover = $state(/** @type {{username: string, temporaryPassword: string}|null} */ (null));
	let now = $state(new Date());

	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	$effect(() => {
		if (auth.isManager) load();
	});

	async function load() {
		err = '';
		try {
			[profiles, invites] = await Promise.all([auth.listProfiles(), auth.listInvites()]);
		} catch (e) {
			err = e.message;
		}
	}

	async function createAccount() {
		err = '';
		msg = '';
		handover = null;
		if (!newFirst.trim() || !newLast.trim()) {
			err = 'Enter a first and last name.';
			return;
		}
		if (!newEmail.includes('@')) {
			err = 'Enter the email address their password reset should go to.';
			return;
		}
		busy = true;
		try {
			handover = await auth.createAccount({
				firstName: newFirst,
				lastName: newLast,
				email: newEmail,
				role: newRole
			});
			newFirst = '';
			newLast = '';
			newEmail = '';
			await load();
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function mint() {
		busy = true;
		err = '';
		msg = '';
		freshCode = '';
		try {
			freshCode = await auth.createInvite(inviteRole);
			await load();
		} catch (e) {
			err = e.message;
		} finally {
			busy = false;
		}
	}

	async function changeRole(p, role) {
		if (role === p.role) return;
		const ok = await dialog.confirm({
			title: `Make ${p.first_name} ${p.last_name} a ${role}?`,
			body:
				role === 'scout'
					? 'They lose access to scheduling, assignments and every manager view.'
					: `They gain access to scheduling, assignments and analysis${role === 'super' ? ', and can create manager accounts' : ''}.`,
			confirmLabel: `Make ${role}`
		});
		if (!ok) return;
		busy = true;
		err = '';
		try {
			await auth.setRole(p.id, role);
			msg = `${p.first_name} is now a ${role}.`;
			await load();
		} catch (e) {
			err = e.message;
		} finally {
			busy = false;
		}
	}

	async function revoke(p) {
		const ok = await dialog.confirm({
			title: `Revoke access for ${p.first_name} ${p.last_name}?`,
			body:
				`They can no longer sign in to this team's data.\n\n` +
				`Entries they already recorded are kept — this removes the person, not their work.\n\n` +
				`To bring them back, issue a new invite. They can sign in with the same username and redeem it.`,
			confirmLabel: 'Revoke access',
			danger: true
		});
		if (!ok) return;
		busy = true;
		err = '';
		try {
			await auth.revokeAccess(p.id);
			msg = `${p.first_name}'s access was revoked.`;
			await load();
		} catch (e) {
			err = e.message;
		} finally {
			busy = false;
		}
	}

	async function dropInvite(code) {
		busy = true;
		try {
			await auth.revokeInvite(code);
			if (freshCode === code) freshCode = '';
			await load();
		} catch (e) {
			err = e.message;
		} finally {
			busy = false;
		}
	}

	const openInvites = $derived(invites.filter((i) => !i.redeemed_at));
	const roleOptions = $derived(auth.isSuper ? ['scout', 'manager', 'super'] : ['scout', 'manager']);
</script>

<svelte:head><title>Accounts · FRC Scout</title></svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/home/" aria-label="Back">←</a>
		<h1>Accounts</h1>
	</header>

	{#if !auth.isManager}
		<p class="muted">Only managers can see this page.</p>
	{:else}
		<section>
			<h2>Add someone</h2>
			<p class="muted">
				Type their name and email. You get a username and a one-time password to
				give them; they choose their own the first time they sign in.
			</p>

			<div class="new-grid">
				<label class="field">
					<span class="label">First name</span>
					<input bind:value={newFirst} autocomplete="off" />
				</label>
				<label class="field">
					<span class="label">Last name</span>
					<input bind:value={newLast} autocomplete="off" />
				</label>
				<label class="field wide">
					<span class="label">Email</span>
					<small class="help">Only ever used for a password reset.</small>
					<input type="email" bind:value={newEmail} autocomplete="off" />
				</label>
				<div class="field">
					<Select
						label="Joins as"
						bind:value={newRole}
						options={roleOptions.map((r) => ({ value: r, label: r }))}
					/>
				</div>
			</div>
			<Button variant="primary" disabled={busy} onclick={createAccount}>
				{busy ? 'Creating…' : 'Create account'}
			</Button>

			{#if handover}
				<div class="handover">
					<p class="handover-lead">Give these to {handover.username ? 'them' : 'them'} now.</p>
					<dl>
						<dt>Username</dt>
						<dd><code>{handover.username}</code></dd>
						<dt>Temporary password</dt>
						<dd><code>{handover.temporaryPassword}</code></dd>
					</dl>
					<p class="handover-warn">
						This is the only time the password is shown. Nothing stores it — if it
						is lost before they sign in, delete the account and make another.
					</p>
				</div>
			{/if}
		</section>

		<section>
			<h2>Invite someone instead</h2>
			<p class="muted">
				Read the code out to them. They pick their own username and password at
				<a href="{base}/register/">the sign-up page</a>.
			</p>

			<div class="invite-row">
				<div class="field">
					<Select
						label="Joins as"
						bind:value={inviteRole}
						options={roleOptions.map((r) => ({ value: r, label: r }))}
					/>
				</div>
				<Button variant="primary" disabled={busy} onclick={mint}>Create invite</Button>
			</div>

			{#if freshCode}
				<p class="fresh">
					<span class="code">{freshCode}</span>
					<span class="fresh-note">Valid for 14 days, single use.</span>
				</p>
			{/if}

			{#if openInvites.length}
				<h3 class="sub">Unused invites</h3>
				<ul class="list">
					{#each openInvites as i (i.code)}
						<li>
							<span class="code small">{i.code}</span>
							<span class="tag">{i.role}</span>
							<span class="when">expires {relativeTime(i.expires_at, now)}</span>
							<button
								type="button"
								class="drop"
								onclick={() => dropInvite(i.code)}
								disabled={busy}
								aria-label="Cancel invite {i.code}"
							>✕</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2>People</h2>
			{#if profiles.length === 0}
				<p class="muted">Nobody has registered yet.</p>
			{:else}
				<ul class="list people">
					{#each profiles as p (p.id)}
						{@const self = p.id === auth.profile?.id}
						<li>
							<div class="who">
								<strong>{p.first_name} {p.last_name}</strong>
								<span class="uname">{p.username}</span>
								{#if self}<span class="tag you">you</span>{/if}
								{#if p.must_change_password}
									<span class="tag pending" title="Still on the password they were given">
										not signed in yet
									</span>
								{/if}
							</div>
							<div class="controls">
								<Select
									value={p.role}
									disabled={busy || self}
									onchange={(e) => changeRole(p, e.currentTarget.value)}
									label=""
									options={[
										...roleOptions.map((r) => ({ value: r, label: r })),
										...(roleOptions.includes(p.role) ? [] : [{ value: p.role, label: p.role }])
									]}
								/>
								{#if !self && p.role !== 'super'}
									<Button variant="danger" disabled={busy} onclick={() => revoke(p)}>
										Revoke
									</Button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<p class="muted small">
					You can't change your own role — that stops a manager promoting
					themselves. Another manager or a super user can.
				</p>
			{/if}
		</section>
	{/if}

	{#if msg}<p class="banner ok">{msg}</p>{/if}
	{#if err}<p class="banner err">{err}</p>{/if}
</main>

<style>
	.new-grid {
		display: grid;
		/* minmax(0, 1fr), not 1fr. A bare fr track refuses to shrink below its
		   content's min-content width, so two text inputs held this form wider than
		   a 375px viewport and the right-hand column ran off the screen. */
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	/* And on a phone there is no room for two columns of anything. */
	@media (max-width: 30rem) {
		.new-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.new-grid .wide { grid-column: 1 / -1; }
	.new-grid .field { display: flex; flex-direction: column; gap: var(--space-1); }
	.new-grid .label { font-weight: 600; font-size: var(--fs-sm); }
	.new-grid .help { color: var(--text-faint); font-size: var(--fs-xs); }
	.new-grid input,
	.new-grid select {
		font: inherit;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		min-width: 0;
	}
	.handover {
		margin-top: var(--space-4);
		padding: var(--space-4);
		background: var(--success-bg);
		border: 1px solid var(--success-border);
		border-radius: var(--radius-md);
	}
	.handover-lead { margin: 0 0 var(--space-3); font-weight: 600; color: var(--success); }
	.handover dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		margin: 0 0 var(--space-3);
	}
	.handover dt { color: var(--text-muted); font-size: var(--fs-sm); }
	.handover dd { margin: 0; }
	.handover code {
		font-family: ui-monospace, monospace;
		font-size: var(--fs-md);
		user-select: all;
	}
	.handover-warn { margin: 0; color: var(--text-muted); font-size: var(--fs-sm); }
	.tag.pending {
		background: var(--warning-bg);
		color: var(--warning);
		border: 1px solid var(--warning-border);
	}

	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 36rem;
		margin: var(--space-4) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-5));
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-4) 0;
	}
	.back {
		font-size: var(--fs-xl);
		text-decoration: none;
		color: var(--accent);
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	h2 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.sub {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: var(--fs-md); margin: 0 0 var(--space-3); }
	.muted.small { font-size: var(--fs-sm); margin-top: var(--space-3); }
	.muted a { color: var(--accent); }

	.invite-row {
		display: flex;
		gap: var(--space-3);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field { display: flex; flex-direction: column; gap: var(--space-1); }
	.label { font-weight: 600; font-size: var(--fs-sm); }
	select {
		font: inherit;
		min-height: var(--tap-min);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg-card);
		color: var(--text-primary);
		text-transform: capitalize;
	}
	select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

	.fresh {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin: var(--space-4) 0 0;
		padding: var(--space-3);
		background: var(--accent-soft);
		border: 1px solid var(--accent);
		border-radius: var(--radius-md);
	}
	.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: var(--fs-xl);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--accent);
	}
	.code.small { font-size: var(--fs-md); letter-spacing: 0.08em; }
	.fresh-note { font-size: var(--fs-sm); color: var(--accent); }

	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
	.list li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.people li { padding: var(--space-3); }
	.who { display: flex; align-items: baseline; gap: var(--space-2); flex: 1 1 12rem; min-width: 0; flex-wrap: wrap; }
	.uname { color: var(--text-faint); font-size: var(--fs-sm); }
	.controls { display: flex; gap: var(--space-2); align-items: center; }
	.tag {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--bg-subtle);
		color: var(--text-muted);
	}
	.tag.you { background: var(--accent-soft); color: var(--accent); }
	.when { color: var(--text-faint); font-size: var(--fs-sm); margin-left: auto; }
	.drop {
		font: inherit;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		background: none;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}
	.drop:hover { color: var(--danger); background: var(--bg-subtle); }
	.drop:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

	.banner {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		margin-top: var(--space-4);
		font-size: var(--fs-md);
	}
	.banner.ok { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.banner.err { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger); }
</style>
