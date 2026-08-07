// Reactive reminder store shared by the banner and the manager-send UI.
//
// Combines three sources into one consumable list:
//   1. Server-pulled (manager-authored) reminders from Supabase
//   2. Auto-generated reminders from the cached schedule + assignments
//   3. Local dismissals (from IndexedDB) to filter both out
//
// Components import `reminders` and read `reminders.visible` reactively.
// Sync layer calls `reminders.pull()` on its throttled tick.

import { session } from './session.svelte.js';
import { auth } from './auth.svelte.js';
import { rowScout, sameScout } from './scout-identity.js';
import {
	listReminders,
	autoReminders,
	getDismissedIds,
	dismissReminder,
	pruneDismissed
} from './reminders.js';
import { getCachedSchedule, qualMatches } from './tba.js';

class RemindersStore {
	/** Manager-authored reminders pulled from Supabase. */
	server = $state(/** @type {any[]} */ ([]));
	/** Set of reminder ids the user has dismissed on this device. */
	dismissed = $state(new Set());
	/** Wallclock — bumped once a minute so auto-banner timing stays fresh. */
	now = $state(new Date());
	/** Qual matches from the cached schedule (refreshed when schedule cache changes). */
	qmList = $state(/** @type {any[]} */ ([]));

	/** Auto-generated banners derived from schedule + scout's assigned teams. */
	get autoList() {
		return autoReminders(this.qmList, session.assignedTeams, this.now, 15);
	}

	/** Everything the banner should currently show, after dismissal + target filtering. */
	get visible() {
		const me = auth.me;
		const out = [];
		// Auto first so banner ordering is "imminent match" at the top, then
		// manager-authored notes.
		for (const r of this.autoList) {
			if (this.dismissed.has(r.id)) continue;
			out.push(r);
		}
		for (const r of this.server) {
			if (this.dismissed.has(r.id)) continue;
			// Broadcast reminders (null scout_name) reach everyone. Targeted
			// ones only show for the matching scout.
			if (r.scout_name || r.profile_id) {
				if (!sameScout(rowScout(r), me)) continue;
			}
			out.push({ ...r, kind: 'manager' });
		}
		return out;
	}

	/** Boot — call once from the layout. */
	async init() {
		await pruneDismissed();
		this.dismissed = await getDismissedIds();
		await this.refreshSchedule();
		if (typeof window !== 'undefined') {
			setInterval(() => (this.now = new Date()), 60_000);
		}
	}

	/** Re-read the local schedule cache (e.g. after a sync pull). */
	async refreshSchedule() {
		const cached = session.eventCode ? await getCachedSchedule(session.eventCode) : null;
		this.qmList = cached ? qualMatches(cached.matches) : [];
	}

	/** Pull server reminders. Called by the sync layer on throttled ticks. */
	async pull() {
		if (!session.eventCode) {
			this.server = [];
			return;
		}
		try {
			this.server = await listReminders(session.eventCode);
		} catch (e) {
			// Don't disturb the rest of the sync tick over reminders.
			console.warn('reminders pull failed', e);
		}
	}

	/** Mark a reminder dismissed locally and persist to IndexedDB. */
	async dismiss(id, expiresAt) {
		await dismissReminder(id, expiresAt);
		const next = new Set(this.dismissed);
		next.add(id);
		this.dismissed = next;
	}
}

export const reminders = new RemindersStore();
