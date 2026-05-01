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
	loaded = $state(false);

	get isConfigured() {
		return Boolean(this.eventCode && this.scoutName);
	}

	async load() {
		this.eventCode = (await getSetting('eventCode')) ?? '';
		this.scoutName = (await getSetting('scoutName')) ?? '';
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
	}
}

export const session = new Session();
