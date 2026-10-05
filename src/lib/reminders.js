// Reminders. Two flavors share one banner slot in the UI:
//
//   Manager-authored: stored in the `reminders` Supabase table. Manager
//     writes via /schedule UI; scouts pull on each sync tick and see them
//     until they dismiss locally.
//
//   Auto-generated: synthesized client-side from the cached schedule and
//     the scout's assigned teams. When a match is within N minutes of its
//     predicted_time and the scout is watching at least one team in it,
//     emit a synthetic reminder with a stable id so dismissal persists.
//
// Dismissals are kept per account — an object {id → {e: eventCode, x:
// expiresAt-ISO}} in IndexedDB under that account's key — and mirrored to the
// server so they follow the account to its other devices (account-state.js).
// Entries whose expiry has passed are pruned so the map doesn't grow forever.

import { createSupabaseClient } from './supabase.js';
import { eventIdForCode } from './events.js';
import { getSetting, setSetting } from './db.js';
import { reminderTarget } from './planning-rows.js';
import { teamsInMatch } from './tba.js';
import { stillMatters } from './account-state-rules.js';

// Per account. This was one key for the whole device, so the next scout to sign
// in on a shared phone had the last one's dismissals hiding reminders meant for
// them. The old key is left unread: whose dismissals they were is unknowable.
const dismissedKey = (owner) => `dismissedReminders:${owner || 'anon'}`;

// ─── Supabase-backed reminders ─────────────────────────────────────────────

/**
 * Pull all live reminders for an event (server filters by RLS;
 * client filters expired ones).
 *
 * @param {string} eventCode
 * @returns {Promise<Reminder[]>}
 */
export async function listReminders(eventCode) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) return [];
	const sid = await eventIdForCode(code);
	if (!sid) return [];
	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('reminders')
		.select('id, scout_name, profile_id, match_number, message, author, created_at, expires_at')
		.eq('event_id', sid)
		.order('created_at', { ascending: false });
	if (error) throw mapErr(error, 'load reminders');
	const nowIso = new Date().toISOString();
	return (data ?? []).filter((r) => r.expires_at > nowIso);
}

/**
 * Create a new manager-authored reminder.
 *
 * @param {string} eventCode
 * @param {object} opts
 * @param {string} [opts.scoutName]      target scout; omit for broadcast
 * @param {number} [opts.matchNumber]    match this relates to
 * @param {string} opts.message
 * @param {string} [opts.author]
 * @param {string} [opts.expiresAt]      ISO; default = +2h
 * @param {any[]} [opts.roster]    profiles, so a targeted reminder carries an account
 * @returns {Promise<Reminder>}
 */
export async function createReminder(eventCode, opts) {
	const code = (eventCode ?? '').trim().toLowerCase();
	if (!code) throw new Error('No event chosen.');
	if (!opts?.message?.trim()) throw new Error('Reminder message is empty.');
	const sid = await eventIdForCode(code);
	if (!sid) throw new Error('That event is not one you are on.');
	const client = createSupabaseClient(sid);
	const target = reminderTarget(opts.scoutName, opts.roster);
	const row = {
		event_id: sid,
		event_code: code,
		...target,
		match_number: Number.isFinite(opts.matchNumber) ? opts.matchNumber : null,
		message: opts.message.trim(),
		author: opts.author?.trim() || null,
		expires_at:
			opts.expiresAt ??
			new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
	};
	const { data, error } = await client
		.from('reminders')
		.insert(row)
		.select('id, scout_name, profile_id, match_number, message, author, created_at, expires_at')
		.single();
	if (error) throw mapErr(error, 'create reminder');
	return data;
}

/**
 * Delete a reminder (manager-only).
 * @param {string} eventCode
 * @param {string} reminderId
 */
export async function deleteReminder(eventCode, reminderId) {
	const sid = await eventIdForCode(eventCode);
	if (!sid) throw new Error('That event is not one you are on.');
	const client = createSupabaseClient(sid);
	const { error } = await client.from('reminders').delete().eq('id', reminderId);
	if (error) throw mapErr(error, 'delete reminder');
}

// ─── Auto-generated reminders ──────────────────────────────────────────────

/**
 * Synthesize reminders for upcoming matches where one of `assignedTeams`
 * is playing within `leadMinutes` of `now`.
 *
 * The returned objects share the same shape as DB-backed reminders so the
 * banner component can render them uniformly. IDs are deterministic
 * ('auto:q15:1234') so dismissal persists across reloads and ticks.
 *
 * @param {TBAMatch[]} qmList
 * @param {number[]} assignedTeams
 * @param {Date} now
 * @param {number} [leadMinutes=15]
 * @returns {Reminder[]}
 */
export function autoReminders(qmList, assignedTeams, now, leadMinutes = 15) {
	if (!qmList?.length || !assignedTeams?.length) return [];
	const ahead = leadMinutes * 60 * 1000;
	const teamSet = new Set(assignedTeams.filter(Number.isFinite));
	const out = [];
	for (const m of qmList) {
		const t = matchStartMs(m);
		if (!t) continue;
		const dt = t - now.getTime();
		// Show from leadMinutes before until 10 min after start (covers matches
		// that are running late or are currently happening).
		if (dt > ahead || dt < -10 * 60 * 1000) continue;
		const { red, blue } = teamsInMatch(m);
		for (const team of [...red, ...blue]) {
			if (!teamSet.has(team)) continue;
			out.push({
				id: `auto:q${m.match_number}:${team}`,
				kind: 'auto',
				match_number: m.match_number,
				team,
				message:
					dt > 0
						? `Q${m.match_number} (Team ${team}) starts in ${Math.max(1, Math.round(dt / 60_000))} min`
						: `Q${m.match_number} (Team ${team}) is starting now`,
				expires_at: new Date(t + 10 * 60 * 1000).toISOString()
			});
		}
	}
	return out;
}

function matchStartMs(m) {
	const t = m?.actual_time ?? m?.predicted_time ?? m?.time;
	if (!t) return null;
	// TBA times are Unix seconds — multiply if it looks like seconds.
	return t < 1e12 ? t * 1000 : t;
}

// ─── Local dismissal tracking ──────────────────────────────────────────────

/**
 * Every dismissal this account has on this device.
 *
 * @param {string|null} owner  account id, or null signed out
 * @returns {Promise<Record<string, {e?: string|null, x?: string|null}>>}
 */
export async function getDismissed(owner) {
	const raw = await getSetting(dismissedKey(owner));
	return raw && typeof raw === 'object' ? raw : {};
}

/** Replace this account's dismissals on this device. */
export async function setDismissed(owner, map) {
	await setSetting(dismissedKey(owner), map ?? {});
}

/**
 * Mark a reminder dismissed for this account on this device.
 *
 * @param {string} id
 * @param {string} [expiresAt]  optional ISO; used for pruning
 * @param {string|null} [owner]
 * @param {string|null} [eventCode]
 */
export async function dismissReminder(id, expiresAt, owner = null, eventCode = null) {
	const raw = await getDismissed(owner);
	raw[id] = {
		e: eventCode || null,
		x: expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
	};
	await setDismissed(owner, raw);
}

/**
 * Prune dismissal entries whose expires_at is in the past. Cheap to call
 * on app load to keep the map tidy.
 *
 * @param {string|null} [owner]
 */
export async function pruneDismissed(owner = null) {
	const raw = await getDismissed(owner);
	let changed = false;
	for (const [id, d] of Object.entries(raw)) {
		if (!stillMatters(d?.x)) {
			delete raw[id];
			changed = true;
		}
	}
	if (changed) await setDismissed(owner, raw);
}

function mapErr(err, action) {
	const msg = err?.message || String(err);
	if (/row-level security/i.test(msg) || err?.code === '42501') {
		return new Error(
			`Permission denied — couldn't ${action}. You need to be a manager on this event.`
		);
	}
	return new Error(`Couldn't ${action}: ${msg}`);
}
