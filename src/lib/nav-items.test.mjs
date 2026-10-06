// The navigation a role gets, and what each page lights.
//
// The scout half is the promise that made folding Studio into the app safe:
// a scout's bar is the two tabs it always was. The manager half is the map
// from a path to an entry, including the event-coded routes the old Studio
// rail mapped by hand and got wrong for a release.

import {
	navFor,
	activeKey,
	activeSubKey,
	SCOUT_NAV,
	MANAGER_NAV,
	MANAGER_GROUPS,
	PHONE_PRIMARY,
	SUBNAV
} from './nav-items.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

// ── by role ────────────────────────────────────────────────────────────────
ok(
	'a scout gets exactly Home and Settings',
	navFor({ manager: false }).map((i) => i.label).join(',') === 'Home,Settings'
);
ok('the scout list is the frozen constant', navFor({ manager: false }) === SCOUT_NAV);
ok(
	'a manager gets Home, Plan, Run, Pick, Accounts, Settings',
	navFor({ manager: true }).map((i) => i.label).join(',') ===
		'Home,Plan,Run,Pick,Accounts,Settings'
);
ok('no entry links to Studio', !MANAGER_NAV.some((i) => /^\/studio\/?$/.test(i.href)));

// Every manager entry is in exactly one sidebar group, and the phone bar plus
// More together hold every entry — an entry that is in neither is unreachable.
{
	const grouped = MANAGER_GROUPS.flat();
	ok(
		'every manager entry sits in exactly one sidebar group',
		MANAGER_NAV.every((i) => grouped.filter((k) => k === i.key).length === 1) &&
			grouped.length === MANAGER_NAV.length
	);
	ok(
		'the phone bar names only real entries',
		PHONE_PRIMARY.every((k) => MANAGER_NAV.some((i) => i.key === k))
	);
	ok('the phone bar leaves room for More within five slots', PHONE_PRIMARY.length <= 4);
}

// ── what a path lights ─────────────────────────────────────────────────────
const cases = [
	['/home/', 'home'],
	['/settings', 'settings'],
	['/scouting/new/', ''],
	['/practice/', ''],
	['/studio/plan/people/', 'plan'],
	['/studio/plan/event', 'plan'],
	['/studio/run/matches/', 'run'],
	['/studio/run/scouts/', 'run'],
	['/studio/pick/', 'pick'],
	['/studio/pick/picklist/', 'pick'],
	['/studio/accounts/', 'accounts'],
	['/studio/2026nyny/q12/', 'run'],
	['/studio/2026nyny/team/254/', 'pick'],
	['/studio/event/', 'plan'],
	['/studio/schedule/', 'run'],
	['/studio/insights/compare/', 'pick'],
	['/studio/', '']
];
for (const [p, want] of cases) {
	const got = activeKey(p);
	ok(`${p} lights "${want}"`, got === want, `got "${got}"`);
}
ok(
	'the deploy base is stripped first',
	activeKey('/frc-scouting-app/studio/run/matches/', '/frc-scouting-app') === 'run'
);
ok(
	'a team number is not a match',
	activeKey('/studio/2026nyny/team/12/') === 'pick'
);

// ── sub-pages ──────────────────────────────────────────────────────────────
const subs = [
	['/studio/plan/people/', 'people'],
	['/studio/plan/assignments', 'assignments'],
	['/studio/run/coverage/', 'coverage'],
	['/studio/pick/', 'teams'],
	['/studio/pick/compare/', 'compare'],
	['/studio/pick/picklist/', 'picklist'],
	['/studio/accounts/', ''],
	['/home/', '']
];
for (const [p, want] of subs) {
	const got = activeSubKey(p);
	ok(`${p} lights sub-page "${want}"`, got === want, `got "${got}"`);
}
ok(
	'every mode entry links to one of its own sub-pages',
	Object.entries(SUBNAV).every(([mode, items]) => {
		const entry = MANAGER_NAV.find((i) => i.key === mode);
		return entry && items.some((s) => s.href === entry.href);
	})
);

console.log(`nav items: ${pass} passed${fail ? `, ${fail} failed` : ''}`);
if (fail) process.exit(1);
