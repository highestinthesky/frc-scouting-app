<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { addEntry, listEntries } from '$lib/db.js';
	import { session } from '$lib/session.svelte.js';
	import { kick as kickSync } from '$lib/sync.svelte.js';
	import { IDENTITY_FIELDS, OBSERVATION_FIELDS, ALL_FIELDS } from '$lib/form-config.js';
	import Field from '$lib/components/Field.svelte';
	import {
		getCachedSchedule,
		qualMatches,
		nextUnscoutedMatch,
		allianceForTeamInMatch,
		verifyMatchTeam
	} from '$lib/tba.js';

	// One state object holds the value for every field, keyed by field.key.
	let values = $state(blank());
	let saving = $state(false);
	let error = $state('');

	// ─── schedule / next-match state ────────────────────────────────────────

	/** Cached qual matches for this event. Empty if no schedule pulled. */
	let qmList = $state([]);
	/** { match, teams: number[] } for the next match where any of the scout's
	 *  assigned teams is playing and hasn't been scouted yet. */
	let suggestion = $state(null);
	let bannerDismissed = $state(false);

	// Mismatch warning: confirm the entered (match, team) pair really exists
	// in the schedule.
	const scheduleCheck = $derived.by(() => {
		if (!qmList.length) return null;
		const mn = Number(values.matchNumber);
		const tn = Number(values.teamNumber);
		if (!mn || !tn) return null;
		return verifyMatchTeam(qmList, mn, tn);
	});

	// ─── helpers ────────────────────────────────────────────────────────────

	function blank() {
		const v = {};
		for (const f of ALL_FIELDS) {
			v[f.key] = f.type === 'boolean' ? false : '';
		}
		return v;
	}

	/**
	 * Fill match/team/alliance from a known schedule entry + chosen team.
	 * The alliance color is derived from the match itself, not from any
	 * fixed scout position.
	 */
	function fillFromMatchAndTeam(match, teamNumber) {
		if (!match || !Number.isFinite(teamNumber)) return;
		const color = allianceForTeamInMatch(match, teamNumber);
		values.matchNumber = String(match.match_number);
		values.teamNumber = String(teamNumber);
		if (color) values.allianceColor = color;
		bannerDismissed = false;
	}

	// ─── mount: schedule pre-fill, query-param pre-fill, last-entry fallback ─

	onMount(async () => {
		try {
			const all = await listEntries();
			const mine = all.filter(
				(e) => e.eventCode === session.eventCode && e.scoutName === session.scoutName
			);

			const cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
			qmList = cached ? qualMatches(cached.matches) : [];

			// 1) Highest priority: explicit query params from the Schedule tab.
			//    e.g. /new/?match=12&team=1234&color=red
			const qp = new URLSearchParams(page.url.search);
			const qMatch = Number(qp.get('match'));
			const qTeam = Number(qp.get('team'));
			const qColor = qp.get('color');
			if (Number.isFinite(qMatch) && qMatch > 0 && Number.isFinite(qTeam) && qTeam > 0) {
				values.matchNumber = String(qMatch);
				values.teamNumber = String(qTeam);
				// Prefer the schedule-derived color over whatever the URL claims,
				// since the schedule is authoritative; fall back to the URL.
				const match = qmList.find((m) => m.match_number === qMatch);
				const color = match
					? allianceForTeamInMatch(match, qTeam) ?? qColor
					: qColor;
				if (color === 'red' || color === 'blue') values.allianceColor = color;
				return; // skip schedule + last-entry fallbacks
			}

			// 2) Schedule-driven pre-fill: pick the next match where one of my
			//    assigned teams is playing and I haven't entered it yet.
			const teams = session.effectiveTeams;
			if (qmList.length && teams.length) {
				const next = nextUnscoutedMatch(qmList, all, teams);
				if (next) {
					suggestion = next;
					// If only one of my teams is in the next match, auto-fill.
					// If multiple, leave the form blank and let the scout pick
					// from the banner.
					if (next.teams.length === 1) {
						fillFromMatchAndTeam(next.match, next.teams[0]);
					}
					return;
				}
			}

			// 3) Fallback: carry forward alliance + bump match number from the
			//    previous entry. Same behavior as before TBA integration.
			if (mine.length > 0) applyLastEntryPrefill(mine[0]);
		} catch (_e) {
			// Any failure here leaves the form blank — worst case is the scout
			// types a few fields they could have inherited.
		}
	});

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
		Next-match banner: shown when the schedule is loaded, the scout has
		assigned teams, and at least one of them has an unscouted match ahead.
		When exactly one of the scout's teams is in the next match, "Use" just
		applies it. When two or more of the scout's teams are in the same match,
		each team is its own button so the scout picks who to scout first.
	-->
	{#if suggestion && !bannerDismissed}
		<div class="next-banner">
			<div class="banner-body">
				<strong class="banner-label">Next match</strong>
				<span class="banner-detail">
					Q{suggestion.match.match_number}
					{#if suggestion.teams.length === 1}
						{@const t = suggestion.teams[0]}
						{@const c = allianceForTeamInMatch(suggestion.match, t)}
						· Team {t}
						{#if c} · {c}{/if}
					{:else}
						· {suggestion.teams.length} of your teams are in this match
					{/if}
				</span>
			</div>
			<div class="banner-actions">
				{#if suggestion.teams.length === 1}
					<button
						type="button"
						class="use-btn"
						onclick={() => fillFromMatchAndTeam(suggestion.match, suggestion.teams[0])}
					>
						Use this match
					</button>
				{:else}
					{#each suggestion.teams as t}
						{@const c = allianceForTeamInMatch(suggestion.match, t)}
						<button
							type="button"
							class="use-btn pick"
							data-color={c}
							onclick={() => fillFromMatchAndTeam(suggestion.match, t)}
						>
							{t}
						</button>
					{/each}
				{/if}
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

			{#if scheduleCheck?.ok === false}
				<p class="sched-warn">
					<strong>Schedule check:</strong> {scheduleCheck.reason}
				</p>
			{/if}
		</section>

		<section>
			<h2>Observations</h2>
			{#each OBSERVATION_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} scopeTeam={Number(values.teamNumber)} />
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
		border: 1.5px solid var(--banner-info-border);
		background: var(--banner-info-bg);
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
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
	.banner-actions {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	.use-btn {
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.45rem 0.8rem;
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.use-btn.pick { background: #2c5cb0; color: #fff; }
	.use-btn.pick[data-color='red'] { background: #c0392b; }
	.use-btn:hover { filter: brightness(1.06); }
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
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: 0.4rem;
		font-size: 0.85rem;
		color: var(--warning);
	}
	.sched-warn strong { color: var(--warning); filter: brightness(0.85); }

	/* ── form controls ────────────────────────────────────────────── */
	.error {
		background: var(--danger-bg);
		color: var(--danger);
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
