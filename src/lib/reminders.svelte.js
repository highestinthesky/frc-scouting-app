// Reactive reminder store shared by the banner and the manager-send UI.
//
// Combines three sources into one consumable list:
//   1. Server-pulled (manager-authored) reminders from Supabase
//   2. Auto-generated reminders from the cached schedule + assignments
//   3. This account's dismissals — kept on the device, mirrored to the server
//      so they follow the account (account-state.js) — to filter both out
//
// Components import `reminders` and read `reminders.visible` reactively.
// Sync layer calls `reminders.pull()` on its throttled tick.

import { session } from './session.svelte.js';
import { auth } from './auth.svelte.js';
import { rowScout, sameScout } from './scout-identity.js';
import {
	listReminders,
	autoReminders,
	getDismissed,
	dismissReminder,
	pruneDismissed
} from './reminders.js';
import { dismissedFor } from './account-state-rules.js';
import { syncDismissals, pushDismissal } from './account-state.js';

/** Whose dismissals apply: the signed-in account, or nobody's ('anon'). */
const owner = () => (auth.signedIn ? (auth.userId ?? null) : null);
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
		await this.loadDismissed();
		await this.refreshSchedule();
		if (typeof window !== 'undefined') {
			setInterval(() => (this.now = new Date()), 60_000);
			// The set that applies changes the moment the account or the event does
			// — not on the next 30-second pull, which would show the last scout's
			// dismissals to the next one in the meantime.
			$effect.root(() => {
				$effect(() => {
					void auth.userId;
					void auth.signedIn;
					void session.eventCode;
					this.loadDismissed();
				});
			});
		}
	}

	/** Read this account's dismissals for this event off the device. */
	async loadDismissed() {
		const who = owner();
		await pruneDismissed(who);
		this.dismissed = dismissedFor(await getDismissed(who), session.eventCode);
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
		// Dismissals made on this account's other devices, and this device's
		// that never reached the server. Best effort; see account-state.js.
		if (await syncDismissals(session.eventCode, owner())) await this.loadDismissed();
	}

	/** Dismiss for this account: on this device now, on its others shortly. */
	async dismiss(id, expiresAt) {
		const who = owner();
		const event = session.eventCode || null;
		// One expiry for both copies. A reminder with none still gets a day, here
		// and on the server — a null there would never be pruned.
		const until = expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		await dismissReminder(id, until, who, event);
		const next = new Set(this.dismissed);
		next.add(id);
		this.dismissed = next;
		void pushDismissal(event, who, id, until);
	}
}

export const reminders = new RemindersStore();
