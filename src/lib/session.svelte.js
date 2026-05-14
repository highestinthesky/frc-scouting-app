// Reactive "who is using the app" state.
//
// Loaded from IndexedDB on first render via session.load(). After that,
// any Svelte component that imports `session` gets reactive access —
// changing session.eventCode somewhere updates every component that
// reads it. Saved back to IndexedDB on every update so it survives
// reloads and offline restarts.

import { getSetting, setSetting } from './db.js';

class Session {
	eventCode = $state('');
	scoutName = $state('');
	/**
	 * Team numbers this scout is assigned to watch for the event.
	 * Populated by the manager from the schedule page and pulled via sync.
	 * Scouts can also add teams locally via `localExtraTeams` if the manager
	 * hasn't assigned them yet.
	 */
	assignedTeams = $state(/** @type {number[]} */ ([]));
	/**
	 * Teams the scout added on their own device. Survives sync pulls — the
	 * server only owns the manager-assigned list. The effective set of teams
	 * the scout is watching is union(assignedTeams, localExtraTeams).
	 */
	localExtraTeams = $state(/** @type {number[]} */ ([]));
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
	loaded = $state(false);

	get isConfigured() {
		return Boolean(this.eventCode && this.scoutName);
	}

	/**
	 * Union of manager-assigned teams and local additions, deduplicated and
	 * sorted ascending. This is the list downstream code (entry form, schedule
	 * UI) should use.
	 */
	get effectiveTeams() {
		const set = new Set();
		for (const t of this.assignedTeams) if (Number.isFinite(t)) set.add(t);
		for (const t of this.localExtraTeams) if (Number.isFinite(t)) set.add(t);
		return [...set].sort((a, b) => a - b);
	}

	async load() {
		this.eventCode = (await getSetting('eventCode')) ?? '';
		this.scoutName = (await getSetting('scoutName')) ?? '';
		const at = await getSetting('assignedTeams');
		this.assignedTeams = Array.isArray(at) ? at.filter(Number.isFinite) : [];
		const le = await getSetting('localExtraTeams');
		this.localExtraTeams = Array.isArray(le) ? le.filter(Number.isFinite) : [];
		this.managerToken = (await getSetting('managerToken')) ?? '';
		this.tbaApiKey = (await getSetting('tbaApiKey')) ?? '';
		// One-time migration cleanup: drop the obsolete pre-assignments setting
		// so it doesn't sit in IndexedDB forever. Safe to remove this line a
		// few months after release.
		const legacyPos = await getSetting('scoutPosition');
		if (legacyPos !== undefined && legacyPos !== null) {
			await setSetting('scoutPosition', null);
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
			const cleaned = (patch.assignedTeams ?? []).filter(Number.isFinite);
			this.assignedTeams = cleaned;
			await setSetting('assignedTeams', cleaned);
		}
		if (patch.localExtraTeams !== undefined) {
			const cleaned = (patch.localExtraTeams ?? []).filter(Number.isFinite);
			this.localExtraTeams = cleaned;
			await setSetting('localExtraTeams', cleaned);
		}
		if (patch.managerToken !== undefined) {
			this.managerToken = patch.managerToken;
			await setSetting('managerToken', patch.managerToken);
		}
		if (patch.tbaApiKey !== undefined) {
			this.tbaApiKey = patch.tbaApiKey;
			await setSetting('tbaApiKey', patch.tbaApiKey);
		}
	}
}

export const session = new Session();
