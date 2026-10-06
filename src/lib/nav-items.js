// What the navigation offers, and which entry a page lights.
//
// One list, read by the shell and by the checks, because the shell and the
// checks disagreeing is the failure this file exists to prevent: Studio's rail
// kept its own TABS array and mapped the event-coded routes by hand, so the two
// pages added "to be linked to from everywhere" lit nothing for a release.
//
// ─── one shell, navigation by role ─────────────────────────────────────────
//
// Studio was a separate application until the branch that folded it in. Scouts
// never saw it — the button rendered only for managers — so the split protected
// nobody, and it cost managers an event picker outside their tools and a trip
// out of Studio to record a match. A scout's list here is exactly what the
// two-tab bar always held. A manager's adds the event pages, named for what the
// manager is doing (plan, run, pick) rather than the noun the data happens to be.
//
// Paths are written without the deploy base; the shell prefixes `base`.

/** @typedef {{ key: string, label: string, href: string }} NavItem */

/** @type {Record<string, NavItem>} */
const ITEMS = {
	home: { key: 'home', label: 'Home', href: '/home/' },
	plan: { key: 'plan', label: 'Plan', href: '/studio/plan/people/' },
	run: { key: 'run', label: 'Run', href: '/studio/run/matches/' },
	pick: { key: 'pick', label: 'Pick', href: '/studio/pick/' },
	accounts: { key: 'accounts', label: 'Accounts', href: '/studio/accounts/' },
	settings: { key: 'settings', label: 'Settings', href: '/settings/' }
};

export const SCOUT_NAV = Object.freeze([ITEMS.home, ITEMS.settings]);

export const MANAGER_NAV = Object.freeze([
	ITEMS.home,
	ITEMS.plan,
	ITEMS.run,
	ITEMS.pick,
	ITEMS.accounts,
	ITEMS.settings
]);

/**
 * The sidebar's groups, in order. Home is where a manager records like anyone
 * else; the event modes sit together; Accounts is the one page with no event;
 * Settings is the device.
 */
export const MANAGER_GROUPS = Object.freeze([
	['home'],
	['plan', 'run', 'pick'],
	['accounts'],
	['settings']
]);

/**
 * What earns a slot on a manager's phone bar. Run and Pick are what a manager
 * does in the stands during an event, and Home is where they record. Plan and
 * Accounts are laptop jobs done before it, so they wait behind More with
 * Settings. Review joins this list when it exists.
 */
export const PHONE_PRIMARY = Object.freeze(['home', 'run', 'pick']);

/**
 * Each mode's sub-pages, rendered as a segmented control under the page
 * heading. A mode's <h1> is the mode; the lit segment says which sub-page.
 *
 * @type {Readonly<Record<string, ReadonlyArray<NavItem>>>}
 */
export const SUBNAV = Object.freeze({
	plan: Object.freeze([
		{ key: 'people', label: 'People', href: '/studio/plan/people/' },
		{ key: 'schedule', label: 'Schedule', href: '/studio/plan/schedule/' },
		{ key: 'assignments', label: 'Assignments', href: '/studio/plan/assignments/' },
		{ key: 'event', label: 'Event', href: '/studio/plan/event/' }
	]),
	run: Object.freeze([
		{ key: 'matches', label: 'Matches', href: '/studio/run/matches/' },
		{ key: 'scouts', label: 'Scouts', href: '/studio/run/scouts/' },
		{ key: 'coverage', label: 'Coverage', href: '/studio/run/coverage/' }
	]),
	pick: Object.freeze([
		{ key: 'teams', label: 'Teams', href: '/studio/pick/' },
		{ key: 'compare', label: 'Compare', href: '/studio/pick/compare/' },
		{ key: 'picklist', label: 'Picklist', href: '/studio/pick/picklist/' }
	])
});

/**
 * The navigation for an account.
 *
 * @param {{ manager: boolean }} who
 * @returns {ReadonlyArray<NavItem>}
 */
export function navFor({ manager }) {
	return manager ? MANAGER_NAV : SCOUT_NAV;
}

/**
 * Strip the deploy base and any trailing slash.
 *
 * @param {string} pathname
 * @param {string} [base]
 */
function normalise(pathname, base = '') {
	let p = String(pathname ?? '');
	if (base && p.startsWith(base)) p = p.slice(base.length);
	p = p.replace(/\/+$/, '');
	return p || '/';
}

/**
 * Which top-level entry a path lights, or '' for none.
 *
 * The entry form (/scouting/new, /scouting/edit) lights nothing, as it never
 * has: it is a task opened from Home, not a place, and lighting Home there
 * would change what a scout's bar looks like mid-recording.
 *
 * @param {string} pathname
 * @param {string} [base]
 * @returns {string}
 */
export function activeKey(pathname, base = '') {
	const parts = normalise(pathname, base).split('/').filter(Boolean);
	const [first, second, third] = parts;
	if (first === 'home') return 'home';
	if (first === 'settings') return 'settings';
	if (first !== 'studio') return '';
	if (second === 'plan' || second === 'run' || second === 'pick' || second === 'accounts') {
		return second;
	}
	// The pre-merge names still answer, as redirects, and should not flash an
	// unlit bar while they do.
	if (second === 'event') return 'plan';
	if (second === 'schedule' || second === 'coverage') return 'run';
	if (second === 'insights') return 'pick';
	// /studio/<eventCode>/q<n> and /studio/<eventCode>/team/<n> put an event
	// code in the second slot. A match belongs to Run until Review exists; a team
	// belongs to Pick.
	if (second && third && /^q\d+$/.test(third)) return 'run';
	if (second && third === 'team') return 'pick';
	return '';
}

/**
 * Which sub-page a path lights within its mode, or ''.
 *
 * @param {string} pathname
 * @param {string} [base]
 * @returns {string}
 */
export function activeSubKey(pathname, base = '') {
	const p = normalise(pathname, base);
	const mode = activeKey(pathname, base);
	const items = SUBNAV[mode];
	if (!items) return '';
	// Longest href first, so /studio/pick/compare is not claimed by /studio/pick.
	const byLength = [...items].sort((a, b) => b.href.length - a.href.length);
	for (const item of byLength) {
		const h = item.href.replace(/\/+$/, '');
		if (p === h || p.startsWith(h + '/')) return item.key;
	}
	return '';
}
