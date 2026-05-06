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
	 * Scout's fixed alliance slot for TBA schedule pre-fill.
	 * One of: "red 1" | "red 2" | "red 3" | "blue 1" | "blue 2" | "blue 3" | ""
	 */
	scoutPosition = $state('');
	/**
	 * TBA v3 read API key — optional. When present, the entry form can
	 * fetch the event schedule and suggest the next match + team to scout.
	 * Get a free key at thebluealliance.com/account.
	 */
	tbaApiKey = $state('');
	loaded = $state(false);

	get isConfigured() {
		return Boolean(this.eventCode && this.scoutName);
	}

	async load() {
		this.eventCode = (await getSetting('eventCode')) ?? '';
		this.scoutName = (await getSetting('scoutName')) ?? '';
		this.scoutPosition = (await getSetting('scoutPosition')) ?? '';
		this.tbaApiKey = (await getSetting('tbaApiKey')) ?? '';
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
		if (patch.scoutPosition !== undefined) {
			this.scoutPosition = patch.scoutPosition;
			await setSetting('scoutPosition', patch.scoutPosition);
		}
		if (patch.tbaApiKey !== undefined) {
			this.tbaApiKey = patch.tbaApiKey;
			await setSetting('tbaApiKey', patch.tbaApiKey);
		}
	}
}

export const session = new Session();
