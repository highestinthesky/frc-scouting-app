// Picklist storage: IndexedDB first, Supabase second.
//
// The picklist is a manager surface used at a table with wifi, so it could have
// been cloud-only. It isn't, for one reason: the page has to render instantly
// and keep working while a write is in flight. Alliance selection moves faster
// than a round trip, and a list that greys out between taps is unusable at the
// speed people actually pick.
//
// So every mutation writes locally and returns immediately; the push happens
// after. A failed push leaves the row pending and the next sync tick retries.
//
// Conflict resolution is per team and lives in picklist.js — read the header
// there for why. This file is the plumbing.

import { db } from './db.js';
import { createSupabaseClient } from './supabase.js';
import { eventIdForCode } from './events.js';
import {
	mergeRows,
	ordered,
	needsRebalance,
	rebalance,
	rankBetween,
	deletedElsewhere,
	STEP
} from './picklist.js';

/** @typedef {'pick'|'avoid'} PickStatus */

/**
 * @typedef {object} PickRow
 * @property {string}  key         `${eventCode}:${teamNumber}` — the Dexie primary key
 * @property {string}  eventCode
 * @property {number}  teamNumber
 * @property {PickStatus} status
 * @property {number}  rank
 * @property {string|null} note
 * @property {string}  updatedAt   ISO
 * @property {string|null} pushedAt ISO of the last successful push, or null
 * @property {boolean} deleted     tombstone; see remove()
 */

const keyFor = (eventCode, teamNumber) => `${norm(eventCode)}:${teamNumber}`;
const norm = (code) => String(code ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();

// ─── local reads ───────────────────────────────────────────────────────────

/**
 * Every live row for an event, in display order.
 * @param {string} eventCode
 * @returns {Promise<PickRow[]>}
 */
export async function localRows(eventCode) {
	const code = norm(eventCode);
	if (!code) return [];
	const rows = await db.picklist.where('eventCode').equals(code).toArray();
	return ordered(rows.filter((r) => !r.deleted));
}

/**
 * Rows this device still owes the server, tombstones included — a delete that
 * never reached the server is the one change nobody notices is missing.
 * @param {string} eventCode
 */
export async function localPending(eventCode) {
	const code = norm(eventCode);
	if (!code) return [];
	const rows = await db.picklist.where('eventCode').equals(code).toArray();
	return rows.filter((r) => !r.pushedAt || String(r.updatedAt) > String(r.pushedAt));
}

// ─── local writes ──────────────────────────────────────────────────────────

/**
 * Create or update one team's row. Local only; call `push` to send it.
 *
 * @param {string} eventCode
 * @param {number} teamNumber
 * @param {Partial<Pick<PickRow, 'status'|'rank'|'note'>>} patch
 * @returns {Promise<PickRow>}
 */
export async function put(eventCode, teamNumber, patch) {
	const code = norm(eventCode);
	const key = keyFor(code, teamNumber);
	const existing = await db.picklist.get(key);
	const row = {
		key,
		eventCode: code,
		teamNumber: Number(teamNumber),
		status: patch.status ?? existing?.status ?? 'pick',
		rank: patch.rank ?? existing?.rank ?? STEP,
		note: patch.note ?? existing?.note ?? null,
		updatedAt: now(),
		pushedAt: existing?.pushedAt ?? null,
		deleted: false
	};
	await db.picklist.put(row);
	return row;
}

/**
 * Remove a team from the list.
 *
 * Written as a tombstone rather than a `delete`, because a hard delete on a
 * device that is offline is indistinguishable from a row that never existed —
 * the next pull would helpfully restore it from the server, and the manager
 * would watch a team they removed come back. The tombstone is cleared once the
 * server has confirmed the delete.
 *
 * @param {string} eventCode
 * @param {number} teamNumber
 */
export async function remove(eventCode, teamNumber) {
	const key = keyFor(eventCode, teamNumber);
	const existing = await db.picklist.get(key);
	if (!existing) return;
	await db.picklist.put({ ...existing, deleted: true, updatedAt: now() });
}

/** Wipe an event's list locally, tombstoning every row so the wipe propagates. */
export async function clearAll(eventCode) {
	const rows = await db.picklist.where('eventCode').equals(norm(eventCode)).toArray();
	const stamp = now();
	await db.picklist.bulkPut(rows.map((r) => ({ ...r, deleted: true, updatedAt: stamp })));
}

// ─── weights ───────────────────────────────────────────────────────────────

// Metric weights are the one part of the picklist where a whole-document
// last-write-wins is right: a weight set is only meaningful together, and two
// managers do not edit sliders simultaneously the way they edit the list.
// Shared anyway, because "what are we optimising for" is a decision the
// strategy table makes once and everyone should be looking at.

const weightsKey = (eventCode) => `picklist:weights:${norm(eventCode)}`;

export async function localWeights(eventCode) {
	const rec = await db.settings.get(weightsKey(eventCode));
	return rec?.value ?? null;
}

export async function putWeights(eventCode, weights) {
	await db.settings.put({
		key: weightsKey(eventCode),
		value: { weights, updatedAt: now(), pushed: false }
	});
}

/**
 * Push local weights if they are newer, pull the server's if they are.
 *
 * Returns the winning set, or null when there is nothing anywhere.
 *
 * @param {string} eventCode
 * @param {object} opts
 * @param {string} [opts.updatedBy]
 * @returns {Promise<{weights: object, updatedAt: string}|null>}
 */
export async function syncWeights(eventCode, opts = {}) {
	const code = norm(eventCode);
	const sid = await eventIdForCode(code);
	if (!sid) return null;

	const mine = await localWeights(code);

	let remote = null;
	try {
		const client = createSupabaseClient(sid);
		const { data, error } = await client
			.from('picklist_prefs')
			.select('weights, updated_at')
			.eq('session_id', sid)
			.maybeSingle();
		// A missing table means migration 0009 is not applied. Weights stay
		// local rather than the page erroring; the list is the important part.
		if (!error && data) remote = { weights: data.weights, updatedAt: data.updated_at };
	} catch {
		return mine;
	}

	if (remote && (!mine || String(remote.updatedAt) > String(mine.updatedAt))) {
		await db.settings.put({
			key: weightsKey(code),
			value: { ...remote, pushed: true }
		});
		return remote;
	}

	if (mine && !mine.pushed) {
		try {
			const client = createSupabaseClient(sid);
			const { error } = await client.from('picklist_prefs').upsert(
				{
					session_id: sid,
					// Same uuid, both columns — see the expand note in sync.svelte.js.
					event_id: sid,
					event_code: code,
					weights: mine.weights,
					updated_by: opts.updatedBy ?? null
				},
				{ onConflict: 'session_id' }
			);
			if (!error) await db.settings.put({ key: weightsKey(code), value: { ...mine, pushed: true } });
		} catch {
			// Retried on the next tick.
		}
	}

	return mine;
}

// ─── sync ──────────────────────────────────────────────────────────────────

/**
 * Pull the server's rows, merge them over local, and write the result back.
 *
 * Returns true when anything changed locally, so callers can decide whether to
 * re-render rather than re-rendering on a timer.
 *
 * @param {string} eventCode
 * @returns {Promise<boolean>}
 */
export async function pull(eventCode) {
	const code = norm(eventCode);
	const sid = await eventIdForCode(code);
	if (!sid) return false;

	const client = createSupabaseClient(sid);
	const { data, error } = await client
		.from('picklist')
		.select('team_number, status, rank, note, updated_at')
		.eq('session_id', sid);
	if (error) throw error;

	const remote = (data ?? []).map((r) => ({
		key: keyFor(code, r.team_number),
		eventCode: code,
		teamNumber: r.team_number,
		status: r.status,
		rank: Number(r.rank),
		note: r.note ?? null,
		updatedAt: r.updated_at,
		// A row that came from the server is, by definition, on the server.
		pushedAt: r.updated_at,
		deleted: false
	}));

	const before = await db.picklist.where('eventCode').equals(code).toArray();

	// Rows another manager removed. The rule for which of those this device
	// should drop lives in picklist.js, where it is testable.
	const stamp = now();
	const gone = deletedElsewhere(before, remote.map((r) => r.teamNumber)).map((r) => ({
		...r,
		deleted: true,
		updatedAt: stamp,
		pushedAt: stamp
	}));

	const merged = mergeRows([...before, ...gone], remote);
	if (!changed(before, merged)) return false;
	await db.picklist.bulkPut(merged);
	return true;
}

/**
 * Send everything this device owes the server.
 *
 * Manager-gated, so it needs the token. Without one the write is refused by
 * RLS and the rows simply stay pending — which is the right outcome: a scout
 * device should not be able to reorder the picklist, and should not lose its
 * local view either.
 *
 * @param {string} eventCode
 * @param {object} opts
 * @param {string} [opts.updatedBy]
 * @returns {Promise<number>} rows pushed
 */
export async function push(eventCode, { updatedBy } = {}) {
	const code = norm(eventCode);
	const sid = await eventIdForCode(code);
	if (!sid) return 0;

	const pending = await localPending(code);
	if (pending.length === 0) return 0;

	const client = createSupabaseClient(sid);
	const stamp = now();
	let sent = 0;

	const tombstones = pending.filter((r) => r.deleted);
	const live = pending.filter((r) => !r.deleted);

	if (tombstones.length > 0) {
		const { error } = await client
			.from('picklist')
			.delete()
			.eq('session_id', sid)
			.in('team_number', tombstones.map((r) => r.teamNumber));
		if (error) throw error;
		// Confirmed gone on the server, so the tombstone has done its job.
		await db.picklist.bulkDelete(tombstones.map((r) => r.key));
		sent += tombstones.length;
	}

	if (live.length > 0) {
		const { error } = await client.from('picklist').upsert(
			live.map((r) => ({
				session_id: sid,
				// Same uuid, both columns — see the expand note in sync.svelte.js.
				event_id: sid,
				event_code: code,
				team_number: r.teamNumber,
				status: r.status,
				rank: r.rank,
				note: r.note,
				updated_by: updatedBy ?? null
			})),
			{ onConflict: 'session_id,team_number' }
		);
		if (error) throw error;
		await db.picklist.bulkPut(live.map((r) => ({ ...r, pushedAt: stamp })));
		sent += live.length;
	}

	return sent;
}

/**
 * Push then pull, in that order.
 *
 * Order matters. Pulling first would merge the server's older copy of a row
 * this device just edited, and — because a tie on the timestamp goes to the
 * server — could discard the local edit before it was ever sent.
 *
 * A push failure does not abort the pull, and does not throw. The rows stay
 * pending and the next call retries them. What it DOES do is report `pending`,
 * so the page can say "3 changes not saved yet" instead of either lying about
 * success or throwing an error banner every three seconds at a manager whose
 * wifi is merely slow.
 *
 * @param {string} eventCode
 * @param {object} opts
 * @param {string} [opts.updatedBy]
 * @returns {Promise<{changed: boolean, pending: number, error: string}>}
 */
export async function sync(eventCode, opts = {}) {
	let error = '';

	{
		try {
			await push(eventCode, opts);
		} catch (e) {
			error = e?.message ?? 'push failed';
		}
	}

	let changed = false;
	try {
		changed = await pull(eventCode);
	} catch (e) {
		if (!error) error = e?.message ?? 'pull failed';
	}

	// Weights ride the same call so the page has one thing to invoke. Their
	// change has to be reported too — the page re-reads only when told
	// something moved, and a weight set pulled from a colleague that nothing
	// re-reads is a weight set nobody sees.
	const weightsBefore = (await localWeights(eventCode))?.updatedAt ?? '';
	await syncWeights(eventCode, opts);
	const weightsAfter = (await localWeights(eventCode))?.updatedAt ?? '';

	return {
		changed: changed || weightsBefore !== weightsAfter,
		pending: (await localPending(eventCode)).length,
		error
	};
}

// ─── rank maintenance ──────────────────────────────────────────────────────

/**
 * Renumber an event's list if repeated midpoint inserts have collapsed the
 * gaps. Returns the number of rows rewritten.
 *
 * Called on load rather than on every move: a rebalance touches every row, so
 * doing it while someone is dragging would be the one write pattern this whole
 * design avoids.
 *
 * PER STATUS. The pick list and the do-not-pick list are ranked independently
 * — nothing orders one against the other — so a pick at rank 1024 sitting
 * beside an avoid at rank 1024 is normal, not a collapsed gap. Checking them
 * together reads that as exhausted precision and rewrites every row in the
 * event, on every single load, marking them all pending and pushing all of
 * them. Which is precisely the whole-list write this design exists to avoid,
 * arrived at from the other direction.
 *
 * @param {string} eventCode
 */
export async function rebalanceIfNeeded(eventCode) {
	const rows = await localRows(eventCode);
	if (rows.length === 0) return 0;

	const stamp = now();
	const fixed = [];
	for (const status of ['pick', 'avoid']) {
		const group = rows.filter((r) => r.status === status);
		if (group.length === 0 || !needsRebalance(group)) continue;
		fixed.push(...rebalance(group).map((r) => ({ ...r, updatedAt: stamp })));
	}

	if (fixed.length === 0) return 0;
	await db.picklist.bulkPut(fixed);
	return fixed.length;
}

/** Rank that appends a team to the end of the current pick list. */
export function appendRank(rows) {
	const list = ordered(rows.filter((r) => r.status === 'pick'));
	return rankBetween(list.length ? list[list.length - 1].rank : null, null);
}

// ─── migration from the old single-blob storage ────────────────────────────

/**
 * Convert the pre-sync `picklist:<event>` setting into rows.
 *
 * Runs once per event, guarded by a marker so a manager who has already
 * migrated and then deleted teams does not get them resurrected on the next
 * load. Idempotent by construction: it writes rows only when there are none.
 *
 * @param {string} eventCode
 * @returns {Promise<number>} rows created
 */
export async function migrateLegacy(eventCode) {
	const code = norm(eventCode);
	if (!code) return 0;

	const marker = `picklist:migrated:${code}`;
	if ((await db.settings.get(marker))?.value) return 0;

	const legacy = (await db.settings.get(`picklist:${code}`))?.value;
	await db.settings.put({ key: marker, value: true });
	if (!legacy || typeof legacy !== 'object') return 0;

	const existing = await db.picklist.where('eventCode').equals(code).count();
	if (existing > 0) return 0;

	const stamp = now();
	const rows = [];
	(legacy.primary ?? []).forEach((teamNumber, i) => {
		rows.push({
			key: keyFor(code, teamNumber),
			eventCode: code,
			teamNumber,
			status: 'pick',
			rank: (i + 1) * STEP,
			note: null,
			updatedAt: stamp,
			pushedAt: null,
			deleted: false
		});
	});
	(legacy.doNotPick ?? []).forEach((teamNumber, i) => {
		rows.push({
			key: keyFor(code, teamNumber),
			eventCode: code,
			teamNumber,
			status: 'avoid',
			rank: (i + 1) * STEP,
			note: null,
			updatedAt: stamp,
			pushedAt: null,
			deleted: false
		});
	});
	if (legacy.weights) await putWeights(code, legacy.weights);
	if (rows.length > 0) await db.picklist.bulkPut(rows);
	return rows.length;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function changed(before, after) {
	if (before.length !== after.length) return true;
	const byKey = new Map(before.map((r) => [r.key, r]));
	return after.some((r) => {
		const b = byKey.get(r.key);
		return (
			!b ||
			b.rank !== r.rank ||
			b.status !== r.status ||
			b.note !== r.note ||
			b.deleted !== r.deleted ||
			b.updatedAt !== r.updatedAt
		);
	});
}
