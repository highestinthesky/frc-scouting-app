<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { clearEntries } from '$lib/db.js';
	import { syncState, resync } from '$lib/sync.svelte.js';
	import { theme } from '$lib/theme.svelte.js';
	import {
		fetchAndCacheSchedule,
		getCachedSchedule,
		clearScheduleCache,
		qualMatches
	} from '$lib/tba.js';

	let eventCode = $state(session.eventCode);
	let scoutName = $state(session.scoutName);
	let saving = $state(false);
	let savedMsg = $state('');
	let clearMsg = $state('');

	// ─── TBA schedule state ────────────────────────────────────────────────────

	// Local copies of session fields so the user can edit before saving.
	let scoutPosition = $state(session.scoutPosition);
	let tbaApiKey = $state(session.tbaApiKey);
	let savingTba = $state(false);
	let tbaMsg = $state('');
	let tbaError = $state('');

	// Schedule status — loaded on mount and after fetch/clear.
	let scheduleInfo = $state(null); // { cachedAt, matchCount } | null

	const POSITIONS = ['red 1', 'red 2', 'red 3', 'blue 1', 'blue 2', 'blue 3'];

	async function loadScheduleInfo() {
		const ev = session.eventCode || eventCode.trim().toLowerCase();
		if (!ev) { scheduleInfo = null; return; }
		const cached = await getCachedSchedule(ev);
		if (!cached) { scheduleInfo = null; return; }
		const qm = qualMatches(cached.matches);
		scheduleInfo = { cachedAt: cached.cachedAt, matchCount: qm.length };
	}

	onMount(loadScheduleInfo);

	async function saveTbaSettings(e) {
		e.preventDefault();
		savingTba = true;
		tbaMsg = '';
		tbaError = '';
		try {
			await session.update({
				scoutPosition: scoutPosition.trim(),
				tbaApiKey: tbaApiKey.trim()
			});
			tbaMsg = 'Saved.';
		} catch (err) {
			tbaError = err.message ?? String(err);
		} finally {
			savingTba = false;
		}
	}

	async function fetchSchedule() {
		tbaMsg = '';
		tbaError = '';
		const ev = session.eventCode || eventCode.trim().toLowerCase();
		const key = session.tbaApiKey || tbaApiKey.trim();
		if (!ev) { tbaError = 'Set an event code in Identity first.'; return; }
		if (!key) { tbaError = 'Add a TBA API key below before fetching.'; return; }
		savingTba = true;
		try {
			const matches = await fetchAndCacheSchedule(ev, key);
			const qm = qualMatches(matches);
			await loadScheduleInfo();
			tbaMsg = `Schedule loaded: ${qm.length} qual match${qm.length === 1 ? '' : 'es'} for ${ev}.`;
		} catch (err) {
			tbaError = err.message ?? String(err);
		} finally {
			savingTba = false;
		}
	}

	async function clearSchedule() {
		const ev = session.eventCode || eventCode.trim().toLowerCase();
		if (!ev) return;
		await clearScheduleCache(ev);
		scheduleInfo = null;
		tbaMsg = 'Schedule cleared.';
	}

	async function saveSession(e) {
		e.preventDefault();
		saving = true;
		savedMsg = '';
		try {
			await session.update({
				eventCode: eventCode.trim().toLowerCase(),
				scoutName: scoutName.trim()
			});
			savedMsg = 'Saved.';
		} finally {
			saving = false;
		}
	}

	async function setRole(newRole) {
		await role.set(newRole);
	}

	async function clearAll() {
		const ok = confirm(
			'Delete every entry stored on this device? This cannot be undone. ' +
				'Make sure you exported first.'
		);
		if (!ok) return;
		await clearEntries();
		clearMsg = 'All entries cleared.';
	}

	function statusLabel() {
		if (!session.eventCode) return 'No event code set';
		if (syncState.status === 'connected') return 'Connected';
		if (syncState.status === 'connecting') return 'Connecting…';
		if (syncState.status === 'offline') return 'Offline';
		if (syncState.status === 'error') return `Error: ${syncState.error ?? 'unknown'}`;
		return 'Idle';
	}
</script>

<svelte:head>
	<title>Settings · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/" aria-label="Back">←</a>
		<h1>Settings</h1>
	</header>

	<section>
		<h2>Role</h2>
		<p class="muted">Choose what this device is being used for.</p>
		<div class="roles">
			<button class:selected={role.isScout} onclick={() => setRole('scout')}>
				<strong>Scout</strong>
				<small>Records matches, exports a single file.</small>
			</button>
			<button class:selected={role.isManager} onclick={() => setRole('manager')}>
				<strong>Manager</strong>
				<small>Imports scout files, sees aggregated entries, re-exports.</small>
			</button>
		</div>
	</section>

	<section>
		<h2>Identity</h2>
		<form onsubmit={saveSession}>
			<label class="field">
				<span class="label">Event code</span>
				<small class="help">
					Anyone on your team using the same event code shares data automatically.
					Switch events by changing this field.
				</small>
				<input bind:value={eventCode} autocomplete="off" autocapitalize="none" placeholder="e.g. 2027hvr" />
			</label>

			<label class="field">
				<span class="label">Your name</span>
				<input bind:value={scoutName} autocomplete="name" />
			</label>

			<button type="submit" class="primary" disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
			{#if savedMsg}<small class="muted ok">{savedMsg}</small>{/if}
		</form>
	</section>

	<!-- ── Schedule (TBA) ──────────────────────────────────────────────────── -->
	<!--
		This section is only meaningful for scouts (the manager doesn't record
		entries). We show it regardless of role so the manager can verify their
		team's configuration.
	-->
	<section>
		<h2>Schedule (TBA)</h2>
		<p class="muted">
			Set your alliance position and connect to The Blue Alliance so the entry
			form can suggest your next match and pre-fill the team number.
		</p>

		<form onsubmit={saveTbaSettings}>
			<!-- Scout position picker -->
			<div class="field">
				<span class="label">Your alliance position</span>
				<small class="help">Which slot you're assigned for the whole event.</small>
				<div class="pos-pills">
					{#each POSITIONS as pos}
						{@const isRed = pos.startsWith('red')}
						<button
							type="button"
							class="pos-pill"
							class:selected={scoutPosition === pos}
							class:red={isRed}
							class:blue={!isRed}
							onclick={() => (scoutPosition = scoutPosition === pos ? '' : pos)}
						>
							{pos}
						</button>
					{/each}
				</div>
			</div>

			<!-- TBA API key -->
			<label class="field">
				<span class="label">TBA API key</span>
				<small class="help">
					Free key at <strong>thebluealliance.com/account</strong> → Read API Keys.
					Stored only on this device.
				</small>
				<input
					type="password"
					bind:value={tbaApiKey}
					autocomplete="off"
					autocapitalize="none"
					placeholder="Paste your TBA read API key"
				/>
			</label>

			<div class="tba-actions">
				<button type="submit" class="primary" disabled={savingTba}>
					{savingTba ? 'Saving…' : 'Save'}
				</button>
				<button
					type="button"
					class="secondary-btn"
					onclick={fetchSchedule}
					disabled={savingTba}
				>
					Fetch schedule
				</button>
			</div>

			{#if tbaMsg}<small class="muted ok">{tbaMsg}</small>{/if}
			{#if tbaError}<small class="error-inline">{tbaError}</small>{/if}
		</form>

		<!-- Schedule cache status -->
		{#if scheduleInfo}
			<div class="schedule-status">
				<span class="sched-ok">
					{scheduleInfo.matchCount} qual match{scheduleInfo.matchCount === 1 ? '' : 'es'} cached
					for {session.eventCode || eventCode || '—'}
				</span>
				<span class="sched-age">
					· fetched {new Date(scheduleInfo.cachedAt).toLocaleString()}
				</span>
				<button type="button" class="clear-link" onclick={clearSchedule}>Clear</button>
			</div>
		{:else if session.eventCode}
			<p class="muted sched-none">No schedule cached for {session.eventCode}.</p>
		{/if}
	</section>

	<section>
		<h2>Wireless sync</h2>
		<p class="muted">
			Sync follows the event code above. Anyone with the same code in their
			Identity sees the same entries within a few seconds.
		</p>
		<p class="status {syncState.status}">
			{statusLabel()}{#if syncState.pendingCount > 0} · {syncState.pendingCount} pending{/if}
		</p>
		<div class="sync-actions">
			<button
				class="primary"
				onclick={resync}
				disabled={!session.eventCode || syncState.status === 'offline'}
			>
				Sync now
			</button>
			{#if syncState.lastSyncedAt}
				<small class="muted">Last sync: {new Date(syncState.lastSyncedAt).toLocaleTimeString()}</small>
			{/if}
		</div>
	</section>

	<section>
		<h2>Appearance</h2>
		<p class="muted">Choose how the app looks. "System" follows your phone's setting.</p>
		<div class="theme-row">
			<button
				class="theme-btn"
				class:selected={theme.value === 'system'}
				onclick={() => theme.set('system')}
			>System</button>
			<button
				class="theme-btn"
				class:selected={theme.value === 'light'}
				onclick={() => theme.set('light')}
			>Light</button>
			<button
				class="theme-btn"
				class:selected={theme.value === 'dark'}
				onclick={() => theme.set('dark')}
			>Dark</button>
		</div>
	</section>

	<section>
		<h2>Danger zone</h2>
		<p class="muted">
			Wipes every entry stored on this device. Settings are kept. Use this
			after exporting and confirming the file works on the manager side.
		</p>
		<button class="danger" onclick={clearAll}>Clear all entries</button>
		{#if clearMsg}<small class="muted ok">{clearMsg}</small>{/if}
	</section>

	<section>
		<h2>About</h2>
		<p class="muted">
			FRC Scout is local-first. Entries live on this device; if your event
			code matches a teammate's, both devices push and pull through the cloud
			automatically. Files (<code>.scout</code>) work as a fallback for
			venues with no network.
		</p>
	</section>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0 1rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: #0b3d91;
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; font-size: 1.5rem; }
	h2 {
		margin: 1.5rem 0 0.5rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted { color: var(--text-faint); font-size: 0.9rem; margin: 0 0 0.6rem; }
	.ok { color: #0b3d91; margin-left: 0.5rem; }
	.help { color: var(--text-faint); font-size: 0.82rem; }
	code {
		background: var(--bg-subtle);
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}

	.roles {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.roles button {
		flex: 1 1 0;
		min-width: 12rem;
		text-align: left;
		padding: 0.85rem 1rem;
		background: var(--bg-card);
		border: 2px solid #ccc;
		border-radius: 0.5rem;
		cursor: pointer;
		font: inherit;
	}
	.roles button.selected {
		border-color: #0b3d91;
		background: #f0f4fc;
	}
	.roles button strong { display: block; font-size: 1rem; }
	.roles button small {
		display: block;
		color: var(--text-muted);
		font-size: 0.85rem;
		margin-top: 0.2rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 1rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
	input {
		font: inherit;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
	}
	input:focus {
		outline: 2px solid #0b3d91;
		outline-offset: 1px;
		border-color: #0b3d91;
	}
	button.primary,
	button.danger {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary { background: #0b3d91; color: white; border: none; }
	button.primary:disabled { opacity: 0.6; cursor: progress; }
	button.danger {
		background: var(--bg-card);
		color: #c0392b;
		border: 1px solid #c0392b;
	}
	button.danger:hover { background: #fdecea; }

	.status {
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.4rem 0.7rem;
		border-radius: 0.4rem;
		display: inline-block;
		margin-bottom: 0.4rem;
	}
	.status.idle { background: #f3f4f6; color: var(--text-muted); }
	.status.connected { background: #ecfdf5; color: #065f46; }
	.status.connecting { background: #fefce8; color: #854d0e; }
	.status.offline { background: #f3f4f6; color: var(--text-muted); }
	.status.error { background: #fef2f2; color: #991b1b; }
	.sync-actions {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.sync-actions button.primary:disabled {
		background: #93a3c4;
		cursor: not-allowed;
	}

	.theme-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.theme-btn {
		flex: 1 1 0;
		min-width: 6rem;
		padding: 0.6rem 0.85rem;
		background: var(--bg-card);
		color: var(--text-primary);
		border: 2px solid var(--border-strong);
		border-radius: 0.4rem;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
	}
	.theme-btn.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}

	/* ── TBA / schedule section ───────────────────────────────────── */
	.pos-pills {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-top: 0.2rem;
	}
	.pos-pill {
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.4rem 0.7rem;
		border-radius: 0.4rem;
		border: 2px solid #ccc;
		background: var(--bg-card);
		cursor: pointer;
		text-transform: capitalize;
		min-width: 4.5rem;
		text-align: center;
	}
	.pos-pill.red.selected {
		background: #c0392b;
		border-color: #c0392b;
		color: white;
	}
	.pos-pill.blue.selected {
		background: #2c5cb0;
		border-color: #2c5cb0;
		color: white;
	}
	.pos-pill:not(.selected):hover { background: var(--bg-subtle); }

	.tba-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.secondary-btn {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		color: var(--text-primary);
	}
	.secondary-btn:hover { background: var(--bg-subtle); }
	.secondary-btn:disabled { opacity: 0.6; cursor: progress; }

	.error-inline {
		color: #c0392b;
		font-size: 0.85rem;
		display: block;
		margin-top: 0.35rem;
	}

	.schedule-status {
		margin-top: 0.6rem;
		font-size: 0.85rem;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0.45rem 0.65rem;
		background: #ecfdf5;
		border: 1px solid #6ee7b7;
		border-radius: 0.4rem;
		color: #065f46;
	}
	.sched-ok { font-weight: 600; }
	.sched-age { color: #047857; font-size: 0.8rem; }
	.clear-link {
		background: none;
		border: none;
		font: inherit;
		font-size: 0.82rem;
		color: #065f46;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
		margin-left: auto;
	}
	.clear-link:hover { color: #c0392b; }
	.sched-none { margin-top: 0.4rem; }
</style>
