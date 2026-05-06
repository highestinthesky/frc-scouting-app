// Reactive theme state (light / dark / system). Persisted in IndexedDB so
// the choice survives PWA reloads, and applied by setting `data-theme` on
// the document root. Components don't read this directly — they use the
// CSS variables defined in the layout's global stylesheet.

import { getSetting, setSetting } from './db.js';

const VALID = new Set(['system', 'light', 'dark']);

class Theme {
	value = $state('system'); // 'system' | 'light' | 'dark'
	loaded = $state(false);

	async load() {
		const stored = await getSetting('theme');
		this.value = VALID.has(stored) ? stored : 'system';
		this.loaded = true;
	}

	async set(next) {
		if (!VALID.has(next)) return;
		this.value = next;
		await setSetting('theme', next);
	}

	/**
	 * Resolve "system" to the OS-level preference at this moment, returning
	 * either 'light' or 'dark'. Components that need a concrete value use this.
	 */
	resolved() {
		if (this.value === 'light' || this.value === 'dark') return this.value;
		if (typeof window !== 'undefined' && window.matchMedia) {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		return 'light';
	}
}

export const theme = new Theme();
