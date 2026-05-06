<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { addEntry, listEntries } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { kick as kickSync } from '$lib/sync.svelte.js';
	import { IDENTITY_FIELDS, OBSERVATION_FIELDS, ALL_FIELDS } from '$lib/form-config.js';
	import Field from '$lib/components/Field.svelte';
	import {
		getCachedSchedule,
		qualMatches,
		nextUnscoutedMatch,
		teamForPosition,
		allianceFromPosition,
		verifyMatchTeam
	} from '$lib/tba.js';

	// One state object holds the value for every field, keyed by field.key.
	let values = $state(blank());
	let saving = $state(false);
	let error = $state('');

	// ─── schedule / next-match state ────────────────────────────────────────

	// The computed next match from the schedule. Set during onMount; null means
	// "no schedule loaded" or "all matches already covered."
	let nextMatch = $state(null);
	// Qualification match list from the cached schedule (empty if no schedule).
	let qmList = $state([]);
	// Whether the schedule banner was dismissed for this form session.
	let bannerDismissed = $state(false);

	// Mismatch warning: computed from current form values vs schedule.
	// Only shown when a position is set AND a schedule is loaded.
	const scheduleCheck = $derived.by(() => {
		if (!qmList.length || !session.scoutPosition) return null;
		const mn = Number(values.matchNumber);
		const tn = Number(values.teamNumber);
		if (!mn || !tn) return null;
		return verifyMatchTeam(qmList, mn, tn, session.scoutPosition);
	});

	// ─── helpers ────────────────────────────────────────────────────────────

	function blank() {
		// Type-aware defaults: text-ish fields start empty, booleans default to false
		// so the toggle renders in its "no" state and the saved entry stores a real
		// boolean rather than an empty string.
		const v = {};
		for (const f of ALL_FIELDS) {
			v[f.key] = f.type === 'boolean' ? false : '';
		}
		return v;
	}

	/**
	 * Fill match identity fields from a TBA match object + scout position.
	 * Overrides match number, team number, and alliance color.
	 */
	function fillFromMatch(match) {
		if (!match || !session.scoutPosition) return;
		const team = teamForPosition(match, session.scoutPosition);
		const alliance = allianceFromPosition(session.scoutPosition);
		if (team) values.teamNumber = String(team);
		if (alliance) values.allianceColor = alliance;
		values.matchNumber = String(match.match_number);
		bannerDismissed = false; // re-show banner in case user changed something
	}

	// ─── mount: pre-fill from schedule OR last entry ────────────────────────

	onMount(async () => {
		try {
			const all = await listEntries();
			const mine = all.filter(
				(e) => e.eventCode === session.eventCode && e.scoutName === session.scoutName
			);

			// Try to load the cached TBA schedule for this event.
			const cached = session.eventCode
				? await getCachedSchedule(session.eventCode)
				: null;

			if (cached && session.scoutPosition) {
				// Schedule available + position set → use schedule-based pre-fill.
				qmList = qualMatches(cached.matches);
				const next = nextUnscoutedMatch(qmList, all, session.scoutPosition);
				nextMatch = next;
				if (next) {
					fillFromMatch(next);
				} else if (mine.length > 0) {
					// All matches covered; fall back to last-entry pre-fill.
					applyLastEntryPrefill(mine[0]);
				}
			} else if (mine.length > 0) {
				// No schedule or no position — fall back to carry-forward from last entry.
				applyLastEntryPrefill(mine[0]);
			}
		} catch (_e) {
			// Any failure here leaves the form blank — the worst case is the scout
			// types a few fields they could have inherited.
		}
	});

	/**
	 * Carry forward alliance color and bump match number from the previous entry.
	 * This is the pre-schedule fallback behavior: same as before TBA integration.
	 */
	function applyLastEntryPrefill(last) {
		const prefill = blank();
		prefill.allianceColor = last.allianceColor ?? '';
		if (Number.isFinite(last.matchNumber)) {
			prefill.matchNumber = String(Number(last.matchNumber) + 1);
		}
		values = prefill;
	}

	// ─── validation + submit ─────────────────────────────────────────────────

	function validate() {
		for (const f of ALL_FIELDS) {
			if (f.required && (values[f.key] === '' || values[f.key] == null)) {
				return `Missing: ${f.label}`;
			}
		}
		return '';
	}

	async function submit(e) {
		e.preventDefault();
		const v = validate();
		if (v) {
			error = v;
			return;
		}
		error = '';
		saving = true;
		try {
			// Identity fields go on the entry directly; observation fields go
			// inside an `observations` object so the schema is portable.
			const observations = {};
			for (const f of OBSERVATION_FIELDS) observations[f.key] = values[f.key] ?? '';

			await addEntry({
				eventCode: session.eventCode,
				scoutName: session.scoutName,
				matchNumber: Number(values.matchNumber),
				teamNumber: Number(values.teamNumber),
				allianceColor: values.allianceColor,
				observations
			});

			// Push to peers immediately rather than waiting for the next poll tick.
			// No-op if no session is joined or the network is down — the sync
			// layer will catch up when it can.
			kickSync();

			await goto(`${base}/`);
		} catch (err) {
			error = err.message ?? String(err);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>New entry · FRC Scout</title>
</svelte:head>

<main>
	<header class="page-head">
		<a href="{base}/" class="back" aria-label="Back to entries">←</a>
		<h1>New entry</h1>
	</header>

	<!--
		Next-match banner: shown when the schedule is loaded, a position is set,
		and there is still an unscouted match ahead. The user can dismiss it
		or tap "Use this match" to lock in the identity fields.
	-->
	{#if nextMatch && session.scoutPosition && !bannerDismissed}
		{@const bannerAlliance = allianceFromPosition(session.scoutPosition)}
		{@const bannerTeam = teamForPosition(nextMatch, session.scoutPosition)}
		<div class="next-banner" data-alliance={bannerAlliance}>
			<div class="banner-body">
				<strong class="banner-label">Next match</strong>
				<span class="banner-detail">
					Q{nextMatch.match_number}
					{#if bannerTeam} · Team {bannerTeam}{/if}
					{#if bannerAlliance} · {bannerAlliance}{/if}
					{#if session.scoutPosition}
						<span class="banner-pos">({session.scoutPosition})</span>
					{/if}
				</span>
			</div>
			<div class="banner-actions">
				<button
					type="button"
					class="use-btn"
					onclick={() => fillFromMatch(nextMatch)}
				>
					Use this match
				</button>
				<button
					type="button"
					class="dismiss-btn"
					aria-label="Dismiss suggestion"
					onclick={() => (bannerDismissed = true)}
				>
					✕
				</button>
			</div>
		</div>
	{/if}

	<form onsubmit={submit} novalidate>
		<section>
			<h2>Match</h2>
			{#each IDENTITY_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} />
			{/each}

			<!--
				Schedule verification: warn when the entered match + team combination
				doesn't match what the schedule says for the scout's position.
				ok: false = definite mismatch  |  ok: null = can't verify  |  ok: true = silent
			-->
			{#if scheduleCheck?.ok === false}
				<p class="sched-warn">
					<strong>Schedule check:</strong> {scheduleCheck.reason}
				</p>
			{/if}
		</section>

		<section>
			<h2>Observations</h2>
			{#each OBSERVATION_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} />
			{/each}
		</section>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<a href="{base}/" class="cancel">Cancel</a>
			<button type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Save entry'}
			</button>
		</div>
	</form>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 1.5rem auto;
		padding: 0 1rem 4rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.back {
		font-size: 1.5rem;
		text-decoration: none;
		color: #0b3d91;
		padding: 0.25rem 0.5rem;
	}
	h1 { margin: 0; }
	h2 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: 1.5rem 0 0.75rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.35rem;
	}

	/* ── next-match banner ────────────────────────────────────────── */
	.next-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.8rem;
		border-radius: 0.5rem;
		border: 1.5px solid #bccbea;
		background: #e8effc;
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
	}
	.next-banner[data-alliance='red'] {
		background: #fef2f2;
		border-color: #fca5a5;
	}
	.next-banner[data-alliance='blue'] {
		background: #eff6ff;
		border-color: #93c5fd;
	}
	.banner-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.banner-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.banner-detail {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.banner-pos {
		font-weight: 400;
		color: var(--text-muted);
		font-size: 0.85rem;
		margin-left: 0.2rem;
	}
	.banner-actions {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-shrink: 0;
	}
	.use-btn {
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.45rem 0.8rem;
		background: #0b3d91;
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.use-btn:hover { background: #0a3480; }
	.dismiss-btn {
		font: inherit;
		font-size: 0.9rem;
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		padding: 0.3rem 0.45rem;
		border-radius: 0.3rem;
		line-height: 1;
	}
	.dismiss-btn:hover { color: var(--text-primary); background: var(--bg-subtle); }

	/* ── schedule mismatch warning ────────────────────────────────── */
	.sched-warn {
		margin: 0.5rem 0 0;
		padding: 0.5rem 0.7rem;
		background: #fffbeb;
		border: 1px solid #fcd34d;
		border-radius: 0.4rem;
		font-size: 0.85rem;
		color: #92400e;
	}
	.sched-warn strong { color: #78350f; }

	/* ── form controls ────────────────────────────────────────────── */
	.error {
		background: #fdecea;
		color: #842029;
		padding: 0.6rem 0.75rem;
		border-radius: 0.4rem;
		margin-top: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
	.cancel {
		color: var(--text-muted);
		text-decoration: none;
		padding: 0.5rem 0.75rem;
	}
	button {
		font: inherit;
		font-weight: 600;
		padding: 0.7rem 1.2rem;
		background: #0b3d91;
		color: white;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	button:disabled { opacity: 0.6; cursor: progress; }
</style>
