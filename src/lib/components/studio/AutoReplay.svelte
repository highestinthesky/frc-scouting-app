<script>
	// Every auto recorded for one match, played at once.
	//
	// The plan calls this the eagle's-eye replay and it is the headline of the
	// feature. It is also the surface most likely to be trusted more than it
	// deserves, which is what ADR-002 Decision 8 is about:
	//
	//   Six scouts start their recordings at six slightly different moments.
	//   t = 0 is when THAT scout pressed record, not when auto started, and there
	//   is no shared clock to fix it — a gym has no signal, which is the premise
	//   of the whole app.
	//
	// So the tracks are aligned on first movement, the alignment can be nudged by
	// hand, and the page says out loud that this is a reconstruction. Playing six
	// recordings together without saying so would be a lie told in a convincing
	// format.
	import { onDestroy } from 'svelte';
	import AutoField from '$lib/components/AutoField.svelte';
	import Button from '$lib/components/Button.svelte';
	import { firstMovementAt, trackDuration, readTrack } from '$lib/auto-track.js';

	/** @type {{ seats?: Array<{teamNumber:number, allianceColor:string, entries:any[]}> }} */
	let { seats = [] } = $props();

	let t = $state(0);
	let playing = $state(false);
	let flipped = $state(false);
	let nudges = $state({});
	let raf = null;
	let last = 0;

	/**
	 * One track per team — the first entry that has one.
	 *
	 * Two scouts on one team is the good problem: they watched the same robot, so
	 * their tracks are two recordings of one thing rather than two robots. Drawing
	 * both would put two boxes on one robot and read as a collision. The second is
	 * still on the entry and still visible on the team page.
	 */
	const rows = $derived(
		seats
			.map((s) => {
				const withTrack = s.entries.find((e) => readTrack(e));
				if (!withTrack) return null;
				const track = readTrack(withTrack);
				return {
					teamNumber: s.teamNumber,
					colour: s.allianceColor === 'blue' ? 'var(--alliance-blue)' : 'var(--alliance-red)',
					track,
					scout: withTrack.scoutName,
					// Robots start on a shared cue even when scouts do not, so first
					// movement recovers most of the offset for free. Null means the robot
					// never moved, and there is nothing to align on — it plays from its
					// own zero rather than being shifted by a guess.
					firstMove: firstMovementAt(track)
				};
			})
			.filter(Boolean)
	);

	// The reference is the EARLIEST first movement. Shifting everything to the
	// latest instead would make most robots start before t = 0 and be invisible
	// for the opening of the replay.
	const reference = $derived(
		rows.reduce((m, r) => (r.firstMove == null ? m : Math.min(m, r.firstMove)), Infinity)
	);

	const aligned = $derived(
		rows.map((r) => ({
			label: String(r.teamNumber),
			colour: r.colour,
			track: r.track,
			teamNumber: r.teamNumber,
			scout: r.scout,
			offset:
				(r.firstMove == null || reference === Infinity ? 0 : reference - r.firstMove) +
				(nudges[r.teamNumber] ?? 0)
		}))
	);

	const span = $derived(
		aligned.reduce((m, r) => Math.max(m, trackDuration(r.track) + (r.offset ?? 0)), 0)
	);

	/**
	 * One frame is at most this much replay time.
	 *
	 * requestAnimationFrame stops entirely while a tab is hidden — measured at
	 * zero ticks in 500 ms — so the first frame after a manager switches back
	 * carries the whole gap. Unclamped that is `t = t + 40000` and the replay
	 * jumps to the end for no reason the viewer can see. Clamping makes a
	 * backgrounded replay pause and resume instead, which is what it looks like
	 * it should do.
	 */
	const MAX_FRAME_MS = 100;

	function frame(now) {
		if (!playing) return;
		const dt = last ? Math.min(now - last, MAX_FRAME_MS) : 0;
		last = now;
		t = t + dt;
		if (t >= span) {
			t = span;
			playing = false;
			last = 0;
			return;
		}
		raf = requestAnimationFrame(frame);
	}

	function toggle() {
		if (playing) {
			playing = false;
			last = 0;
			if (raf) cancelAnimationFrame(raf);
			return;
		}
		if (t >= span) t = 0;
		playing = true;
		last = 0;
		raf = requestAnimationFrame(frame);
	}

	function nudge(teamNumber, ms) {
		nudges = { ...nudges, [teamNumber]: (nudges[teamNumber] ?? 0) + ms };
	}

	onDestroy(() => {
		playing = false;
		if (raf) cancelAnimationFrame(raf);
	});
</script>

{#if aligned.length}
	<div class="replay">
		<AutoField mode="replay" tracks={aligned} {t} {flipped} />

		<div class="transport">
			<Button variant="primary" onclick={toggle}>{playing ? 'Pause' : 'Play'}</Button>
			<input
				type="range"
				min="0"
				max={span || 1}
				step="50"
				bind:value={t}
				aria-label="Scrub the replay"
				oninput={() => {
					playing = false;
					last = 0;
				}}
			/>
			<span class="clock">{(t / 1000).toFixed(1)}s</span>
			<Button variant="ghost" onclick={() => (flipped = !flipped)}>Flip</Button>
		</div>

		<!-- Said on the screen, not only in a design document. A replay that looks
		     like footage and is not will be read as footage. -->
		<p class="caveat">
			Reconstructed from {aligned.length} independent recordings. Scouts start their
			timers at different moments, so these are aligned on when each robot first
			moved — not on a shared clock. Nudge any robot that looks out of step.
		</p>

		<ul class="legend">
			{#each aligned as r}
				<li>
					<span class="chip" style="--bot: {r.colour}"></span>
					<span class="who">{r.teamNumber}</span>
					<span class="by">{r.scout}</span>
					<span class="off">{r.offset ? `${r.offset > 0 ? '+' : ''}${(r.offset / 1000).toFixed(1)}s` : 'on cue'}</span>
					<span class="nudge">
						<button type="button" onclick={() => nudge(r.teamNumber, -250)} aria-label="Shift {r.teamNumber} earlier">−</button>
						<button type="button" onclick={() => nudge(r.teamNumber, 250)} aria-label="Shift {r.teamNumber} later">+</button>
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* Hallmark · genre: modern-minimal · component: auto-replay
	 * design-system: design.md · palette: Studio ([data-studio])
	 */
	.replay {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.transport input {
		flex: 1;
		min-width: 8rem;
		min-height: var(--tap-min);
	}
	.clock {
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		font-size: var(--fs-sm);
		min-width: 3.5em;
		text-align: right;
	}

	.caveat {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-xs);
		min-width: 0;
	}
	.chip {
		--bot: var(--accent);
		width: 0.85rem;
		height: 0.85rem;
		border-radius: var(--radius-sm);
		background: var(--bot);
		flex: none;
	}
	.who {
		font-weight: 600;
		color: var(--text-primary);
	}
	.by {
		color: var(--text-muted);
	}
	.off {
		margin-left: auto;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.nudge {
		display: flex;
		gap: var(--space-1);
		flex: none;
	}
	.nudge button {
		min-width: var(--tap-min);
		min-height: var(--tap-min);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text-primary);
		font: inherit;
	}
	.nudge button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
