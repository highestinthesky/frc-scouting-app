// What a person was in the middle of, following their account between devices.
//
// Reminder dismissals and entry drafts are kept per account on the device
// (reminders.js, draft.js) and mirrored to two own-rows-only tables (0030).
// This module is the only place that talks to those tables.
//
// ─── best effort, always ───────────────────────────────────────────────────
//
// Nothing here may block recording or throw into a page. Every server call is
// bounded and every failure — no signal, signed out, not on the event, or the
// table not existing because 0030 has not reached this database yet — falls
// back to what the device already holds, which is exactly how both worked
// before they followed the account. The client can therefore ship ahead of
// the migration; 0020 is why that matters.

import { getAuthClient } from './supabase.js';
import { eventIdForCode } from './events.js';
import { loadDraftRecord, saveDraft, clearDraft, DRAFT_MAX_AGE_MS } from './draft.js';
import { getDismissed, setDismissed } from './reminders.js';
import { pickDraft, dismissalsToPush, mergeDismissals } from './account-state-rules.js';

/** A form waits this long for the server's copy before opening with its own. */
const QUICK_MS = 2500;
/** Typing is mirrored at most this often per form. */
const PUSH_DEBOUNCE_MS = 1500;

/** Resolve within `QUICK_MS`, to null if the server is slower than that. */
function quick(promise) {
	return Promise.race([
		Promise.resolve(promise).catch(() => null),
		new Promise((r) => setTimeout(() => r(null), QUICK_MS))
	]);
}

/** The event id and client for an owner, or null when there is no server to ask. */
async function scope(eventCode, owner) {
	if (!owner || !eventCode) return null;
	try {
		const eventId = await eventIdForCode(eventCode);
		return eventId ? { eventId, client: getAuthClient() } : null;
	} catch {
		return null;
	}
}

// ─── drafts ────────────────────────────────────────────────────────────────

/**
 * The draft a form should open with — this device's or the account's newest
 * from another device — or null. A server copy that wins is adopted locally.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {string|null} owner
 * @returns {Promise<{values: object, savedAt: number}|null>}
 */
export async function restoreDraft(eventCode, slot, owner) {
	const local = await loadDraftRecord(eventCode, slot, owner);
	const remote = await quick(fetchRemoteDraft(eventCode, slot, owner));
	const pick = pickDraft(local, remote);
	if (pick?.from === 'remote') {
		await saveDraft(eventCode, slot, pick.values, owner, pick.savedAt);
	} else if (local?.cleared && remote) {
		// The delete made when the entry was saved never arrived. Try again.
		void dropRemoteDraft(eventCode, slot, owner);
	}
	return pick ? { values: pick.values, savedAt: pick.savedAt } : null;
}

const pushTimers = new Map();

/**
 * Keep a form's draft: on this device now, on the server shortly after.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {object} values   already snapshotted — see draft.js
 * @param {string|null} owner
 */
export async function keepDraft(eventCode, slot, values, owner) {
	const savedAt = Date.now();
	await saveDraft(eventCode, slot, values, owner, savedAt);
	if (!owner) return;
	const key = `${owner}|${eventCode}|${slot}`;
	clearTimeout(pushTimers.get(key));
	pushTimers.set(
		key,
		setTimeout(() => {
			pushTimers.delete(key);
			void putRemoteDraft(eventCode, slot, values, savedAt, owner);
		}, PUSH_DEBOUNCE_MS)
	);
}

/**
 * Forget a form's draft once its entry is saved — here, and on the server.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {string|null} owner
 */
export async function forgetDraft(eventCode, slot, owner) {
	const key = `${owner}|${eventCode}|${slot}`;
	clearTimeout(pushTimers.get(key));
	pushTimers.delete(key);
	await clearDraft(eventCode, slot, owner);
	await quick(dropRemoteDraft(eventCode, slot, owner));
}

async function fetchRemoteDraft(eventCode, slot, owner) {
	const s = await scope(eventCode, owner);
	if (!s) return null;
	const { data, error } = await s.client
		.from('entry_drafts')
		.select('payload, saved_at')
		.eq('event_id', s.eventId)
		.eq('slot', slot)
		.maybeSingle();
	if (error || !data) return null;
	const savedAt = Number(data.saved_at);
	// Same age limit as the device applies to its own drafts.
	if (!Number.isFinite(savedAt) || Date.now() - savedAt >= DRAFT_MAX_AGE_MS) return null;
	return { values: data.payload, savedAt };
}

async function putRemoteDraft(eventCode, slot, values, savedAt, owner) {
	try {
		const s = await scope(eventCode, owner);
		if (!s) return;
		await s.client.from('entry_drafts').upsert(
			{ profile_id: owner, event_id: s.eventId, slot, payload: values, saved_at: savedAt },
			{ onConflict: 'profile_id,event_id,slot' }
		);
	} catch {
		/* the device copy stands; the next keystroke tries again */
	}
}

async function dropRemoteDraft(eventCode, slot, owner) {
	try {
		const s = await scope(eventCode, owner);
		if (!s) return;
		await s.client.from('entry_drafts').delete().eq('event_id', s.eventId).eq('slot', slot);
	} catch {
		/* the local tombstone outranks the stale copy; restoreDraft retries */
	}
}

// ─── reminder dismissals ───────────────────────────────────────────────────

/**
 * Send one dismissal now. Best effort: if it does not land, syncDismissals()
 * sends it with the rest on the next pull.
 */
export async function pushDismissal(eventCode, owner, key, expiresAt) {
	try {
		const s = await scope(eventCode, owner);
		if (!s) return;
		await quick(
			s.client.from('reminder_dismissals').upsert(
				{ profile_id: owner, event_id: s.eventId, reminder_key: key, expires_at: expiresAt ?? null },
				{ onConflict: 'profile_id,event_id,reminder_key' }
			)
		);
	} catch {
		/* retried by syncDismissals */
	}
}

/**
 * Two-way: send this device's dismissals the server lacks, fold in the ones
 * made on other devices, and prune what has expired on both sides. Called on
 * the reminders pull.
 *
 * @param {string} eventCode
 * @param {string|null} owner
 * @returns {Promise<boolean>} whether the local set changed
 */
export async function syncDismissals(eventCode, owner) {
	const s = await scope(eventCode, owner);
	if (!s) return false;
	const res = await quick(
		s.client.from('reminder_dismissals').select('reminder_key, expires_at').eq('event_id', s.eventId)
	);
	if (!res || res.error) return false;
	const remote = Object.fromEntries((res.data ?? []).map((r) => [r.reminder_key, r.expires_at]));
	const local = await getDismissed(owner);

	const outgoing = dismissalsToPush(local, remote, eventCode);
	if (outgoing.length > 0) {
		await quick(
			s.client.from('reminder_dismissals').upsert(
				outgoing.map((d) => ({
					profile_id: owner,
					event_id: s.eventId,
					reminder_key: d.key,
					expires_at: d.expiresAt
				})),
				{ onConflict: 'profile_id,event_id,reminder_key' }
			)
		);
	}
	void quick(
		s.client
			.from('reminder_dismissals')
			.delete()
			.eq('event_id', s.eventId)
			.lt('expires_at', new Date().toISOString())
	);

	const merged = mergeDismissals(local, remote, eventCode);
	// Key sets, not counts: dropping one expired dismissal while gaining one from
	// another device leaves the count unchanged.
	const keys = (m) => Object.keys(m).sort().join('\n');
	const changed = keys(merged) !== keys(local);
	if (changed) await setDismissed(owner, merged);
	return changed;
}
