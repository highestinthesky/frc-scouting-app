// The manager pages' view of the current event, loaded once.
//
// /studio/schedule loaded all of this itself — schedule, entries, assignments,
// overrides, reminders, the account roster — which is why its seven panels
// could not be pulled apart: every panel read state the page owned. Split into
// Plan and Run, six pages need overlapping halves of it, and six pages each
// loading their own copy is six ideas of the event. So it loads here, once per
// event, from the root +layout.svelte (Home's manager tiles read it too), and
// the pages derive what they show.
//
// ─── which event ───────────────────────────────────────────────────────────
//
// session.eventCode, the value the device records to. The layout calls
// `load()` whenever it changes, and a load begun for one event never writes
// over the next one's (`#gen`).
//
// ─── local first ───────────────────────────────────────────────────────────
//
// Entries and the cached schedule are IndexedDB and are on screen before any
// network call starts. The rest is Supabase, each read on its own failure path:
// a manager in a gym with no signal still sees the schedule and the coverage,
// and an empty roster is a normal state, not an error. Never gate local data
// behind a network call.

import { session } from './session.svelte.js';
import { auth } from './auth.svelte.js';
import { listEntries } from './db.js';
import { getCachedSchedule, getPublishedTbaEventKey, qualMatches } from './tba.js';
import { listAssignments, listOverrides } from './assignments.js';
import { listReminders } from './reminders.js';
import { buildEntryIndex, scheduleRollup } from './coverage.js';
import { editorRows } from './plan-state.js';
import { listMyEvents, eventRoster } from './events.js';

class EventData {
	/** The event this data belongs to. '' before the first load. */
	code = $state('');

	/** Cached TBA schedule: { cachedAt, matches } | null. Raw, playoffs included. */
	cached = $state(/** @type {any} */ (null));
	/** Every entry on the device, newest first. Use `eventEntries` for this event. */
	entries = $state(/** @type {any[]} */ ([]));
	/** Saved assignments, one row per scout × team. */
	assignments = $state(/** @type {any[]} */ ([]));
	overrides = $state(/** @type {any[]} */ ([]));
	reminders = $state(/** @type {any[]} */ ([]));
	/** The team's accounts, for resolving a typed scout name to its account. */
	profiles = $state(/** @type {any[]} */ ([]));
	/** The `events` row for this code, or null if none is in reach. */
	event = $state(/** @type {any} */ (null));
	/** Who is on this event (event_scouts), from eventRoster(). */
	roster = $state(/** @type {any[]} */ ([]));
	/** The roster read has answered, either way. */
	rosterReady = $state(false);
	/** Why the roster could not be read; '' when it could. */
	rosterError = $state('');

	/** IndexedDB has answered for this event. */
	localReady = $state(false);
	/** Supabase has answered (or failed) for this event. */
	remoteReady = $state(false);
	/** The assignments read failed; the others fall back to empty quietly. */
	remoteError = $state('');

	/** Quals only — `qualMatches()` on the way in, always. */
	qmList = $derived(this.cached ? qualMatches(this.cached.matches) : []);
	eventEntries = $derived(this.entries.filter((e) => e.eventCode === this.code));
	entryIndex = $derived(buildEntryIndex(this.entries, this.code));
	rollup = $derived(scheduleRollup(this.qmList, this.entryIndex));
	/** Saved assignments in the editor's shape, one row per scout. */
	savedRows = $derived(editorRows(this.assignments));

	#gen = 0;
	#entriesInFlight = false;
	#entriesStale = false;

	/**
	 * Load everything for an event. Safe to call repeatedly; a newer call wins.
	 *
	 * @param {string} eventCode
	 */
	async load(eventCode) {
		const code = String(eventCode ?? '').trim();
		const gen = ++this.#gen;
		this.code = code;
		this.cached = null;
		this.assignments = [];
		this.overrides = [];
		this.reminders = [];
		this.event = null;
		this.roster = [];
		this.rosterReady = false;
		this.rosterError = '';
		this.localReady = false;
		this.remoteReady = false;
		this.remoteError = '';
		if (!code) return;

		const [entries, cached] = await Promise.all([
			listEntries().catch(() => []),
			getCachedSchedule(code).catch(() => null)
		]);
		if (gen !== this.#gen) return;
		this.entries = entries;
		this.cached = cached;
		this.localReady = true;

		// The roster is on a path of its own, not in refreshRemote's Promise.all:
		// it is two requests in a row, and a gym's network that hangs the second
		// must not hold the assignments back with it.
		void this.refreshRoster(gen);
		await this.refreshRemote(gen);
	}

	/**
	 * Who is on the event. Resolves the code to its row first, which is also
	 * where `event` comes from.
	 *
	 * @param {number} [gen]  internal: the load this belongs to
	 */
	async refreshRoster(gen = this.#gen) {
		const code = this.code;
		if (!code) return;
		try {
			const events = auth.signedIn ? await listMyEvents() : [];
			const here = events.find((e) => e.code === code) ?? null;
			const rows = here ? await eventRoster(here.id) : [];
			if (gen !== this.#gen) return;
			this.event = here;
			this.roster = rows;
			this.rosterError = '';
		} catch (e) {
			if (gen !== this.#gen) return;
			this.roster = [];
			this.rosterError = e?.message ?? String(e);
		} finally {
			if (gen === this.#gen) this.rosterReady = true;
		}
	}

	/**
	 * Re-read the Supabase half. Each read stands alone, so one failing leaves
	 * the others on screen.
	 *
	 * @param {number} [gen]  internal: the load this belongs to
	 */
	async refreshRemote(gen = this.#gen) {
		const code = this.code;
		if (!code) return;
		const [profiles, assignments, overrides, reminders] = await Promise.all([
			auth.signedIn ? auth.listProfiles().catch(() => []) : Promise.resolve([]),
			listAssignments(code).then(
				(rows) => ({ rows }),
				(e) => ({ rows: [], error: e?.message ?? String(e) })
			),
			listOverrides(code).catch(() => []),
			listReminders(code).catch(() => [])
		]);
		if (gen !== this.#gen) return;
		this.profiles = profiles;
		this.assignments = assignments.rows;
		this.remoteError = assignments.error ?? '';
		this.overrides = overrides;
		this.reminders = reminders;
		this.remoteReady = true;

		// A manager device with no TBA key adopts the one a teammate published,
		// so re-fetching the schedule just works.
		if (!session.tbaEventKey) {
			const published = await getPublishedTbaEventKey(code).catch(() => null);
			if (published && gen === this.#gen) await session.update({ tbaEventKey: published });
		}
	}

	/**
	 * Re-read entries after sync brings some in. Coalesced: inbound changes
	 * arrive once per ROW, so a cold backfill would otherwise fire hundreds of
	 * reads; one that lands mid-read is remembered so the last write still wins.
	 */
	async refreshEntries() {
		if (this.#entriesInFlight) {
			this.#entriesStale = true;
			return;
		}
		this.#entriesInFlight = true;
		try {
			do {
				this.#entriesStale = false;
				this.entries = await listEntries();
			} while (this.#entriesStale);
		} finally {
			this.#entriesInFlight = false;
		}
	}

	async refreshSchedule() {
		const code = this.code;
		if (!code) return;
		const cached = await getCachedSchedule(code).catch(() => null);
		if (code === this.code) this.cached = cached;
	}

	async refreshAssignments() {
		const code = this.code;
		if (!code) return;
		const rows = await listAssignments(code);
		if (code === this.code) this.assignments = rows;
	}

	async refreshOverrides() {
		const code = this.code;
		if (!code) return;
		const rows = await listOverrides(code).catch(() => []);
		if (code === this.code) this.overrides = rows;
	}

	async refreshReminders() {
		const code = this.code;
		if (!code) return;
		const rows = await listReminders(code).catch(() => []);
		if (code === this.code) this.reminders = rows;
	}
}

export const eventData = new EventData();
