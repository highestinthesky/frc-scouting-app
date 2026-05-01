// Reactive "what mode is this device in?" state.
//
// Two roles:
//   'scout'   — the default. Records matches, exports a single file.
//   'manager' — imports scout files, sees aggregated entries, re-exports.
//
// The role only changes which UI is shown. Underlying data is the same.

import { getSetting, setSetting } from './db.js';

class Role {
	value = $state('scout');
	loaded = $state(false);

	get isManager() {
		return this.value === 'manager';
	}

	get isScout() {
		return this.value === 'scout';
	}

	async load() {
		const stored = await getSetting('role');
		this.value = stored === 'manager' ? 'manager' : 'scout';
		this.loaded = true;
	}

	async set(newRole) {
		this.value = newRole === 'manager' ? 'manager' : 'scout';
		await setSetting('role', this.value);
	}
}

export const role = new Role();
