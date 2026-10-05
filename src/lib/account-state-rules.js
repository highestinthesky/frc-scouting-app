// Pure decisions for state that follows an account between devices: reminder
// dismissals and entry drafts. No Dexie, no Supabase — so node can test them.
//
// Both are mirrored best-effort (see account-state.js). These rules decide what
// to do when a device's copy and the server's copy disagree, and they are the
// part that loses work or resurrects it when wrong.

/**
 * Which draft a form should open with: this device's, the server's, or none.
 *
 * Newest wins, by the saving device's clock. A local record may be a
 * TOMBSTONE — `cleared: true` — written when the entry was saved: it beats an
 * older server copy (the draft that became the entry, whose delete may not
 * have reached the server) and loses to a newer one (the same form, continued
 * on another device afterwards).
 *
 * @param {{values?: object|null, savedAt: number, cleared?: boolean}|null|undefined} local
 * @param {{values: object, savedAt: number}|null|undefined} remote
 * @returns {{values: object, savedAt: number, from: 'local'|'remote'}|null}
 */
export function pickDraft(local, remote) {
	const l = local && Number.isFinite(local.savedAt) ? local : null;
	const r = remote && Number.isFinite(remote.savedAt) && remote.values ? remote : null;
	if (r && (!l || r.savedAt > l.savedAt)) return { values: r.values, savedAt: r.savedAt, from: 'remote' };
	if (l && !l.cleared && l.values) return { values: l.values, savedAt: l.savedAt, from: 'local' };
	return null;
}

/** A dismissal still matters until its reminder expires. */
export function stillMatters(expiresAt, now = Date.now()) {
	if (!expiresAt) return true;
	const t = Date.parse(expiresAt);
	return !Number.isFinite(t) || t > now;
}

/**
 * Local dismissals for this event the server does not have yet — the ones made
 * offline, or before this account's first sync on this device.
 *
 * @param {Record<string, {e?: string|null, x?: string|null}>} local
 * @param {Record<string, string|null>} remote   reminder_key → expires_at
 * @param {string} eventCode
 * @param {number} [now]
 * @returns {{key: string, expiresAt: string|null}[]}
 */
export function dismissalsToPush(local, remote, eventCode, now = Date.now()) {
	return Object.entries(local ?? {})
		.filter(([key, d]) => d?.e === eventCode && !(key in (remote ?? {})) && stillMatters(d.x, now))
		.map(([key, d]) => ({ key, expiresAt: d.x ?? null }));
}

/**
 * This device's dismissals with the server's for one event folded in. A
 * dismissal is never undone by a merge — the server missing one means it has
 * not been pushed yet, not that the person took it back.
 *
 * @param {Record<string, {e?: string|null, x?: string|null}>} local
 * @param {Record<string, string|null>} remote
 * @param {string} eventCode
 * @param {number} [now]
 */
export function mergeDismissals(local, remote, eventCode, now = Date.now()) {
	const out = {};
	for (const [key, d] of Object.entries(local ?? {})) {
		if (stillMatters(d?.x, now)) out[key] = d;
	}
	for (const [key, x] of Object.entries(remote ?? {})) {
		if (!(key in out) && stillMatters(x, now)) out[key] = { e: eventCode, x: x ?? null };
	}
	return out;
}

/**
 * The ids to hide for one event. A dismissal recorded without an event (none
 * are written that way now) is honoured everywhere rather than dropped.
 *
 * @param {Record<string, {e?: string|null, x?: string|null}>} local
 * @param {string} eventCode
 * @param {number} [now]
 * @returns {Set<string>}
 */
export function dismissedFor(local, eventCode, now = Date.now()) {
	return new Set(
		Object.entries(local ?? {})
			.filter(([, d]) => (!d?.e || d.e === eventCode) && stillMatters(d?.x, now))
			.map(([key]) => key)
	);
}
