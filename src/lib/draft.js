// A half-filled entry form survives leaving the page.
//
// A scout fills in half a match, the phone locks or they tap away to check
// something, and the form comes back blank. On a phone in a gym that is the
// whole observation gone, and it is the kind of loss that stops people trusting
// the app at all.
//
// Storage is the `settings` store in IndexedDB, so this needs no schema bump and
// — more importantly — keeps `db.js` free of `auth.svelte.js`. Recording never
// depends on auth, and a draft is part of recording.
//
// ─── why drafts are keyed, not a single slot ───────────────────────────────
//
// One slot per event loses work in the exact flow this exists to protect: start
// Q3, go back to Home, open Q4, and Q3's draft is gone. So drafts are keyed by
// the match and team the form was OPENED with. That target is fixed for the
// life of the form, unlike the field values, which change as the scout types.
//
// The map is pruned rather than allowed to grow: a form opened and abandoned
// leaves a row behind, and a season of those is a slow leak in a store the app
// reads on every launch.

import { getSetting, setSetting } from './db.js';

/** Drafts older than this are someone else's problem — most likely yesterday's. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Keep the recent few. A scout has one form open; this is slack, not capacity. */
export const DRAFT_MAX = 8;

// ─── whose drafts ──────────────────────────────────────────────────────────
//
// Keyed by account as well as event. The key used to be the event alone, so the
// next scout to sign in on a shared phone reopened the last one's half-typed
// form as their own. `owner` is the account id, or null signed out; the drafts
// also follow the account to its other devices through account-state.js.
const keyFor = (eventCode, owner) => `draft:entry:${eventCode || 'none'}:${owner || 'anon'}`;

/**
 * Which draft a form is. Derived from what the form was opened for, so it stays
 * put while the scout types.
 *
 * @param {{matchNumber?: string|number, teamNumber?: string|number}} target
 * @returns {string}
 */
export function draftSlot(target) {
	const m = String(target?.matchNumber ?? '').trim();
	const t = String(target?.teamNumber ?? '').trim();
	return m || t ? `${m}:${t}` : 'new';
}

/**
 * Has anything actually been typed?
 *
 * Saving an untouched form would resurrect a blank draft forever and, worse,
 * make "you have unsaved work" mean nothing. Compared against the blank the form
 * builds so a field added later needs no change here.
 *
 * @param {Record<string, any>} values
 * @param {Record<string, any>} blank
 * @returns {boolean}
 */
export function hasContent(values, blank) {
	if (!values) return false;
	for (const [k, v] of Object.entries(values)) {
		const empty = blank?.[k];
		if (typeof v === 'boolean') {
			if (v !== Boolean(empty)) return true;
		} else if (String(v ?? '').trim() !== String(empty ?? '').trim()) {
			return true;
		}
	}
	return false;
}

/**
 * Drop what is stale or surplus. Newest kept.
 *
 * Drafts and tombstones are capped separately. Every save writes a tombstone,
 * so under one shared cap a form left open while the scout recorded eight more
 * matches was pushed out by the tombstones of those eight.
 *
 * @param {Record<string, {values: object, savedAt: number}>} map
 * @param {number} [now]
 * @returns {Record<string, {values: object, savedAt: number}>}
 */
export function pruneDrafts(map, now = Date.now()) {
	const rows = Object.entries(map ?? {})
		.filter(([, d]) => d && Number.isFinite(d.savedAt) && now - d.savedAt < DRAFT_MAX_AGE_MS)
		.sort((a, b) => b[1].savedAt - a[1].savedAt);
	const drafts = rows.filter(([, d]) => !d.cleared).slice(0, DRAFT_MAX);
	const tombstones = rows.filter(([, d]) => d.cleared).slice(0, DRAFT_MAX);
	return Object.fromEntries([...drafts, ...tombstones]);
}

/**
 * Read every live draft for an event.
 * @param {string} eventCode
 * @returns {Promise<Record<string, {values: object, savedAt: number}>>}
 */
export async function loadDrafts(eventCode, owner = null) {
	const stored = await getSetting(keyFor(eventCode, owner));
	return pruneDrafts(stored?.drafts ?? {});
}

/**
 * The record for one form — a draft, a tombstone (`cleared: true`, written when
 * its entry was saved), or null. account-state.js needs the tombstone to tell a
 * stale server copy from a newer one.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {string|null} [owner]
 * @returns {Promise<{values: object|null, savedAt: number, cleared?: boolean}|null>}
 */
export async function loadDraftRecord(eventCode, slot, owner = null) {
	const drafts = await loadDrafts(eventCode, owner);
	return drafts[slot] ?? null;
}

/**
 * The draft for one form, or null.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {string|null} [owner]
 * @returns {Promise<{values: object, savedAt: number}|null>}
 */
export async function loadDraft(eventCode, slot, owner = null) {
	const record = await loadDraftRecord(eventCode, slot, owner);
	return record && !record.cleared && record.values ? record : null;
}

/**
 * Write one form's draft.
 *
 * `values` is snapshotted by the caller — a Svelte `$state` proxy handed to
 * IndexedDB throws DataCloneError, which has already cost this codebase a
 * release. See ImportEntries.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {object} values
 */
export async function saveDraft(eventCode, slot, values, owner = null, savedAt = Date.now()) {
	const drafts = await loadDrafts(eventCode, owner);
	drafts[slot] = { values, savedAt };
	await setSetting(keyFor(eventCode, owner), { drafts: pruneDrafts(drafts) });
}

/**
 * Forget one form's draft. Called on a successful submit, never on cancel — an
 * accidental back press is the case this whole module exists for.
 *
 * Leaves a tombstone rather than deleting. The draft also lives on the server,
 * and if deleting it there fails — no signal at the moment of saving — the
 * server's copy would otherwise come back into this form as if unsaved. The
 * tombstone is newer, so it wins (pickDraft), and it ages out like any draft.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @param {string|null} [owner]
 */
export async function clearDraft(eventCode, slot, owner = null) {
	const drafts = await loadDrafts(eventCode, owner);
	drafts[slot] = { values: null, savedAt: Date.now(), cleared: true };
	await setSetting(keyFor(eventCode, owner), { drafts: pruneDrafts(drafts) });
}
