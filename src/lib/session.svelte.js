// Reactive "who is using the app" state.
//
// Loaded from IndexedDB on first render via session.load(). After that,
// any Svelte component that imports `session` gets reactive access —
// changing session.eventCode somewhere updates every component that
// reads it. Saved back to IndexedDB on every update so it survives
// reloads and offline restarts.

import { getSetting, setSetting } from './db.js';

/** Finite team numbers only, deduplicated, ascending. */
function normaliseTeams(list) {
	if (!Array.isArray(list)) return [];
	return [...new Set(list.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

class Session {
	eventCode = $state('');
	scoutName = $state('');
	/**
	 * Team numbers this scout is assigned to watch for the event. Deduplicated
	 * and sorted ascending. The manager owns this list entirely: they set it on
	 * the schedule page and it arrives here via sync.
	 *
	 * Scouts used to be able to add teams to their own device on top of this.
	 * That was removed — a self-added team was invisible to the manager, so it
	 * never showed up in coverage, auto-assign planned around a roster that
	 * didn't match reality, and two people could sit on the same robot while
	 * another went unwatched. One authoritative list is worth more than the
	 * flexibility was. A scout who needs to record an unassigned team can still
	 * type any team number straight into the entry form.
	 */
	assignedTeams = $state(/** @type {number[]} */ ([]));
	/**
	 * Per-match assignment overrides for the event. Flat list pulled from
	 * Supabase on each sync tick. Shape: {match_number, scout_name, team_number}.
	 * Cached on every device (managers need them all; scouts only consume
	 * rows targeting their name, but the row count is small enough that we
	 * don't filter at cache time).
	 */
	overrides = $state(/** @type {any[]} */ ([]));
	/**
	 * Manager passphrase token — SHA-256 hex of (passphrase + ':' + eventCode).
	 * Sent as `x-manager-token` on writes that hit schedules/assignments.
	 * Only meaningful on devices acting as managers. Stored in plaintext in
	 * IndexedDB because it's already a hash, not the raw passphrase.
	 */
	managerToken = $state('');
	/**
	 * The Blue Alliance v3 read API key. Only used by the manager device that
	 * fetches the schedule and publishes it to Supabase. Scouts never need
	 * this set. Get a free key at thebluealliance.com/account.
	 */
	tbaApiKey = $state('');
	/**
	 * The canonical TBA event key the manager fetches from (e.g. "2027nyny").
	 * Decoupled from `eventCode`, which is the team-chosen sync namespace
	 * (e.g. "2027nyc"). Only the manager device needs this set; it's also
	 * uploaded onto the published schedules row so a second manager device can
	 * re-fetch without retyping. Falls back to `eventCode` when empty.
	 */
	tbaEventKey = $state('');
	loaded = $state(false);

	get isConfigured() {
		return Boolean(this.eventCode && this.scoutName);
	}

	async load() {
		this.eventCode = (await getSetting('eventCode')) ?? '';
		this.scoutName = (await getSetting('scoutName')) ?? '';
		const at = await getSetting('assignedTeams');
		this.assignedTeams = normaliseTeams(at);
		const ov = await getSetting('overrides');
		this.overrides = Array.isArray(ov) ? ov : [];
		this.managerToken = (await getSetting('managerToken')) ?? '';
		this.tbaApiKey = (await getSetting('tbaApiKey')) ?? '';
		this.tbaEventKey = (await getSetting('tbaEventKey')) ?? '';
		// One-time migration cleanup: drop obsolete settings so they don't sit in
		// IndexedDB forever. Safe to remove these a few months after release.
		for (const key of ['scoutPosition', 'localExtraTeams']) {
			const legacy = await getSetting(key);
			if (legacy !== undefined && legacy !== null) await setSetting(key, null);
		}
		this.loaded = true;
	}

	async update(patch) {
		if (patch.eventCode !== undefined) {
			this.eventCode = patch.eventCode;
			await setSetting('eventCode', patch.eventCode);
		}
		if (patch.scoutName !== undefined) {
			this.scoutName = patch.scoutName;
			await setSetting('scoutName', patch.scoutName);
		}
		if (patch.assignedTeams !== undefined) {
			const cleaned = normaliseTeams(patch.assignedTeams);
			this.assignedTeams = cleaned;
			await setSetting('assignedTeams', cleaned);
		}
		if (patch.overrides !== undefined) {
			const cleaned = Array.isArray(patch.overrides) ? patch.overrides : [];
			this.overrides = cleaned;
			await setSetting('overrides', cleaned);
		}
		if (patch.managerToken !== undefined) {
			this.managerToken = patch.managerToken;
			await setSetting('managerToken', patch.managerToken);
		}
		if (patch.tbaApiKey !== undefined) {
			this.tbaApiKey = patch.tbaApiKey;
			await setSetting('tbaApiKey', patch.tbaApiKey);
		}
		if (patch.tbaEventKey !== undefined) {
			this.tbaEventKey = patch.tbaEventKey;
			await setSetting('tbaEventKey', patch.tbaEventKey);
		}
	}
}

export const session = new Session();
