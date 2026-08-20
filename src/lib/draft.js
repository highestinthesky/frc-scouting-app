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

const keyFor = (eventCode) => `draft:entry:${eventCode || 'none'}`;

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
 * @param {Record<string, {values: object, savedAt: number}>} map
 * @param {number} [now]
 * @returns {Record<string, {values: object, savedAt: number}>}
 */
export function pruneDrafts(map, now = Date.now()) {
	const rows = Object.entries(map ?? {})
		.filter(([, d]) => d && Number.isFinite(d.savedAt) && now - d.savedAt < DRAFT_MAX_AGE_MS)
		.sort((a, b) => b[1].savedAt - a[1].savedAt)
		.slice(0, DRAFT_MAX);
	return Object.fromEntries(rows);
}

/**
 * Read every live draft for an event.
 * @param {string} eventCode
 * @returns {Promise<Record<string, {values: object, savedAt: number}>>}
 */
export async function loadDrafts(eventCode) {
	const stored = await getSetting(keyFor(eventCode));
	return pruneDrafts(stored?.drafts ?? {});
}

/**
 * The draft for one form, or null.
 *
 * @param {string} eventCode
 * @param {string} slot
 * @returns {Promise<{values: object, savedAt: number}|null>}
 */
export async function loadDraft(eventCode, slot) {
	const drafts = await loadDrafts(eventCode);
	return drafts[slot] ?? null;
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
export async function saveDraft(eventCode, slot, values) {
	const drafts = await loadDrafts(eventCode);
	drafts[slot] = { values, savedAt: Date.now() };
	await setSetting(keyFor(eventCode), { drafts: pruneDrafts(drafts) });
}

/**
 * Forget one form's draft. Called on a successful submit, never on cancel — an
 * accidental back press is the case this whole module exists for.
 *
 * @param {string} eventCode
 * @param {string} slot
 */
export async function clearDraft(eventCode, slot) {
	const drafts = await loadDrafts(eventCode);
	if (!(slot in drafts)) return;
	delete drafts[slot];
	await setSetting(keyFor(eventCode), { drafts });
}
