// Wireless sync layer — pushes local entries up to Supabase and pulls peers'
// entries down. Polling-based (3s tick) rather than realtime, because our
// header-scoped RLS doesn't survive websocket subscription auth without
// minting custom JWTs. 3 seconds is invisible at scouting cadence and keeps
// the security model simple.
//
// Sync scope is the event code typed in Identity. There's no separate session
// UUID. Two devices typing the same event code share data; switching events
// is just changing the event code field. Push and pull are both keyed off
// the current event code, hashed deterministically into the UUID-shaped
// session_id our Postgres schema expects.
//
// IndexedDB stays the source of truth. This module just keeps two ledgers in
// sync: the local Dexie `entries` table and the cloud `entries` row set
// scoped to our event.

import { createSupabaseClient, deriveSessionId } from './supabase.js';
import {
	getOrCreateClientId,
	getUnsyncedEntries,
	markEntrySynced,
	insertRemoteEntry,
	applyRemoteUpdate,
	getEntryByRemoteId
} from './db.js';
import { SCHEMA_VERSION } from './form-config.js';
import { pullScheduleIfStale } from './tba.js';
import { pullAndApplyForScout } from './assignments.js';
import { reminders } from './reminders.svelte.js';
import { session } from './session.svelte.js';
import { entryWritePayloads } from './sync-rules.js';
import { auth } from './auth.svelte.js';

const POLL_INTERVAL_MS = 3000;

// Schedule + assignments change rarely (a few times per event at most), so
// don't burn a Supabase read on every 3-second tick. Once every Nth tick is
// invisible to users but cuts read traffic on those tables ~90%.
const SCHEDULE_POLL_EVERY_N_TICKS = 10; // 10 × 3s = 30s

/**
 * Reactive sync state. Consumers read fields off this inside Svelte
 * components and re-render when they change.
 */
export const syncState = $state({
	status: 'idle', // 'idle' | 'connecting' | 'connected' | 'offline' | 'error'
	pendingCount: 0,
	lastSyncedAt: /** @type {string | null} */ (null),
	error: /** @type {string | null} */ (null),
	/** Lower-cased event code currently scoping pull. */
	eventCode: /** @type {string | null} */ (null),
	/** Derived session_id for the current event. */
	sessionId: /** @type {string | null} */ (null),
	/** Incremented every time a peer's row is inserted locally. Pages watch
	 * this to know when their `entries` view is stale. */
	inboundChanges: 0
});

let timer = null;
let polling = false;
/** ISO of the newest row pulled — pull queries advance from here. Reset
 * whenever the event code changes. */
let lastSeenAt = null;
/** Cached on first call; stable for the device. */
let cachedClientId = null;
/** Tick counter for the schedule/assignments throttle. Starts at the
 *  threshold so the very first tick after (re)connecting checks them once. */
let ticksSinceScheduleCheck = SCHEDULE_POLL_EVERY_N_TICKS;

/**
 * Cache of Supabase clients keyed by session_id. Each unique event we
 * push to gets its own client (because the x-session-id header is set
 * at construction time). Cheap to keep around.
 */
const clientCache = new Map();
function clientFor(sessionId) {
	let c = clientCache.get(sessionId);
	if (!c) {
		c = createSupabaseClient(sessionId);
		clientCache.set(sessionId, c);
	}
	return c;
}

/** Boot the sync layer. Called once from the layout. */
export async function init() {
	cachedClientId = await getOrCreateClientId();
}

/**
 * Set or change the event code scoping the pull side. Called from the
 * layout's effect on session.eventCode. Empty/null pauses sync.
 */
export async function setEventCode(eventCode) {
	const next = typeof eventCode === 'string' ? eventCode.trim().toLowerCase() : '';
	if (next === syncState.eventCode) return; // no-op on identical re-set
	stop();
	syncState.eventCode = next || null;
	if (!next) {
		syncState.sessionId = null;
		syncState.status = 'idle';
		return;
	}
	syncState.sessionId = await deriveSessionId(next);
	syncState.status = navigator.onLine ? 'connecting' : 'offline';
	lastSeenAt = null; // do a full backfill whenever the scope changes
	// New event = check schedule/assignments on the next tick, not 30s from now.
	ticksSinceScheduleCheck = SCHEDULE_POLL_EVERY_N_TICKS;
	if (typeof window !== 'undefined') {
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
	}
	scheduleTick(0);
}

/** Tear down loops and listeners. */
export function stop() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	if (typeof window !== 'undefined') {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
	}
}

/** Force an immediate sync tick — useful after the user adds an entry. */
export function kick() {
	if (syncState.eventCode) scheduleTick(0);
}

/**
 * Force a full re-pull of every entry for the current event code, not just
 * the ones that landed since our last successful tick. Wired to the
 * "Sync now" button in Settings — also useful as a manual escape hatch
 * if the user suspects they're missing data.
 */
export function resync() {
	if (!syncState.eventCode) return;
	lastSeenAt = null;
	// User explicitly asked for a full refresh — include schedule + assignments
	// in that, even if we just polled them.
	ticksSinceScheduleCheck = SCHEDULE_POLL_EVERY_N_TICKS;
	syncState.status = 'connecting';
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
		if (!syncState.eventCode || !syncState.sessionId) return;
		await pushOutbox();
		await pullInbox();
		// Best-effort: keep the cached schedule and this scout's assigned
		// teams in sync with whatever the manager has published. Throttled
		// so we don't burn a Supabase read every 3 seconds on data that
		// changes once an event. Failures here shouldn't take the whole
		// sync tick down, since entries are what actually matter for the
		// scout's flow.
		if (ticksSinceScheduleCheck >= SCHEDULE_POLL_EVERY_N_TICKS) {
			try {
				await pullScheduleAndAssignments();
				ticksSinceScheduleCheck = 0;
			} catch (e) {
				console.warn('schedule/assignments pull failed', e);
				// Don't reset the counter — we'll try again on the next tick
				// rather than waiting another full interval after a transient
				// failure.
				ticksSinceScheduleCheck = SCHEDULE_POLL_EVERY_N_TICKS;
			}
		} else {
			ticksSinceScheduleCheck += 1;
		}
		syncState.status = 'connected';
		syncState.lastSyncedAt = new Date().toISOString();
		syncState.error = null;
	} catch (e) {
		syncState.status = 'error';
		syncState.error = e?.message ?? String(e);
	} finally {
		polling = false;
		if (syncState.eventCode) scheduleTick(POLL_INTERVAL_MS);
	}
}

async function pushOutbox() {
	const unsynced = await getUnsyncedEntries();
	syncState.pendingCount = unsynced.length;
	for (const local of unsynced) {
		// An entry's eventCode field is its source of truth — we push to
		// THAT event's scope, not the user's currently-selected one. This
		// way switching events doesn't strand entries from a previous one.
		const sid = await deriveSessionId(local.eventCode);
		if (!sid) continue;
		const client = clientFor(sid);
		const row = {
			session_id: sid,
			event_code: local.eventCode,
			match_number: local.matchNumber,
			team_number: local.teamNumber,
			alliance_color: local.allianceColor,
			scout_name: local.scoutName,
			observations: local.observations ?? {},
			// Stamp the version the row was actually recorded under. This was
			// hardcoded to 2 and drifted when the counter fields bumped it to 3,
			// so every synced entry claimed to predate metrics it contained.
			// Prefer the entry's own stamp; fall back to the current shape for
			// rows written before db.js started recording one.
			schema_version: local.schemaVersion ?? SCHEMA_VERSION,
			client_id: local.clientId ?? cachedClientId,
			created_at: local.createdAt
		};
		// The authenticated account on the first successful sync owns the
		// server attribution. This is necessarily not always the person who held
		// a shared/offline device when the form was recorded: no signed request
		// happened then, and trusting a stored client claim would be forgeable.
		const payloads = entryWritePayloads(row, auth.profile?.id);

		// A row we've already pushed and since edited takes the UPDATE path.
		// Without this branch the edit never left the device: the cloud row
		// kept its original values and every teammate stayed wrong, while the
		// editor's own screen showed the change saved and synced.
		if (local.remoteId) {
			const result = await pushUpdate(client, local, payloads);
			if (result.clean) {
				await markEntrySynced(local.id, local.remoteId, result.submittedBy);
			}
			continue;
		}

		const { data, error } = await client
			.from('entries')
			.insert(payloads.insert)
			.select('id, submitted_by')
			.single();
		if (error) {
			// Postgres unique_violation — server already has this row (a peer
			// pushed it, or our previous tick raced the round-trip). Adopt the
			// existing remote id and move on.
			if (error.code === '23505') {
				const found = await findRemoteTwin(client, sid, local);
				if (found?.id) {
					await markEntrySynced(local.id, found.id, found.submitted_by);
					continue;
				}
			}
			throw error;
		}
		await markEntrySynced(local.id, data.id, data.submitted_by);
	}
	syncState.pendingCount = 0;
}

/**
 * Push an edit to an existing cloud row. Returns whether the caller should
 * mark it clean plus the server's authoritative attribution.
 *
 * Two cases that must not spin forever, because a row left dirty is retried
 * every 3 seconds for the rest of the event:
 *
 *   - The remote row is gone (someone cleared the event). Fall back to an
 *     INSERT so the entry survives rather than silently evaporating.
 *   - The edit collides with a different existing row on the dedupe key —
 *     the user edited this entry into a duplicate of another. Surface it and
 *     stop retrying; a loop would hide the problem behind a spinner.
 */
async function pushUpdate(client, local, payloads) {
	const { data, error } = await client
		.from('entries')
		.update(payloads.update)
		.eq('id', local.remoteId)
		.select('id, submitted_by');

	if (error) {
		if (error.code === '23505') {
			syncState.error =
				`Q${local.matchNumber} · Team ${local.teamNumber} now matches another entry ` +
				`for the same scout and time, so it can't be saved to the cloud. ` +
				`Change the match or team number, or delete the duplicate.`;
			// Clean, deliberately: retrying cannot succeed, and a permanently
			// dirty row would re-raise this every tick.
			return { clean: true, submittedBy: undefined };
		}
		throw error;
	}

	if (!data || data.length === 0) {
		// No row matched the id. It was deleted server-side; re-insert.
		const { data: ins, error: insErr } = await client
			.from('entries')
			.insert(payloads.insert)
			.select('id, submitted_by')
			.single();
		if (insErr) {
			if (insErr.code === '23505') {
				const twin = await findRemoteTwin(client, payloads.update.session_id, local);
				if (twin?.id) {
					await markEntrySynced(local.id, twin.id, twin.submitted_by);
					return { clean: false, submittedBy: twin.submitted_by };
				}
			}
			throw insErr;
		}
		await markEntrySynced(local.id, ins.id, ins.submitted_by);
		return { clean: false, submittedBy: ins.submitted_by };
	}
	return { clean: true, submittedBy: data[0]?.submitted_by };
}

/** The remote row matching our dedupe key, if the server already has one. */
async function findRemoteTwin(client, sid, local) {
	const { data } = await client
		.from('entries')
		.select('id, submitted_by')
		.eq('session_id', sid)
		.eq('event_code', local.eventCode)
		.eq('match_number', local.matchNumber)
		.eq('team_number', local.teamNumber)
		.eq('scout_name', local.scoutName)
		.eq('created_at', local.createdAt)
		.maybeSingle();
	return data;
}

async function pullInbox() {
	const client = clientFor(syncState.sessionId);
	// Watermark on updated_at, not created_at. created_at never moves, so an
	// edited row sorts below every watermark and is never returned again —
	// a peer's correction would be invisible forever. updated_at is set
	// server-side by a trigger (migration 0007), so it is consistent across
	// devices whose clocks are not.
	let q = client
		.from('entries')
		.select('*')
		.eq('session_id', syncState.sessionId)
		.order('updated_at', { ascending: true });
	if (lastSeenAt) q = q.gt('updated_at', lastSeenAt);
	const { data, error } = await q;
	if (error) throw error;
	for (const remoteRow of data ?? []) {
		const fields = {
			eventCode: remoteRow.event_code,
			matchNumber: remoteRow.match_number,
			teamNumber: remoteRow.team_number,
			allianceColor: remoteRow.alliance_color,
			scoutName: remoteRow.scout_name,
			observations: remoteRow.observations ?? {},
			// Carry the peer's stamp rather than re-deriving it. Their entry
			// may predate a field this device already has.
			schemaVersion: remoteRow.schema_version ?? null,
			createdAt: remoteRow.created_at,
			clientId: remoteRow.client_id,
			submittedBy: remoteRow.submitted_by ?? null
		};

		// Our own writes echo back. Skip them — but only after the watermark
		// advances below, or we would re-fetch them on every tick.
		if (remoteRow.client_id !== cachedClientId) {
			// Do we already hold this row? If so it is an edit, not an arrival.
			const existing = await getEntryByRemoteId(remoteRow.id);
			if (existing) {
				const applied = await applyRemoteUpdate(existing.id, fields);
				if (applied) syncState.inboundChanges += 1;
			} else {
				const { inserted } = await insertRemoteEntry({ remoteId: remoteRow.id, ...fields });
				if (inserted) syncState.inboundChanges += 1;
			}
		}

		if (!lastSeenAt || remoteRow.updated_at > lastSeenAt) {
			lastSeenAt = remoteRow.updated_at;
		}
	}
}

// ─── schedule + assignments pull ────────────────────────────────────────────
//
// Both are cheap reads (one row for the schedule, a handful for assignments)
// and they only matter for scouts. Managers also benefit — they see updates
// from another manager device, and assignments stay consistent when the
// active manager changes between sessions.

async function pullScheduleAndAssignments() {
	const code = syncState.eventCode;
	if (!code) return;
	// Schedule first — the entry form's next-match suggestion depends on it
	// more than the assignment list does (assignments are nice-to-have, the
	// schedule is mandatory for any pre-fill to work).
	const fresh = await pullScheduleIfStale(code);
	if (session.scoutName) {
		await pullAndApplyForScout(code, session.scoutName);
	}
	// Refresh the reminders store too. Server reminders are cheap (small rows,
	// short list). If the schedule was refreshed, also recompute the cached
	// qual matches the auto-banner reads from.
	await reminders.pull();
	if (fresh) await reminders.refreshSchedule();
}
