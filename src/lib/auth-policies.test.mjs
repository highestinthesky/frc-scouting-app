// Static regression tests for the auth-policy migrations.
//   node src/lib/auth-policies.test.mjs
//
// Parsing proves that the SQL is grammatical; it does not prove that a policy
// has the boundary its name claims. These checks inspect the emitted policy
// clauses and the profile guard trigger so a permissive `USING (true)`, a
// missing event scope, or a mutable role cannot quietly survive review.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migration = (name) =>
	readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8');

// Comments deliberately quote unsafe forms. Remove them before every search so
// documentation cannot make a missing guard look implemented.
const uncomment = (sql) =>
	sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n\r]*/g, '');
const compact = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

const auth = uncomment(migration('0008_auth.sql'));
const identity = uncomment(migration('0010_identity.sql'));
// The cutover was 0011 for most of this project's life. 0011 never reached
// production, was superseded by 0019's membership model, and left migrations/
// the way 0013 did — so these checks now read the migrations that ARE the
// cutover. Concatenated because it landed in two halves: 0019 expanded (events,
// membership, the new policies) and 0020 contracted (session_id, the legacy
// policies, the passphrase).
const cutover = uncomment(migration('0019_events.sql')) + '\n' + uncomment(migration('0020_contract.sql'));

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
	if (condition) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? '\n        ' + detail : ''}`);
	}
};

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function functionBodies(sql, name) {
	const re = new RegExp(
		`create\\s+or\\s+replace\\s+function\\s+public\\.${escapeRe(name)}` +
			`\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`,
		'gi'
	);
	return [...sql.matchAll(re)].map((match) => match[1]);
}

function policies(sql) {
	const re = /\bcreate\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)([\s\S]*?);/gi;
	return [...sql.matchAll(re)].map((match) => ({
		name: match[1].toLowerCase(),
		table: match[2].toLowerCase(),
		source: match[0]
	}));
}

// Read a parenthesised USING/WITH CHECK expression without being confused by
// the nested parentheses in helper calls.
function clauseExpressions(source, phrase) {
	const lower = source.toLowerCase();
	const phraseRe = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\s*\\(`, 'gi');
	const expressions = [];
	for (const match of lower.matchAll(phraseRe)) {
		const open = lower.indexOf('(', match.index);
		let depth = 0;
		let quote = false;
		for (let i = open; i < source.length; i += 1) {
			const char = source[i];
			if (char === "'" && source[i - 1] !== '\\') quote = !quote;
			if (quote) continue;
			if (char === '(') depth += 1;
			if (char !== ')') continue;
			depth -= 1;
			if (depth === 0) {
				expressions.push(source.slice(open + 1, i));
				break;
			}
		}
	}
	return expressions;
}

const commandOf = (policy) =>
	/\bfor\s+(select|insert|update|delete|all)\b/i.exec(policy.source)?.[1]?.toLowerCase();

function requiredClauses(policy) {
	const command = commandOf(policy);
	const kinds =
		command === 'insert'
			? ['with check']
			: command === 'update' || command === 'all'
				? ['using', 'with check']
				: ['using'];
	return kinds.flatMap((kind) =>
		clauseExpressions(policy.source, kind).map((expression) => ({
			policy: policy.name,
			kind,
			expression
		}))
	);
}

// Membership used to mean "has a profile at all" — app_role() IS NOT NULL —
// with event scope carried separately by the session header. 0019 merged the
// two: is_event_member(event_id) and manages_event(event_id) each answer "this
// person, this event" in one call, which is why the scope check below looks for
// the argument rather than for a second clause.
// Two different questions, and conflating them once already made the roster
// check assert the wrong thing:
//   hasProfile     — is this person on the team at all (0008's roster policy)
//   hasMembership  — is this person on THIS event (0019's event-data policies)
const hasProfile = (expression) =>
	/public\.app_role\s*\(\s*\)\s+is\s+not\s+null/i.test(expression);
const hasMembership = (expression) =>
	/public\.(is_event_member|manages_event)\s*\(/i.test(expression);
const hasSessionScope = (expression) =>
	/public\.(is_event_member|manages_event)\s*\(\s*event_id\s*\)/i.test(expression);

// ─── 0008: a profile cannot award privileges to itself or another manager ─

const profileTrigger = /\bcreate\s+(?:or\s+replace\s+)?trigger\s+[a-z_][a-z0-9_]*\s+before\s+update(?:\s+of\s+[a-z0-9_,\s]+)?\s+on\s+public\.profiles[\s\S]*?execute\s+function\s+public\.([a-z_][a-z0-9_]*)\s*\(\s*\)\s*;/i.exec(
	auth
);
ok(
	'0008 installs a BEFORE UPDATE profile guard trigger',
	Boolean(profileTrigger),
	'RLS chooses rows, not columns; role and username changes need a server-side guard.'
);

const guardBody = profileTrigger
	? functionBodies(auth, profileTrigger[1]).at(-1) ?? ''
	: '';
const roleChange =
	/(?:new\.role\s+is\s+distinct\s+from\s+old\.role|old\.role\s+is\s+distinct\s+from\s+new\.role)/i;

ok(
	'0008 makes profile ids immutable',
	/if\s+(?:new\.id\s+is\s+distinct\s+from\s+old\.id|old\.id\s+is\s+distinct\s+from\s+new\.id)\s+then\s+raise\s+exception/i.test(
		guardBody
	),
	'changing the primary-key identity would bypass ownership checks'
);
ok(
	'0008 makes usernames immutable',
	/if\s+(?:new\.username\s+is\s+distinct\s+from\s+old\.username|old\.username\s+is\s+distinct\s+from\s+new\.username)\s+then\s+raise\s+exception/i.test(
		guardBody
	),
	'the profile trigger must reject a NEW.username/OLD.username difference'
);
ok(
	'0008 prevents a user from changing their own role',
	roleChange.test(guardBody) &&
		/if\s+(?:old\.id\s*=\s*auth\.uid\s*\(\s*\)|auth\.uid\s*\(\s*\)\s*=\s*old\.id)\s+then\s+raise\s+exception/i.test(
			guardBody
		),
	'the profile trigger must reject a role change when auth.uid() owns the row'
);
ok(
	'0008 reserves transitions to or from super for a super user',
	roleChange.test(guardBody) &&
		/if\s+\([^)]*old\.role\s*=\s*'super'[^)]*or[^)]*new\.role\s*=\s*'super'[^)]*\)\s+and\s+not\s+public\.is_super\s*\(\s*\)\s+then\s+raise\s+exception/i.test(
			guardBody
		),
	'a manager must not be able to promote a scout to super or edit an existing super'
);

const authPolicies = policies(auth);
const managerUpdate = authPolicies.find((policy) => policy.name === 'profiles_manager_update');
const managerClauses = managerUpdate ? requiredClauses(managerUpdate) : [];
ok('0008 defines profiles_manager_update', Boolean(managerUpdate));
ok(
	'0008 gates both sides of a manager update against super rows',
	managerClauses.length === 2 &&
		managerClauses.every(
			({ expression }) =>
				/public\.is_super\s*\(\s*\)/i.test(expression) &&
				/role\s*(?:<>|!=)\s*'super'/i.test(expression)
		),
	'manager UPDATE needs the super guard in both USING (old row) and WITH CHECK (new row)'
);

const profilesRead = authPolicies.find((policy) => policy.name === 'profiles_read');
ok(
	'0008 exposes the roster only to users with a profile',
	Boolean(profilesRead) && clauseExpressions(profilesRead.source, 'using').every(hasProfile)
);

// ─── 0011: auth membership and event scope are independent boundaries ─────

const eventTables = new Set([
	'entries',
	'schedules',
	'assignments',
	'assignment_overrides',
	'reminders',
	'picklist',
	'picklist_prefs',
	'event_meta'
]);
const eventPolicies = policies(cutover).filter((policy) => eventTables.has(policy.table));
const tablesWithoutPolicies = [...eventTables].filter(
	(table) => !eventPolicies.some((policy) => policy.table === table)
);
ok(
	'the cutover replaces policies on every event-data table',
	tablesWithoutPolicies.length === 0,
	tablesWithoutPolicies.join(', ')
);

const tablesWithoutRls = [...eventTables].filter(
	(table) =>
		!new RegExp(
			`alter\\s+table\\s+public\\.${escapeRe(table)}\\s+enable\\s+row\\s+level\\s+security\\s*;`,
			'i'
		).test(cutover)
);
ok(
	'the cutover enables RLS on every event-data table',
	tablesWithoutRls.length === 0,
	tablesWithoutRls.join(', ')
);

const missingClauses = [];
const conditions = [];
for (const policy of eventPolicies) {
	const command = commandOf(policy);
	const expected =
		command === 'insert'
			? ['with check']
			: command === 'update' || command === 'all'
				? ['using', 'with check']
				: ['using'];
	for (const kind of expected) {
		const found = clauseExpressions(policy.source, kind);
		if (found.length === 0) missingClauses.push(`${policy.name}:${kind}`);
		for (const expression of found) conditions.push({ policy: policy.name, kind, expression });
	}
}
ok(
	'the cutover gives each operation every required RLS clause',
	missingClauses.length === 0,
	missingClauses.join(', ')
);

const withoutMembership = conditions
	.filter(({ expression }) => !hasMembership(expression))
	.map(({ policy, kind }) => `${policy}:${kind}`);
ok(
	'the cutover requires event membership in every event-data policy clause',
	withoutMembership.length === 0,
	withoutMembership.join(', ')
);

const withoutScope = conditions
	.filter(({ expression }) => !hasSessionScope(expression))
	.map(({ policy, kind }) => `${policy}:${kind}`);
ok(
	'the cutover scopes every membership check to the row\'s own event',
	withoutScope.length === 0,
	withoutScope.join(', ')
);

const wrongPolicyRole = eventPolicies
	.filter(
		(policy) =>
			!/\bto\s+authenticated\b/i.test(policy.source) ||
			/\bto\s+[^;]*\banon\b/i.test(policy.source)
	)
	.map((policy) => policy.name);
ok(
	'the cutover exposes event-data policies only to authenticated callers',
	wrongPolicyRole.length === 0,
	wrongPolicyRole.join(', ')
);

const managerMutations = eventPolicies.filter(
	(policy) => policy.table !== 'entries' && commandOf(policy) !== 'select'
);
const managerClausesMissingRole = managerMutations.flatMap((policy) =>
	requiredClauses(policy)
		.filter(({ expression }) => !/public\.manages_event\s*\(/i.test(expression))
		.map(({ kind }) => `${policy.name}:${kind}`)
);
ok(
	'the cutover requires manages_event in every planning-data mutation clause',
	managerClausesMissingRole.length === 0,
	managerClausesMissingRole.join(', ')
);

// Attribution is stamped by a BEFORE INSERT trigger rather than asserted in the
// policy. The policy clause alone permitted a NULL — a signed-in client that
// omitted the column produced an unattributed row — and "an immutable account id
// stamped server-side" is the model. Both are asserted: the trigger sets it, the
// policy still refuses a forgery if the trigger were ever removed.
const stampBody = functionBodies(cutover, 'stamp_submitted_by').at(-1) ?? '';
ok(
	'the cutover stamps attribution from the token on INSERT',
	/new\.submitted_by\s*:=\s*\(?\s*select\s+auth\.uid\s*\(\s*\)/i.test(stampBody),
	stampBody ? 'trigger exists but does not set submitted_by from auth.uid()' : 'no trigger'
);
ok(
	'and installs it BEFORE INSERT only',
	/\bbefore\s+insert\s+on\s+public\.entries\b/i.test(cutover) &&
		!/\bbefore\s+(insert\s+or\s+)?update[^;]*on\s+public\.entries\b/i.test(cutover),
	'a BEFORE UPDATE trigger would undo ON DELETE SET NULL and break revoking a scout with entries'
);
const entriesInsert = eventPolicies.find((policy) => policy.name === 'entries_evt_insert');
ok(
	'and the policy still refuses a forged submitter',
	Boolean(entriesInsert) &&
		clauseExpressions(entriesInsert.source, 'with check').some((expression) =>
			/submitted_by\s*=\s*\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)/i.test(expression)
		)
);

const broadUsing = eventPolicies.flatMap((policy) =>
	clauseExpressions(policy.source, 'using')
		.filter((expression) => compact(expression) === 'true')
		.map(() => policy.name)
);
ok(
	'the cutover leaves no USING (true) event-data policy',
	broadUsing.length === 0,
	broadUsing.join(', ')
);

// Attribution is set by the database on INSERT and is the original submitter,
// not a client-editable "last changed by" field on UPDATE.
//
// An earlier draft enforced that with a BEFORE UPDATE trigger pinning
// NEW.submitted_by := OLD.submitted_by. That is wrong, and wrong in a way that
// only shows up months later: entries.submitted_by carries ON DELETE SET NULL,
// so revoking a profile makes Postgres issue an internal UPDATE setting the
// column to null — which the trigger would undo, breaking the referential
// action. Revoking anyone with historical entries would start failing.
//
// Column-level privilege is the right instrument. It is checked before a
// trigger ever runs, it cannot be reasoned around, and referential actions run
// as the table owner rather than as `authenticated`, so ON DELETE SET NULL
// still works. These assertions pin the mechanism that is actually there.
const entriesUpdateGrant =
	/\bgrant\s+update\s*\(([^)]*)\)\s*on\s+public\.entries\b/i.exec(cutover);
const grantedUpdateColumns = new Set(
	(entriesUpdateGrant?.[1] ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
);

ok(
	'the cutover grants entry UPDATE per column, not wholesale',
	grantedUpdateColumns.size > 0,
	'a bare GRANT UPDATE lets a crafted correction rewrite any column, attribution included'
);
ok(
	'the cutover withholds submitted_by from the entry UPDATE grant',
	grantedUpdateColumns.size > 0 && !grantedUpdateColumns.has('submitted_by'),
	'a crafted correction must not forge or clear the original submitter'
);
ok(
	'the cutover revokes UPDATE (submitted_by) explicitly as well',
	/\brevoke\s+update\s*\(\s*submitted_by\s*\)\s*on\s+public\.entries\s+from\b/i.test(cutover),
	'belt and braces: an earlier wholesale grant must not survive a partial re-run'
);
ok(
	'the cutover also withholds the server-managed columns',
	['id', 'updated_at'].every((c) => !grantedUpdateColumns.has(c)),
	'id is the identity and updated_at is set by the 0007 trigger; neither is the client to set'
);
ok(
	'the cutover does NOT reinstate a BEFORE UPDATE attribution trigger',
	!/\bcreate\s+(?:or\s+replace\s+)?trigger\s+[a-z_][a-z0-9_]*\s+before\s+update(?:\s+of\s+[a-z0-9_,\s]+)?\s+on\s+public\.entries\b/i.test(
		cutover
	),
	'it would defeat ON DELETE SET NULL and break revoking anyone with entries'
);

// reset_event_data() is SECURITY DEFINER, so its old passphrase check would
// remain an anon-callable bypass even after table RLS was corrected.
const resetBody = functionBodies(cutover, 'reset_event_data').at(-1) ?? '';
ok(
	'the cutover rewrites reset_event_data',
	resetBody.length > 0,
	'the cutover must replace the earlier passphrase-gated function'
);
ok(
	'the cutover reset_event_data requires a manager ON THAT EVENT',
	/public\.manages_event\s*\(/i.test(resetBody),
	'is_manager() alone would let a manager archive an event they are not on'
);
ok(
	'the cutover reset_event_data scopes deletes to the event it was given',
	/where\s+event_id\s*=\s*[a-z_][a-z0-9_]*/i.test(resetBody) &&
		!/where\s+session_id\s*=/i.test(resetBody),
	'the event arrives as an argument now; it used to be read from a request header'
);
ok(
	'the cutover reset_event_data no longer trusts the passphrase helper',
	resetBody.length > 0 && !/public\.has_manager_token\s*\(/i.test(resetBody)
);

// picklist and picklist_prefs are deliberately absent: this function has never
// deleted them, and widening what the one destructive operation destroys is not
// a change to make while renaming a column.
const archivedTables = [
	'assignment_overrides',
	'reminders',
	'assignments',
	'schedules',
	'event_meta'
];
const notArchived = archivedTables.filter(
	(table) =>
		!new RegExp(
			`delete\\s+from\\s+public\\.${escapeRe(table)}\\s+where\\s+event_id\\s*=`,
			'i'
		).test(resetBody)
);
ok(
	'the cutover reset_event_data clears every event-planning store',
	notArchived.length === 0,
	notArchived.join(', ')
);

ok(
	'the cutover revokes anon execution of reset_event_data',
	/revoke\s+(?:all|execute)\s+on\s+function\s+public\.reset_event_data\s*(?:\([^)]*\))?\s+from\s+[^;]*\banon\b[^;]*;/i.test(
		cutover
	)
);
const resetGrants = [
	...cutover.matchAll(
		/grant\s+execute\s+on\s+function\s+public\.reset_event_data\s*(?:\([^)]*\))?\s+to\s+([^;]+);/gi
	)
].map((match) => match[1].toLowerCase());
ok(
	'the cutover grants reset_event_data only to authenticated callers',
	resetGrants.some((roles) => /\bauthenticated\b/.test(roles)) &&
		resetGrants.every((roles) => !/\banon\b/.test(roles)),
	resetGrants.join(' | ')
);

// The cutover used to re-state 0010's revokes on profile_for_name, because 0011
// touched that function. 0019 and 0020 do not, and asserting a migration
// contains a line it has no reason to contain is how a check starts failing for
// being right. 0010 is where the revoke lives, and that is asserted directly
// below against `identity`.
for (const role of ['anon', 'authenticated']) {
	ok(
		`0010 never grants ${role} the backfill-only profile lookup`,
		new RegExp(
			`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.profile_for_name` +
				`\\s*\\(\\s*text\\s*\\)\\s+from\\s+[^;]*\\b${role}\\b[^;]*;`,
			'i'
		).test(identity) &&
			!new RegExp(
				`grant\\s+execute\\s+on\\s+function\\s+public\\.profile_for_name` +
					`\\s*\\(\\s*text\\s*\\)\\s+to\\s+[^;]*\\b${role}\\b[^;]*;`,
				'i'
			).test(identity)
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
