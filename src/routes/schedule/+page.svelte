<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { session } from '$lib/session.svelte.js';
	import { role } from '$lib/role.svelte.js';
	import { listEntries } from '$lib/db.js';
	import {
		fetchAndCacheSchedule,
		publishSchedule,
		pullSchedule,
		getCachedSchedule,
		clearScheduleCache,
		qualMatches,
		teamsInMatch,
		nextUnscoutedMatch
	} from '$lib/tba.js';
	import { listAssignments, replaceAssignments } from '$lib/assignments.js';
	import {
		isPassphraseSet,
		setPassphrase as setPassphraseRemote,
		verifyPassphrase,
		rotatePassphrase as rotatePassphraseRemote,
		resetEventData
	} from '$lib/event-meta.js';
	import { relativeTime, timeOfDay } from '$lib/format.js';

	// ─── shared state ──────────────────────────────────────────────────────

	/** Cached schedule for the current event: { cachedAt, matches } | null. */
	let cached = $state(null);
	let entries = $state([]);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');

	const qmList = $derived(cached ? qualMatches(cached.matches) : []);

	// Effective teams the scout is watching = manager-assigned ∪ local extras.
	const effectiveTeams = $derived(session.effectiveTeams);

	// Upcoming matches for the scout's assigned teams (already-recorded ones
	// are kept in the list but shown muted, so the scout has a sense of pace).
	const myUpcoming = $derived.by(() => {
		if (!qmList.length || !effectiveTeams.length) return [];
		const teamSet = new Set(effectiveTeams);
		const doneKey = new Set(entries.map((e) => `${e.matchNumber}:${e.teamNumber}`));
		const out = [];
		for (const m of qmList) {
			const { red, blue } = teamsInMatch(m);
			const all = [...red, ...blue].filter(Number.isFinite);
			for (const t of all) {
				if (!teamSet.has(t)) continue;
				const isRed = red.includes(t);
				out.push({
					match: m.match_number,
					team: t,
					color: isRed ? 'red' : 'blue',
					done: doneKey.has(`${m.match_number}:${t}`),
					// TBA fills predicted_time as Unix seconds; actual_time once played.
					predictedTime: m.predicted_time ?? m.time ?? null,
					actualTime: m.actual_time ?? null
				});
			}
		}
		return out;
	});

	// Re-tick once a minute so the "in 8 min" labels stay accurate without a
	// manual refresh. $state assignment is what triggers the derived rerun.
	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	// ─── manager-only state ────────────────────────────────────────────────

	let tbaApiKey = $state(session.tbaApiKey);
	let passphraseSetRemote = $state(false);
	let passphraseLocallyKnown = $derived(Boolean(session.managerToken));
	let pwInput = $state('');
	let pwInput2 = $state('');
	let verifyInput = $state('');

	// Rotation + reset state
	let rotateNew = $state('');
	let rotateNew2 = $state('');
	let showForgotHelp = $state(false);

	/** Assignment editor rows. {scout_name, teamsText} so the user can edit
	 *  the team list as a comma-separated string. We parse to numbers on save. */
	let assignRows = $state(/** @type {{scout_name: string, teamsText: string}[]} */ ([]));

	// ─── mount: load cached schedule, entries, assignments, passphrase state ─

	onMount(async () => {
		await reload();
	});

	async function reload() {
		err = '';
		try {
			entries = await listEntries();
			cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			if (role.isManager && session.eventCode) {
				passphraseSetRemote = await isPassphraseSet(session.eventCode);
				const all = await listAssignments(session.eventCode);
				// Group team_number by scout_name for the editor.
				const byScout = new Map();
				for (const r of all) {
					const list = byScout.get(r.scout_name) ?? [];
					list.push(r.team_number);
					byScout.set(r.scout_name, list);
				}
				assignRows = [...byScout.entries()]
					.map(([scout_name, teams]) => ({
						scout_name,
						teamsText: teams.sort((a, b) => a - b).join(', ')
					}))
					.sort((a, b) => a.scout_name.localeCompare(b.scout_name));
				if (assignRows.length === 0) {
					assignRows = [{ scout_name: '', teamsText: '' }];
				}
			}
		} catch (e) {
			err = e?.message ?? String(e);
		}
	}

	// ─── scout actions ─────────────────────────────────────────────────────

	let newTeamInput = $state('');

	async function addLocalTeam() {
		const n = Number(String(newTeamInput).replace(/[^0-9]/g, ''));
		if (!Number.isFinite(n) || n <= 0) return;
		const next = [...(session.localExtraTeams ?? []), n];
		await session.update({ localExtraTeams: next });
		newTeamInput = '';
	}

	async function removeLocalTeam(n) {
		const next = (session.localExtraTeams ?? []).filter((t) => t !== n);
		await session.update({ localExtraTeams: next });
	}

	async function refreshFromServer() {
		busy = true;
		err = '';
		msg = '';
		try {
			const pulled = await pullSchedule(session.eventCode);
			cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			msg = pulled
				? `Pulled ${qualMatches(pulled.matches).length} qual matches.`
				: 'No schedule has been published for this event yet.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	// ─── manager actions ───────────────────────────────────────────────────

	async function fetchFromTba() {
		busy = true;
		err = '';
		msg = '';
		try {
			const matches = await fetchAndCacheSchedule(session.eventCode, tbaApiKey || session.tbaApiKey);
			// Persist the key on this device so reloads don't lose it.
			if (tbaApiKey && tbaApiKey !== session.tbaApiKey) {
				await session.update({ tbaApiKey });
			}
			cached = await getCachedSchedule(session.eventCode);
			msg = `Fetched ${qualMatches(matches).length} qual matches from TBA. Now tap “Publish to teammates”.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function publishToTeammates() {
		err = '';
		msg = '';
		try {
			if (!cached) throw new Error('Fetch the schedule from TBA first.');
			if (passphraseSetRemote && !session.managerToken) {
				throw new Error('Enter and verify the manager passphrase below before publishing.');
			}
			const qmCount = qmList.length;
			const totalCount = cached.matches.length;
			// Confirm so a stray tap (especially on the wrong event code) can't
			// silently overwrite everyone's schedule.
			const ok = confirm(
				`Publish ${qmCount} qual match${qmCount === 1 ? '' : 'es'} ` +
					`(${totalCount} total) for ${session.eventCode}?\n\n` +
					`This replaces the current published schedule. Scouts pull within 30 seconds.`
			);
			if (!ok) return;
			busy = true;
			const res = await publishSchedule(session.eventCode, cached.matches, {
				managerToken: session.managerToken || undefined,
				fetchedBy: session.scoutName || null
			});
			msg = `Published — teammates will pull within 30 seconds. (${new Date(res.fetchedAt).toLocaleTimeString()})`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function clearLocalCache() {
		await clearScheduleCache(session.eventCode);
		cached = null;
		msg = 'Local schedule cache cleared. (This does not delete the published schedule.)';
	}

	async function setPassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!pwInput.trim()) throw new Error('Passphrase is empty.');
			if (pwInput !== pwInput2) throw new Error('Passphrases do not match.');
			const token = await setPassphraseRemote(session.eventCode, pwInput);
			await session.update({ managerToken: token });
			passphraseSetRemote = true;
			pwInput = '';
			pwInput2 = '';
			msg = 'Manager passphrase set. Other manager devices will need this passphrase to publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function verifyAndStorePassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!verifyInput.trim()) throw new Error('Enter the passphrase.');
			const res = await verifyPassphrase(session.eventCode, verifyInput);
			if (!res.ok) throw new Error('That passphrase is not correct.');
			await session.update({ managerToken: res.token });
			verifyInput = '';
			msg = 'Passphrase verified. You can now publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function forgetPassphrase() {
		await session.update({ managerToken: '' });
		msg = 'Forgot the passphrase on this device. Re-enter it to publish again.';
	}

	async function rotatePassphrase() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (!rotateNew.trim()) throw new Error('Enter a new passphrase.');
			if (rotateNew !== rotateNew2) throw new Error('New passphrases do not match.');
			const newToken = await rotatePassphraseRemote(
				session.eventCode,
				session.managerToken,
				rotateNew
			);
			await session.update({ managerToken: newToken });
			rotateNew = '';
			rotateNew2 = '';
			msg = 'Passphrase rotated. Other manager devices will need the new passphrase before they can publish.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	async function resetScheduling() {
		err = '';
		msg = '';
		try {
			if (!session.managerToken) {
				throw new Error('Enter the current passphrase on this device first.');
			}
			const ok = confirm(
				`Reset scheduling for ${session.eventCode}?\n\n` +
					`This removes the manager passphrase, the published schedule, and all ` +
					`scout assignments for this event from the server. Scout-collected ` +
					`entries are NOT touched.\n\n` +
					`After reset, the next device to set a passphrase becomes the new manager. Continue?`
			);
			if (!ok) return;
			busy = true;
			await resetEventData(session.eventCode, session.managerToken);
			await session.update({ managerToken: '' });
			await reload();
			msg = 'Scheduling reset. Set a fresh passphrase and re-publish the schedule.';
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	function addAssignRow() {
		assignRows = [...assignRows, { scout_name: '', teamsText: '' }];
	}

	function removeAssignRow(idx) {
		assignRows = assignRows.filter((_, i) => i !== idx);
		if (assignRows.length === 0) assignRows = [{ scout_name: '', teamsText: '' }];
	}

	async function saveAssignments() {
		busy = true;
		err = '';
		msg = '';
		try {
			if (passphraseSetRemote && !session.managerToken) {
				throw new Error('Verify the manager passphrase before saving assignments.');
			}
			const rows = [];
			for (const r of assignRows) {
				const name = r.scout_name.trim();
				if (!name) continue;
				const teams = (r.teamsText || '')
					.split(/[\s,]+/)
					.map((s) => Number(s.replace(/[^0-9]/g, '')))
					.filter((n) => Number.isFinite(n) && n > 0);
				const dedup = [...new Set(teams)];
				for (const t of dedup) rows.push({ scout_name: name, team_number: t });
			}
			const inserted = await replaceAssignments(session.eventCode, rows, {
				managerToken: session.managerToken
			});
			msg = `Saved ${inserted} assignment row${inserted === 1 ? '' : 's'}.`;
		} catch (e) {
			err = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	// ─── pre-fill link for an upcoming row ─────────────────────────────────

	function newEntryHref(row) {
		const params = new URLSearchParams({
			match: String(row.match),
			team: String(row.team),
			color: row.color
		});
		return `${base}/new/?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>Schedule · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a class="back" href="{base}/" aria-label="Back">←</a>
		<h1>Schedule</h1>
	</header>

	{#if !session.eventCode}
		<p class="muted">
			Set an event code in <a href="{base}/settings/">Settings</a> first.
		</p>
	{:else}
		<!-- ── Manager view ────────────────────────────────────────────── -->
		{#if role.isManager}
			<section>
				<h2>Publish schedule</h2>
				<p class="muted">
					You fetch the match schedule from The Blue Alliance, then publish it
					so every scout on <code>{session.eventCode}</code> can pull it without
					needing their own TBA key.
				</p>

				<label class="field">
					<span class="label">TBA API key</span>
					<small class="help">
						Free key at <strong>thebluealliance.com/account</strong> → Read API
						Keys. Stored only on this device.
					</small>
					<input
						type="password"
						bind:value={tbaApiKey}
						placeholder="Paste your TBA read API key"
						autocomplete="off"
						autocapitalize="none"
					/>
				</label>

				<div class="actions-row">
					<button class="primary" disabled={busy || !tbaApiKey} onclick={fetchFromTba}>
						{busy ? '…' : '1. Fetch from TBA'}
					</button>
					<button
						class="primary"
						disabled={busy || !cached}
						onclick={publishToTeammates}
					>
						{busy ? '…' : '2. Publish to teammates'}
					</button>
					<button class="secondary-btn" disabled={busy || !cached} onclick={clearLocalCache}>
						Clear local cache
					</button>
				</div>

				{#if cached}
					<p class="muted small">
						Local cache: {qmList.length} qual matches · fetched
						{relativeTime(cached.cachedAt, now)}
						({new Date(cached.cachedAt).toLocaleString()})
						{#if cached.fetchedBy} by {cached.fetchedBy}{/if}
					</p>
				{:else}
					<p class="muted small">No schedule fetched yet.</p>
				{/if}
			</section>

			<section>
				<h2>Manager passphrase</h2>
				<p class="muted">
					Once set, publishing the schedule and editing assignments requires this
					passphrase. Scouts never need it.
				</p>

				{#if !passphraseSetRemote}
					<p class="muted small">
						No passphrase set for <code>{session.eventCode}</code> yet. The first
						manager device to set one wins.
					</p>
					<label class="field">
						<span class="label">New passphrase</span>
						<input type="password" bind:value={pwInput} autocomplete="new-password" />
					</label>
					<label class="field">
						<span class="label">Confirm</span>
						<input type="password" bind:value={pwInput2} autocomplete="new-password" />
					</label>
					<button class="primary" disabled={busy || !pwInput} onclick={setPassphrase}>
						Set passphrase
					</button>
				{:else if passphraseLocallyKnown}
					<p class="muted small ok-inline">
						✓ Passphrase active on this device. You can publish and edit
						assignments.
					</p>
					<div class="actions-row">
						<button class="secondary-btn" onclick={forgetPassphrase}>Forget on this device</button>
						<button class="secondary-btn danger-btn" onclick={resetScheduling} disabled={busy}>
							Reset scheduling for this event
						</button>
					</div>

					<details class="rotate-block">
						<summary>Change passphrase</summary>
						<p class="muted small">
							Pick a new passphrase. Other manager devices will need it before
							they can publish or edit assignments again.
						</p>
						<label class="field">
							<span class="label">New passphrase</span>
							<input type="password" bind:value={rotateNew} autocomplete="new-password" />
						</label>
						<label class="field">
							<span class="label">Confirm</span>
							<input type="password" bind:value={rotateNew2} autocomplete="new-password" />
						</label>
						<button class="primary" disabled={busy || !rotateNew} onclick={rotatePassphrase}>
							Rotate
						</button>
					</details>
				{:else}
					<p class="muted small">
						A passphrase is set for this event. Enter it to publish from this
						device.
					</p>
					<label class="field">
						<span class="label">Passphrase</span>
						<input type="password" bind:value={verifyInput} autocomplete="current-password" />
					</label>
					<button class="primary" disabled={busy || !verifyInput} onclick={verifyAndStorePassphrase}>
						Verify
					</button>

					<details class="forgot-block" bind:open={showForgotHelp}>
						<summary>Forgot the passphrase?</summary>
						<p class="muted small">
							There's no in-app recovery for a fully-lost passphrase. An
							admin needs to clear the event's row in Supabase Studio, after
							which the next device to set a passphrase wins.
						</p>
						<p class="muted small">
							From Supabase Studio → SQL Editor, run:
						</p>
						<pre class="sql-snippet"><code>DELETE FROM public.event_meta
WHERE event_code = '{session.eventCode}';</code></pre>
						<p class="muted small">
							Then come back here, set a fresh passphrase, and re-publish.
						</p>
					</details>
				{/if}
			</section>

			<section>
				<h2>Assign scouts</h2>
				<p class="muted">
					One row per scout. Team numbers are comma- or space-separated. Saving
					replaces the entire assignment list on the server.
				</p>
				{#each assignRows as r, i}
					<div class="assign-row">
						<input
							class="scout-name"
							placeholder="Scout name"
							bind:value={r.scout_name}
						/>
						<input
							class="team-list"
							placeholder="e.g. 1234, 5678, 9012"
							bind:value={r.teamsText}
							inputmode="numeric"
						/>
						<button
							type="button"
							class="row-x"
							aria-label="Remove row"
							onclick={() => removeAssignRow(i)}
						>
							×
						</button>
					</div>
				{/each}
				<div class="actions-row">
					<button class="secondary-btn" onclick={addAssignRow}>+ Add scout</button>
					<button class="primary" disabled={busy} onclick={saveAssignments}>
						{busy ? 'Saving…' : 'Save assignments'}
					</button>
				</div>
			</section>
		{:else}
			<!-- ── Scout view ───────────────────────────────────────────── -->

			<section>
				<h2>Your teams</h2>
				<p class="muted">
					Teams you're watching today. Manager-assigned teams appear here
					automatically; you can also add extras yourself if you're filling in.
				</p>

				{#if effectiveTeams.length === 0}
					<p class="muted small">
						No teams yet. Either the manager hasn't assigned you, or your scout
						name on this device doesn't match the one they used.
						Your name: <strong>{session.scoutName || '(not set)'}</strong>.
					</p>
				{:else}
					<div class="team-chips">
						{#each effectiveTeams as t}
							{@const isLocal = (session.localExtraTeams ?? []).includes(t)}
							<span class="team-chip" class:local={isLocal}>
								{t}
								{#if isLocal}
									<button
										type="button"
										class="chip-x"
										aria-label="Remove team {t}"
										onclick={() => removeLocalTeam(t)}
									>×</button>
								{/if}
							</span>
						{/each}
					</div>
				{/if}

				<div class="add-team">
					<input
						type="number"
						bind:value={newTeamInput}
						placeholder="Add team (e.g. 1234)"
						inputmode="numeric"
					/>
					<button class="secondary-btn" disabled={!newTeamInput} onclick={addLocalTeam}>
						Add
					</button>
				</div>

				<div class="actions-row" style="margin-top: 0.6rem;">
					<button class="secondary-btn" disabled={busy} onclick={refreshFromServer}>
						{busy ? '…' : 'Refresh from manager'}
					</button>
				</div>

				{#if cached}
					<p class="muted small freshness">
						Schedule pulled {relativeTime(cached.cachedAt, now)}
						{#if cached.fetchedBy} (published by {cached.fetchedBy}){/if}
						· {qmList.length} qual matches
					</p>
				{/if}
			</section>
		{/if}

		<!-- ── Upcoming matches (shared between roles) ────────────────── -->
		<section>
			<h2>Upcoming matches</h2>
			{#if !cached}
				<p class="muted small">
					{#if role.isManager}
						Fetch and publish to populate this list.
					{:else}
						No schedule pulled yet. Tap “Refresh from manager” above once your
						manager has published.
					{/if}
				</p>
			{:else if !effectiveTeams.length}
				<p class="muted small">Add at least one team above to see your matches.</p>
			{:else if myUpcoming.length === 0}
				<p class="muted small">None of your teams appear in the qual schedule.</p>
			{:else}
				<ul class="upcoming">
					{#each myUpcoming as row (row.match + ':' + row.team)}
						{@const matchTime = row.actualTime ?? row.predictedTime}
						<li class="upcoming-row" data-color={row.color} class:done={row.done}>
							<a href={newEntryHref(row)} class="upcoming-link">
								<span class="up-match">Q{row.match}</span>
								<span class="up-team">Team {row.team}</span>
								<span class="up-color">{row.color}</span>
								{#if matchTime}
									<span class="up-time">
										{timeOfDay(matchTime)}
										<span class="up-rel">· {relativeTime(matchTime, now)}</span>
									</span>
								{/if}
								{#if row.done}<span class="up-done">✓ scouted</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if msg}<p class="banner ok">{msg}</p>{/if}
	{#if err}<p class="banner err">{err}</p>{/if}
</main>

<style>
	main {
		max-width: 36rem;
		margin: 1rem auto;
		padding: 0 1rem 5rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: var(--accent);
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
	.muted { color: var(--text-faint); font-size: 0.92rem; margin: 0 0 0.6rem; }
	.muted.small { font-size: 0.82rem; }
	.ok-inline { color: var(--success); }
	code {
		background: var(--bg-subtle);
		padding: 0 0.25rem;
		border-radius: 0.2rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
	}
	.label { font-weight: 600; font-size: 0.95rem; }
	.help { color: var(--text-faint); font-size: 0.82rem; }
	input {
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
		border-color: var(--accent);
	}

	button.primary,
	button.secondary-btn {
		font: inherit;
		font-weight: 600;
		padding: 0.55rem 1rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 1px solid transparent;
	}
	button.primary {
		background: var(--accent);
		color: var(--on-accent);
		border: none;
	}
	button.primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	button.secondary-btn {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border-strong);
	}
	button.secondary-btn:hover { background: var(--bg-subtle); }
	button.secondary-btn:disabled { opacity: 0.6; cursor: progress; }

	.actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}

	.banner {
		padding: 0.55rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
		font-size: 0.9rem;
	}
	.banner.ok { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
	.banner.err { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger); }

	.freshness {
		margin-top: 0.6rem;
		font-style: italic;
		font-size: 0.8rem;
	}

	.danger-btn {
		color: var(--danger);
		border-color: var(--danger);
	}
	.danger-btn:hover { background: var(--danger-bg); }

	.rotate-block, .forgot-block {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--bg-subtle);
	}
	.rotate-block summary, .forgot-block summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.rotate-block[open], .forgot-block[open] {
		padding-bottom: 0.75rem;
	}
	.rotate-block[open] summary, .forgot-block[open] summary {
		margin-bottom: 0.5rem;
	}

	.sql-snippet {
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: 0.3rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.8rem;
		overflow-x: auto;
		margin: 0.4rem 0;
	}
	.sql-snippet code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: none;
		padding: 0;
	}

	/* ── manager: assignment editor ─────────────────────────────────── */
	.assign-row {
		display: grid;
		grid-template-columns: 1fr 2fr auto;
		gap: 0.4rem;
		margin-bottom: 0.45rem;
	}
	.scout-name, .team-list {
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 0.4rem;
		background: var(--bg-card);
		color: var(--text-primary);
		min-width: 0;
	}
	.row-x {
		background: transparent;
		border: none;
		color: var(--text-faint);
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.4rem;
	}
	.row-x:hover { color: var(--danger); }

	/* ── scout: team chips ──────────────────────────────────────────── */
	.team-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
	.team-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid var(--accent);
		font-weight: 700;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.9rem;
	}
	.team-chip.local {
		background: var(--bg-subtle);
		color: var(--text-primary);
		border-color: var(--border-strong);
		font-weight: 600;
	}
	.chip-x {
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.chip-x:hover { color: var(--danger); }
	.add-team {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.add-team input { flex: 1 1 0; min-width: 0; }

	/* ── upcoming matches list ──────────────────────────────────────── */
	.upcoming {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.upcoming-row {
		border: 1px solid var(--border);
		border-left: 4px solid #999;
		border-radius: 0.4rem;
		background: var(--bg-card);
	}
	.upcoming-row[data-color='red'] { border-left-color: #c0392b; }
	.upcoming-row[data-color='blue'] { border-left-color: #2c5cb0; }
	.upcoming-row.done { opacity: 0.55; }
	.upcoming-link {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.55rem 0.75rem;
		color: inherit;
		text-decoration: none;
		flex-wrap: wrap;
	}
	.upcoming-link:hover { background: var(--bg-subtle); }
	.up-match { font-weight: 700; color: var(--accent); min-width: 3rem; }
	.up-team { font-weight: 600; }
	.up-color { color: var(--text-muted); text-transform: capitalize; font-size: 0.85rem; }
	.up-time {
		color: var(--text-muted);
		font-size: 0.82rem;
		margin-left: auto;
		white-space: nowrap;
	}
	.up-rel { color: var(--text-faint); font-size: 0.78rem; }
	.up-done {
		color: var(--success);
		font-size: 0.8rem;
		font-weight: 600;
	}
</style>
