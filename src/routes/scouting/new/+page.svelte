<script>
	import { onMount } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { addEntry, listEntries } from '$lib/db.js';
	import { draftSlot, hasContent, loadDraft, saveDraft, clearDraft } from '$lib/draft.js';
	import { session } from '$lib/session.svelte.js';
	import { rowScout, sameScout } from '$lib/scout-identity.js';
	import { auth } from '$lib/auth.svelte.js';
	import { kick as kickSync } from '$lib/sync.svelte.js';
	import {
		IDENTITY_FIELDS,
		METRIC_FIELDS,
		NOTE_FIELDS,
		OBSERVATION_FIELDS,
		ALL_FIELDS
	} from '$lib/form-config.js';
	import Field from '$lib/components/Field.svelte';
	import AutoRecorder from '$lib/components/AutoRecorder.svelte';
	import {
		getCachedSchedule,
		qualMatches,
		nextUnscoutedMatch,
		allianceForTeamInMatch,
		teamsInMatch,
		verifyMatchTeam
	} from '$lib/tba.js';

	// One state object holds the value for every field, keyed by field.key.
	let values = $state(blank());
	let saving = $state(false);
	let error = $state('');

	// ─── where back goes ────────────────────────────────────────────────────
	//
	// Back, Cancel and the post-save redirect were all hardcoded to /scouting/,
	// so reaching this form from Home and pressing back landed somewhere the
	// scout had never been. afterNavigate reports the real previous page.
	//
	// Not history.back(): this form is reachable from a reminder, a pasted link
	// and the installed PWA's start URL, and in each of those the previous entry
	// belongs to another site or does not exist. A known-good fallback beats
	// walking off the app.
	let origin = $state(`${base}/scouting/`);

	afterNavigate((nav) => {
		const from = nav?.from?.url?.pathname;
		if (!from) return; // cold load or deep link — keep the fallback
		// Never return to a form: /new → /new is a loop, and coming from /edit
		// means the scout was already redirected once.
		if (from.startsWith(`${base}/scouting/new`) || from.startsWith(`${base}/scouting/edit`)) return;
		origin = from;
	});

	// ─── the draft ──────────────────────────────────────────────────────────
	//
	// draftReady gates the save effect. Without it, the effect fires while
	// applyPrefill() is still writing to `values` and immediately persists the
	// pre-fill as if the scout had typed it.
	let draftKey = $state('new');
	let draftReady = $state(false);
	let restoredDraft = $state(false);

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
		// The auto track is deliberately NOT in ALL_FIELDS: it is not a <Field>,
		// it has no `type` the Field component understands, and putting it there
		// would send it through the CSV export and the edit loop as a string.
		//
		// It lives in `values` anyway so the draft carries it for free — a scout
		// who records fifteen seconds and then backgrounds the app must not lose
		// them. null rather than '' because blank is not zero and an empty string
		// is a value: an entry with no track must have no `autoTrack` key at all.
		v.autoTrack = null;
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
			await applyPrefill();
		} catch (_e) {
			// Any failure here leaves the form blank — worst case is the scout
			// types a few fields they could have inherited.
		}

		// AFTER pre-fill, never before. The draft to restore is chosen by the
		// match and team this form was opened for, so a stale draft must not be
		// what decides which draft to load — that is circular, and it is how a
		// draft for Q3 would end up reopening itself on every visit.
		await restoreDraft();
		draftReady = true;
	});

	/** Everything that decides what a freshly-opened form starts out holding. */
	async function applyPrefill() {
		const all = await listEntries();
		const mine = all.filter(
			(e) => e.eventCode === session.eventCode && sameScout(rowScout(e), auth.me)
		);

		const cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
		qmList = cached ? qualMatches(cached.matches) : [];

		// 1) Highest priority: explicit query params from the Schedule tab
		//    or a reminder banner.
		//    Full form: /new/?match=12&team=1234&color=red
		//    Match only: /new/?match=12  → resolve my team for that match.
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
		if (Number.isFinite(qMatch) && qMatch > 0) {
			// Match-only deeplink (e.g. from a reminder). Fill the match number,
			// then resolve which of my teams plays in it — overrides win, else
			// my effective team list. Auto-fill when exactly one applies;
			// otherwise show the picker so the scout chooses.
			values.matchNumber = String(qMatch);
			const match = qmList.find((m) => m.match_number === qMatch);
			if (match) {
				const ovTeams = (session.overrides ?? [])
					.filter((o) => o.match_number === qMatch && sameScout(rowScout(o), auth.me))
					.map((o) => Number(o.team_number))
					.filter(Number.isFinite);
				const { red, blue } = teamsInMatch(match);
				const playing = new Set([...red, ...blue].filter(Number.isFinite));
				const candidates = (ovTeams.length ? ovTeams : session.assignedTeams)
					.filter((t) => playing.has(t));
				const mine = [...new Set(candidates)].sort((a, b) => a - b);
				if (mine.length === 1) {
					fillFromMatchAndTeam(match, mine[0]);
				} else if (mine.length > 1) {
					suggestion = { match, teams: mine };
				}
			}
			return;
		}

		// 2) Schedule-driven pre-fill: pick the next match where one of my
		//    assigned teams is playing and I haven't entered it yet.
		//    Per-match overrides (from session.overrides) win over the
		//    base team list when one applies to the (match, scout) pair.
		const teams = session.assignedTeams;
		if (qmList.length && (teams.length || session.overrides?.length)) {
			const next = nextUnscoutedMatch(qmList, all, {
				assignedTeams: teams,
				overrides: session.overrides ?? [],
				scout: auth.me
			});
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
	}

	/**
	 * Bring back what was typed last time this form was open.
	 *
	 * The slot is decided by the match and team pre-fill settled on, so a draft
	 * for Q3 never pours itself into a form opened for Q7. A deep link naming a
	 * different pair simply looks up a different slot and finds nothing.
	 */
	async function restoreDraft() {
		draftKey = draftSlot({ matchNumber: values.matchNumber, teamNumber: values.teamNumber });
		try {
			const found = await loadDraft(session.eventCode, draftKey);
			if (!found?.values) return;
			// Merge over the blank rather than assigning: a field added to
			// form-config.js since the draft was written must exist, not be absent.
			const merged = blank();
			for (const k of Object.keys(merged)) {
				if (k in found.values) merged[k] = found.values[k];
			}
			values = merged;
			restoredDraft = true;
		} catch (_e) {
			// A broken draft must never block recording. Worst case is retyping.
		}
	}

	// Persist on every change, debounced. $state.snapshot is not optional here:
	// handing a Svelte proxy to IndexedDB throws DataCloneError, which has
	// already cost this codebase a release — see ImportEntries.
	$effect(() => {
		if (!draftReady) return;
		const snapshot = $state.snapshot(values);
		if (!hasContent(snapshot, blank())) return;
		const eventCode = session.eventCode;
		const key = draftKey;
		const t = setTimeout(() => {
			saveDraft(eventCode, key, snapshot).catch(() => {});
		}, 400);
		return () => clearTimeout(t);
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
			// Only when there is one. An absent key is what readTrack() reports as
			// "not recorded", and it is what keeps a skipped recording out of the
			// aggregates instead of in them as an empty path.
			if (values.autoTrack) observations.autoTrack = $state.snapshot(values.autoTrack);

			await addEntry({
				eventCode: session.eventCode,
				scoutName: session.scoutName,
				matchNumber: Number(values.matchNumber),
				teamNumber: Number(values.teamNumber),
				allianceColor: values.allianceColor,
				observations
			});

			kickSync();

			// Only a successful save forgets the draft. Cancel deliberately does
			// not — an accidental back press is the case the draft exists for.
			await clearDraft(session.eventCode, draftKey);

			await goto(origin);
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
		<a href={origin} class="back" aria-label="Back">←</a>
		<h1>New entry</h1>
	</header>

	<!-- Say so. A form that fills itself in looks like stale data from someone
	     else's match unless it explains itself. -->
	{#if restoredDraft}
		<p class="restored">Picked up where you left off.</p>
	{/if}

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
			<h2>Auto</h2>
			<AutoRecorder
				value={values.autoTrack}
				allianceColor={values.allianceColor}
				onchange={(t) => (values.autoTrack = t)}
			/>
		</section>

		<section>
			<h2>Counts</h2>
			{#each METRIC_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} />
			{/each}
		</section>

		<section>
			<h2>Notes</h2>
			{#each NOTE_FIELDS as f (f.key)}
				<Field field={f} bind:value={values[f.key]} scopeTeam={Number(values.teamNumber)} />
			{/each}
		</section>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<a href={origin} class="cancel">Cancel</a>
			<button type="submit" disabled={saving}>
				{saving ? 'Saving…' : 'Save entry'}
			</button>
		</div>
	</form>
</main>

<style>
	/* Hallmark · genre: modern-minimal · macrostructure: Workbench
	 * design-system: design.md · designed-as-app
	 */

	main {
		max-width: 32rem;
		margin: var(--space-5) auto;
		padding: 0 var(--space-4) calc(var(--nav-bottom-h) + var(--space-6));
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
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
		border-radius: var(--radius-sm);
	}
	.restored {
		margin: 0 0 var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--banner-info-bg);
		border: 1px solid var(--banner-info-border);
		font-size: var(--fs-sm);
		color: var(--text-muted);
	}
	.back:hover { background: var(--bg-subtle); }
	.back:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
	h2 {
		font-size: var(--fs-md);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: var(--space-5) 0 var(--space-3);
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--space-1);
	}

	/* ── next-match banner ─────────────────────────────── */
	.next-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-lg);
		border: 1.5px solid var(--banner-info-border);
		background: var(--banner-info-bg);
		flex-wrap: wrap;
	}
	.banner-body { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
	.banner-label {
		font-size: var(--fs-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.banner-detail { font-size: var(--fs-md); font-weight: 600; color: var(--text-primary); }
	.banner-actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	.use-btn {
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 700;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		white-space: nowrap;
	}
	/* Alliance colour, so the button reads as "scout the blue one" rather than
	   as a second brand colour. Tokens, not literals — dark mode lightens both. */
	.use-btn.pick { background: var(--alliance-blue); color: var(--on-alliance); }
	.use-btn.pick[data-color='red'] { background: var(--alliance-red); }
	.use-btn:hover { filter: brightness(1.06); }
	.use-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.dismiss-btn {
		font: inherit;
		font-size: var(--fs-md);
		background: transparent;
		border: none;
		color: var(--text-faint);
		cursor: pointer;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border-radius: var(--radius-sm);
		line-height: 1;
	}
	.dismiss-btn:hover { color: var(--text-primary); background: var(--bg-subtle); }
	.dismiss-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

	/* ── schedule mismatch warning ─────────────────────── */
	.sched-warn {
		margin: var(--space-2) 0 0;
		padding: var(--space-2) var(--space-3);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		color: var(--warning);
	}
	.sched-warn strong { color: var(--warning); filter: brightness(0.85); }

	/* ── form controls ─────────────────────────────── */
	.error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		margin-top: var(--space-4);
	}
	.actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		justify-content: flex-end;
		margin-top: var(--space-5);
	}
	.cancel {
		color: var(--text-muted);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
	}
	.cancel:hover { background: var(--bg-subtle); color: var(--text-primary); }
	.cancel:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	form button[type='submit'] {
		font: inherit;
		font-weight: 600;
		min-height: var(--tap-min);
		padding: 0 var(--space-5);
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	form button[type='submit']:hover:not(:disabled) { background: var(--accent-hover); }
	form button[type='submit']:disabled { opacity: 0.6; cursor: progress; }
	form button[type='submit']:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
