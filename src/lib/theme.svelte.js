// Reactive theme state (light / dark / system). Persisted in IndexedDB so
// the choice survives PWA reloads, and applied by setting `data-theme` on
// the document root. Components don't read this directly — they use the
// CSS variables defined in the layout's global stylesheet.
//
// IndexedDB is the source of truth. A copy also goes to localStorage, which
// exists for exactly one reader: the inline script in app.html, which runs
// before the first paint and cannot await anything. If the two disagree, the
// IndexedDB value wins the moment the layout hydrates — worst case is a single
// frame in the wrong theme, which is what the mirror is there to avoid.

import { getSetting, setSetting } from './db.js';

const VALID = new Set(['system', 'light', 'dark']);

/** Best-effort; private browsing and disabled storage both throw. */
function mirror(value) {
	try {
		localStorage.setItem('theme', value);
	} catch {
		/* the pre-paint script falls back to the OS preference */
	}
}

class Theme {
	value = $state('system'); // 'system' | 'light' | 'dark'
	loaded = $state(false);

	async load() {
		const stored = await getSetting('theme');
		this.value = VALID.has(stored) ? stored : 'system';
		this.loaded = true;
		mirror(this.value);
	}

	async set(next) {
		if (!VALID.has(next)) return;
		this.value = next;
		mirror(next);
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
