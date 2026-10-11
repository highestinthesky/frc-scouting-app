import { getAuthClient } from './supabase.js';
import { getSetting, setSetting } from './db.js';
import { seasonFor, SEASON_YEARS } from './seasons/index.js';
import { DEFAULT_SEASON_SETTINGS, SEASON_CACHE_KEY, normalizeSeasonSettings, seasonIsOpen } from './season-rules.js';

class SeasonSettings {
	value = $state({ ...DEFAULT_SEASON_SETTINGS });
	ready = $state(false);
	error = $state('');
	#owner = null;
	#revision = 0;
	#timer = null;
	#refreshOnReturn = () => {
		if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void this.refresh();
	};

	get open() { return this.ready && seasonIsOpen(this.value, SEASON_YEARS); }
	get game() { return this.value.active_year === 1999 ? null : seasonFor(this.value.active_year); }

	async start(owner) {
		if (!owner) { this.stop(); return; }
		if (this.#owner === owner && this.ready) return;
		this.stop();
		this.#owner = owner;
		const revision = this.#revision;
		const cached = await getSetting(SEASON_CACHE_KEY).catch(() => null);
		if (revision !== this.#revision) return;
		this.value = normalizeSeasonSettings(cached) ?? { ...DEFAULT_SEASON_SETTINGS };
		this.ready = true;
		if (typeof window !== 'undefined') {
			window.addEventListener('online', this.#refreshOnReturn);
			document.addEventListener('visibilitychange', this.#refreshOnReturn);
			this.#timer = setInterval(this.#refreshOnReturn, 30_000);
		}
		await this.refresh();
	}

	stop() {
		this.#revision += 1;
		this.#owner = null;
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', this.#refreshOnReturn);
			document.removeEventListener('visibilitychange', this.#refreshOnReturn);
		}
		this.value = { ...DEFAULT_SEASON_SETTINGS };
		this.ready = false;
		this.error = '';
	}

	async refresh() {
		if (!this.#owner) return;
		const revision = ++this.#revision;
		try {
			const query = getAuthClient().from('season_settings')
				.select('active_year, announced').eq('id', true).single();
			const value = await this.#request(query);
			if (revision !== this.#revision) return;
			this.value = value;
			this.error = '';
			await setSetting(SEASON_CACHE_KEY, value);
		} catch (e) {
			if (revision === this.#revision) this.error = e?.message ?? String(e);
		}
	}

	async update(year) {
		const value = normalizeSeasonSettings({ active_year: Number(year), announced: false });
		if (!value || value.active_year === 1999) throw new Error('Choose a valid season.');
		const revision = ++this.#revision;
		// Announcement is returned by the server, never supplied by this device.
		const query = getAuthClient().from('season_settings').update({ active_year: value.active_year })
			.eq('id', true).select('active_year, announced').single();
		const saved = await this.#request(query);
		if (revision !== this.#revision) throw new Error('The account or season changed. Refresh and try again.');
		this.value = saved;
		this.error = '';
		await setSetting(SEASON_CACHE_KEY, saved);
	}

	async #request(query) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);
		try {
			const { data, error } = await query.abortSignal(controller.signal);
			if (error) throw new Error(`Could not load or save the season: ${error.message}`);
			const value = normalizeSeasonSettings(data);
			if (!value) throw new Error('The shared season setting is unavailable.');
			return value;
		} finally { clearTimeout(timer); }
	}
}

export const seasonSettings = new SeasonSettings();
