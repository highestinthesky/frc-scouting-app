// Wireless sync layer — pushes local entries up to Supabase and pulls peers'
// entries down. Polling-based (3s tick) rather than realtime, because our
// header-scoped RLS doesn't survive websocket subscription auth without
// minting custom JWTs. 3 seconds is invisible at scouting cadence and keeps
// the security model simple.
//
// IndexedDB stays the source of truth. This module just keeps two ledgers in
// sync: the local Dexie `entries` table and the cloud `entries` row set
// scoped to our session.

import { createSupabaseClient, isUuid } from './supabase.js';
import {
	getSessionId,
	getOrCreateClientId,
	getUnsyncedEntries,
	markEntrySynced,
	insertRemoteEntry
} from './db.js';

const POLL_INTERVAL_MS = 3000;

/**
 * Reactive sync state. Consumers (layout indicator, settings page) read
 * fields off this object inside Svelte components and re-render when they
 * change.
 */
export const syncState = $state({
	status: 'idle', // 'idle' | 'connecting' | 'connected' | 'offline' | 'error'
	pendingCount: 0,
	lastSyncedAt: /** @type {string | null} */ (null),
	error: /** @type {string | null} */ (null),
	sessionId: /** @type {string | null} */ (null),
	/** Incremented every time a peer's row is inserted locally. Pages watch
	 * this to know when their `entries` view is stale. */
	inboundChanges: 0
});

let client = null;
let timer = null;
let polling = false;
/** ISO of the newest row we've pulled — pull queries advance from here. */
let lastSeenAt = null;
/** Cached on first call; stable for the device. */
let cachedClientId = null;

/** Boot the sync layer based on persisted state. Called once from the layout. */
export async function init() {
	const sid = await getSessionId();
	syncState.sessionId = sid;
	cachedClientId = await getOrCreateClientId();
	if (sid && isUuid(sid)) await start();
}

/** Begin polling. Idempotent — calling twice is a no-op. */
export async function start() {
	await stop();
	const sid = await getSessionId();
	if (!isUuid(sid)) {
		syncState.status = 'idle';
		syncState.sessionId = null;
		return;
	}
	syncState.sessionId = sid;
	syncState.status = navigator.onLine ? 'connecting' : 'offline';
	client = createSupabaseClient(sid);
	lastSeenAt = null;
	if (typeof window !== 'undefined') {
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
	}
	scheduleTick(0);
}

/** Tear down loops and listeners. */
export async function stop() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	client = null;
	if (typeof window !== 'undefined') {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
	}
}

/** Switch to a different session UUID, restarting the loops. */
export async function changeSession(newSessionId) {
	syncState.sessionId = newSessionId;
	await start();
}

/** Force an immediate sync tick — useful after the user adds an entry. */
export function kick() {
	scheduleTick(0);
}

function onOnline() {
	syncState.status = 'connecting';
	scheduleTick(0);
}

function onOffline() {
	syncState.status = 'offline';
}

function scheduleTick(delay) {
	if (timer) clearTimeout(timer);
	timer = setTimeout(tick, delay);
}

async function tick() {
	if (polling) return;
	polling = true;
	try {
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			syncState.status = 'offline';
			return;
		}
		if (!client || !syncState.sessionId) return;
		await pushOutbox();
		await pullInbox();
		syncState.status = 'connected';
		syncState.lastSyncedAt = new Date().toISOString();
		syncState.error = null;
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e?.message ?? String(e);
	} finally {
		polling = false;
		scheduleTick(POLL_INTERVAL_MS);
	}
}

async function pushOutbox() {
	const unsynced = await getUnsyncedEntries();
	syncState.pendingCount = unsynced.length;
	for (const local of unsynced) {
		const row = {
			session_id: syncState.sessionId,
			event_code: local.eventCode,
			match_number: local.matchNumber,
			team_number: local.teamNumber,
			alliance_color: local.allianceColor,
			scout_name: local.scoutName,
			observations: local.observations ?? {},
			schema_version: 2,
			client_id: local.clientId ?? cachedClientId,
			created_at: local.createdAt
		};
		const { data, error } = await client.from('entries').insert(row).select('id').single();
		if (error) {
			// Postgres unique_violation — the server already has this row (a peer
			// device pushed it via a file round-trip, or our previous tick raced
			// the round-trip). Adopt the existing remote id and move on.
			if (error.code === '23505') {
				const { data: found } = await client
					.from('entries')
					.select('id')
					.eq('session_id', syncState.sessionId)
					.eq('event_code', local.eventCode)
					.eq('match_number', local.matchNumber)
					.eq('team_number', local.teamNumber)
					.eq('scout_name', local.scoutName)
					.eq('created_at', local.createdAt)
					.maybeSingle();
				if (found?.id) {
					await markEntrySynced(local.id, found.id);
					continue;
				}
			}
			throw error;
		}
		await markEntrySynced(local.id, data.id);
	}
	syncState.pendingCount = 0;
}

async function pullInbox() {
	let q = client
		.from('entries')
		.select('*')
		.eq('session_id', syncState.sessionId)
		.order('created_at', { ascending: true });
	if (lastSeenAt) q = q.gt('created_at', lastSeenAt);
	const { data, error } = await q;
	if (error) throw error;
	for (const remoteRow of data ?? []) {
		// Our own writes echo back; insertRemoteEntry's compound-dedupe will
		// skip them, but bypassing the lookup is faster.
		if (remoteRow.client_id !== cachedClientId) {
			const { inserted } = await insertRemoteEntry({
				remoteId: remoteRow.id,
				eventCode: remoteRow.event_code,
				matchNumber: remoteRow.match_number,
				teamNumber: remoteRow.team_number,
				allianceColor: remoteRow.alliance_color,
				scoutName: remoteRow.scout_name,
				observations: remoteRow.observations ?? {},
				createdAt: remoteRow.created_at,
				clientId: remoteRow.client_id
			});
			if (inserted) syncState.inboundChanges += 1;
		}
		if (!lastSeenAt || remoteRow.created_at > lastSeenAt) {
			lastSeenAt = remoteRow.created_at;
		}
	}
}
