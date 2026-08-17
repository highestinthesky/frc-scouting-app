// Assertions about *emitted* component CSS.
//   node scripts/check_components.mjs      (part of `npm test`)
//
// These catch one recurring class of bug: Svelte scopes component styles by
// injecting a hash class into every selector, which SILENTLY CHANGES
// SPECIFICITY. A rule that looks like it loses to a browser default can win,
// and a rule that looks like it wins can lose. Neither shows up in the source,
// in a compiler warning, or in any test that doesn't render a browser.
//
// It has bitten twice here:
//
//   1. `:global(main) { padding-bottom: … }` in +layout.svelte looked like it
//      reserved space for the docked nav. A page's own scoped `main` selector
//      is (0,1,1); :global(main) is (0,0,1). It did nothing.
//   2. `.dlg { display: flex }` in Dialog.svelte compiled to
//      `.dlg.svelte-xxxx` — (0,2,0) — which outranks the browser's own
//      `dialog:not([open]) { display: none }` at (0,1,1). The closed dialog
//      rendered inline on every route, Confirm and Cancel buttons visible.
//
// Both are obvious in the emitted CSS. So read the emitted CSS.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const { compile } = await import(path.join(root, 'node_modules/svelte/src/compiler/index.js'));

/** Every file under a directory, recursively. */
function readdirRecursive(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? readdirRecursive(path.join(dir, e.name)) : [path.join(dir, e.name)]
	);
}

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? '\n        ' + detail : ''}`);
	}
};

/**
 * Emitted rules as { selector, body }, with comments stripped first.
 *
 * Stripping matters: the first version of this script matched its own
 * explanatory comments, which quote the very patterns being searched for, and
 * reported three failures against correct code.
 */
function rules(rel) {
	const css = (
		compile(readFileSync(path.join(root, rel), 'utf8'), { filename: rel }).css?.code ?? ''
	).replace(/\/\*[\s\S]*?\*\//g, '');
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
		selector: m[1].trim().replace(/\s+/g, ' '),
		body: m[2]
	}));
}

/** Selector text with Svelte's injected hash class removed, so patterns read
 *  the way they were written in the component. */
const unscoped = (sel) => sel.replace(/\.svelte-[a-z0-9]+/g, '');
const declares = (body, prop) => new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body);
const valueOf = (body, prop) => new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();

// ─── Dialog ────────────────────────────────────────────────────────────────
{
	const r = rules('src/lib/components/Dialog.svelte');
	const dlg = r.filter((x) => /(^|[\s,])\.dlg\b/.test(unscoped(x.selector)));

	ok('Dialog: found .dlg rules to inspect', dlg.length > 0);

	ok(
		'Dialog: the closed state is explicitly hidden',
		dlg.some(
			(x) => unscoped(x.selector).includes(':not([open])') && valueOf(x.body, 'display') === 'none'
		),
		"Svelte scoping outranks the browser's dialog:not([open]){display:none}, " +
			'so the component has to state it itself.'
	);

	// Any display on .dlg outside an [open] context recreates the bug.
	for (const x of dlg.filter((x) => declares(x.body, 'display'))) {
		const sel = unscoped(x.selector);
		const value = valueOf(x.body, 'display');
		ok(
			`Dialog: "${sel}" gates display on [open]`,
			sel.includes('[open]') || value === 'none',
			`sets display:${value} with no [open] guard — the closed dialog renders inline`
		);
	}

	ok(
		'Dialog: buttons keep the tap-target floor',
		r.some((x) => /var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')),
		'design.md treats 44px as non-negotiable; use var(--tap-min), not a literal'
	);
}

// ─── Button ────────────────────────────────────────────────────────────────
{
	const r = rules('src/lib/components/Button.svelte');

	ok(
		'Button: keeps the tap-target floor',
		r.some((x) => /var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')),
		'design.md treats 44px as non-negotiable'
	);

	for (const variant of ['primary', 'secondary', 'danger']) {
		ok(
			`Button: ${variant} variant is defined`,
			r.some((x) => new RegExp(`\\.${variant}\\b`).test(unscoped(x.selector)))
		);
	}

	// design.md: a destructive button should not look like the obvious thing to
	// press, so it is outlined at rest and fills only on hover.
	const dangerRest = r.find((x) => unscoped(x.selector).trim() === '.danger');
	ok(
		'Button: danger is outlined at rest, not filled',
		dangerRest && valueOf(dangerRest.body, 'background') === 'var(--bg-card)',
		`danger background is ${dangerRest ? valueOf(dangerRest.body, 'background') : '(rule missing)'}`
	);
}

// ─── Layout ────────────────────────────────────────────────────────────────
{
	const r = rules('src/routes/+layout.svelte');

	ok(
		'Layout: no :global(main) spacing rule',
		!r.some((x) => x.selector.includes(':global(main)') && declares(x.body, 'padding-bottom')),
		'a page-scoped `main` is (0,1,1) and beats :global(main) at (0,0,1) — ' +
			'pages must reserve --nav-bottom-h themselves'
	);

	ok(
		'Layout: publishes --nav-bottom-h for pages to reserve',
		r.some((x) => declares(x.body, '--nav-bottom-h'))
	);

	ok(
		'Layout: nav tabs keep the tap-target floor',
		r.some(
			(x) =>
				/\.tabs a/.test(unscoped(x.selector)) &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		)
	);
}

// ─── Settings ──────────────────────────────────────────────────────────────
//
// The first page migrated onto the system, and the one with the most distinct
// control types, so it keeps named assertions where the sweep below only
// counts violations.
{
	const r = rules('src/routes/settings/+page.svelte');
	const floors = (sel) =>
		r.some(
			(x) =>
				unscoped(x.selector).split(',').some((p) => p.trim().includes(sel)) &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		);

	// The role picker was removed — a self-asserted local toggle that revealed
	// manager surfaces to anyone who ticked it. auth.showsManagerTools decides now.
	ok('Settings: theme picker meets the tap floor', floors('.theme-btn'));
	ok('Settings: text inputs meet the tap floor', floors('input'));
	ok(
		'Settings: the back link is tappable, not just a glyph',
		r.some(
			(x) =>
				unscoped(x.selector).includes('.back') &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-width') ?? '')
		),
		'a 1.5rem arrow is the most-tapped control on a sub-page and the smallest'
	);
}

// ─── the whole tree is on the token scale ──────────────────────────────────
//
// design.md defines one spacing scale, one type scale and one palette. A
// literal is not wrong because it looks bad — it is wrong because it stops
// tracking. #2c5cb0 was the light-mode alliance blue, hardcoded in Field.svelte
// and in three other places; when dark mode arrived it stayed dark blue against
// a dark card in all of them, and nobody noticed because each copy looked
// deliberate on its own.
//
// So: sweep every component and every page, every time.
//
// Widths, heights and flex-basis are sizes rather than spacing and stay
// literal. calc() is allowed — an intentional multiple of a token still tracks.
{
	const SPACING = [
		'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
		'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
		'gap', 'row-gap', 'column-gap'
	];
	const COLOUR = ['background', 'background-color', 'color', 'border', 'border-color',
		'border-left', 'border-right', 'border-top', 'border-bottom', 'fill', 'stroke'];

	const files = readdirRecursive(path.join(root, 'src'))
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => path.relative(root, f))
		.sort();

	const rawSpacing = [];
	const rawType = [];
	const rawColour = [];

	for (const rel of files) {
		for (const x of rules(rel)) {
			const sel = unscoped(x.selector);
			const at = (prop, v) => `${rel}  ${sel} { ${prop}: ${v} }`;

			for (const prop of SPACING) {
				const v = valueOf(x.body, prop);
				if (v && /(?<![\w.-])\d*\.?\d+rem/.test(v) && !v.includes('calc(')) {
					rawSpacing.push(at(prop, v));
				}
			}

			const fs = valueOf(x.body, 'font-size');
			if (fs && /(?<![\w.-])\d*\.?\d+rem/.test(fs)) rawType.push(at('font-size', fs));

			// The layout owns the palette; every hex there is a token being
			// *defined*, which is the one legitimate place for a literal.
			if (rel === path.join('src', 'routes', '+layout.svelte')) continue;
			for (const prop of COLOUR) {
				const v = valueOf(x.body, prop);
				if (v && /#[0-9a-fA-F]{3,8}\b/.test(v)) rawColour.push(at(prop, v));
			}
		}
	}

	ok(
		`spacing comes from tokens across all ${files.length} components`,
		rawSpacing.length === 0,
		rawSpacing.join('\n        ')
	);
	ok(
		'type sizes come from tokens',
		rawType.length === 0,
		rawType.join('\n        ')
	);
	ok(
		'colour comes from tokens — only +layout.svelte may write a literal',
		rawColour.length === 0,
		rawColour.join('\n        ')
	);
}

// ─── every token referenced is a token that exists ─────────────────────────
//
// var(--ok, var(--accent)) compiles, renders, and is wrong: --ok was never
// defined, so every "improving" trend on /insights/compare and every team page
// silently rendered in the brand purple instead of green. A fallback turns a
// missing token into a plausible-looking colour, which is the worst failure
// mode available — no error, no visual clue, just a lie about the data.
{
	const layout = readFileSync(path.join(root, 'src/routes/+layout.svelte'), 'utf8');
	const defined = new Set([...layout.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

	const files = readdirRecursive(path.join(root, 'src'))
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => path.relative(root, f));

	const missing = [];
	for (const rel of files) {
		const src = readFileSync(path.join(root, rel), 'utf8');
		const sm = /<style>([\s\S]*?)<\/style>/.exec(src);
		if (!sm) continue;
		const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, '');
		// Locally-declared custom properties count as defined for that file.
		const local = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
		for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
			if (!defined.has(m[1]) && !local.has(m[1])) missing.push(`${rel}: var(${m[1]})`);
		}
	}
	ok(
		'every var(--token) referenced is defined in +layout.svelte',
		missing.length === 0,
		missing.join('\n        ')
	);
}

// ─── auth pages ────────────────────────────────────────────────────────────
//
// Login lives at the root now — it is the landing page, so its file is
// routes/+page.svelte rather than routes/login/+page.svelte. Home moved to
// /home to make room.
for (const [label, file] of [
	['login', 'src/routes/+page.svelte'],
	['register', 'src/routes/register/+page.svelte'],
	['accounts', 'src/routes/studio/accounts/+page.svelte']
]) {
	const r = rules(file);
	const ownRule = r.some(
		(x) =>
			/^(input|select)/.test(unscoped(x.selector)) &&
			/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
	);
	// A page may satisfy the floor by delegating to Select.svelte rather than
	// styling a bare control. That is the better outcome — one component owning
	// the floor beats five pages each remembering it — but the guarantee must not
	// evaporate into "someone else handles it", so Select.svelte's own rule is
	// asserted directly below.
	const delegates = /from '[^']*components\/Select\.svelte'/.test(
		readFileSync(path.join(root, file), 'utf8')
	);
	ok(
		`/${label}: inputs and selects meet the tap floor`,
		ownRule || delegates,
		'a login field is the first thing anyone touches'
	);
}

// The component the pages above delegate to. If this rule goes, so does the
// floor on every page that stopped styling its own control.
{
	const r = rules('src/lib/components/Select.svelte');
	ok(
		'Select: the control itself meets the tap floor',
		r.some(
			(x) =>
				/^select/.test(unscoped(x.selector)) &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		),
		'pages delegate their tap floor to this component'
	);
	// appearance:none is what makes it ours rather than the platform's — the
	// whole reason the component exists. Without it this is a native select
	// wearing a border.
	ok(
		'Select: the platform chrome is actually stripped',
		r.some((x) => /^select/.test(unscoped(x.selector)) && /none/.test(valueOf(x.body, 'appearance') ?? ''))
	);
}

// The scout's own page. It had a directory until v0.73 — Scouting (itself),
// Insights, Accounts, Settings — and every one of those is now a tab or lives
// behind the Studio button, so the directory went rather than being restyled.
//
// The assertion follows: what a scout actually taps here is the entry list, and
// each row opens a saved entry for editing. That is the most-tapped control in
// the app and it is what has to clear the floor.
{
	const r = rules('src/routes/scouting/+page.svelte');
	ok(
		'/scouting: entry rows meet the tap floor',
		r.some(
			(x) =>
				/\.(entry|row|item)\b/.test(unscoped(x.selector)) &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		),
		'the entry list is the page; its rows are the most-tapped thing in the app'
	);
}

// ─── nobody re-derives "am I a manager" ────────────────────────────────────
//
// Before the cutover the database gates writes on has_manager_token(); after
// it, on is_manager(). `auth.canManage` and `auth.managerCredentials()` hold
// both answers so the switch is one constant.
//
// This is not hypothetical tidiness. /scouting and /insights/picklist had
// already drifted: one derived the answer from AUTH_ENFORCED, the other read
// session.managerToken raw. Flipping the flag would have locked the first and
// left the second showing buttons that silently fail — the worse half, because
// it looks like it worked.
//
// Reading session.managerToken is allowed only where AUTH_ENFORCED is checked
// on the same line, which is the passphrase-entry UI that exists solely before
// the cutover and is deleted with it.
{
	const offenders = [];
	for (const abs of readdirRecursive(path.join(root, 'src'))) {
		if (!/\.(svelte|js)$/.test(abs)) continue;
		const rel = path.relative(root, abs);
		if (rel.endsWith(path.join('lib', 'auth.svelte.js'))) continue; // owns the answer

		readFileSync(abs, 'utf8')
			.split('\n')
			.forEach((line, i) => {
				const code = line.replace(/\/\/.*$/, '');
				if (!/\bsession\.managerToken\b/.test(code)) return;
				if (/\bAUTH_ENFORCED\b/.test(code)) return; // explicitly pre-cutover only
				offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
			});
	}
	ok(
		'nobody derives manager rights outside auth.svelte.js',
		offenders.length === 0,
		offenders.join('\n        ') +
			'\n        use auth.canManage / auth.managerCredentials(), or guard on AUTH_ENFORCED'
	);
}

// ─── every page's back link is a target, not a glyph ───────────────────────
//
// The ← is the most-used control on a sub-page and started life as a 1.5rem
// character with 4px of padding on every one of them.
{
	const offenders = [];
	for (const rel of readdirRecursive(path.join(root, 'src/routes'))
		.filter((f) => f.endsWith('+page.svelte'))
		.map((f) => path.relative(root, f))) {
		const r = rules(rel);
		const back = r.filter((x) => /(^|[\s,])\.back\b/.test(unscoped(x.selector)));
		if (back.length === 0) continue; // page has no back link
		const sized = back.some(
			(x) =>
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-width') ?? '') &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		);
		if (!sized) offenders.push(rel);
	}
	ok(
		'every back link is at least 44 x 44',
		offenders.length === 0,
		offenders.join('\n        ')
	);
}

// ─── a parent must not style a child component through a class prop ────────
//
// `<Button class="mb-add" />` with `.mb-add {}` in the parent's <style> looks
// correct and does nothing. Svelte scopes the parent's selector with the
// PARENT's hash, while the element the child renders carries the CHILD's — so
// they never match. And unlike an unused selector, the compiler does not warn,
// because it can see the class right there in the markup.
//
// The fix is a wrapper element the parent does own. Found this the moment
// Button.svelte landed; it had already silently broken two layouts.
{
	const files = readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'));
	const offenders = [];
	for (const abs of files) {
		const src = readFileSync(abs, 'utf8');
		const sm = /<style>([\s\S]*?)<\/style>/.exec(src);
		if (!sm) continue;
		const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, '');
		const localClasses = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
		const markup = src.slice(0, sm.index);
		// Components are capitalised; plain elements are not.
		for (const m of markup.matchAll(/<([A-Z]\w+)\b[^>]*?\bclass="([^"]*)"/gs)) {
			for (const cls of m[2].split(/\s+/)) {
				if (localClasses.has(cls)) {
					offenders.push(`${path.relative(root, abs)}: <${m[1]} class="${cls}"> — .${cls} is styled here and cannot reach it`);
				}
			}
		}
	}
	ok(
		'no parent styles a child component through a class prop',
		offenders.length === 0,
		offenders.join('\n        ')
	);
}


// ─── a tab must open the page it names ─────────────────────────────────────
//
// Three of four labels disagreed with their page before v0.73: Home opened
// "Your entries", Scouting opened "Schedule", Insights opened "Manager". That
// one table was the root of four separate complaints, and nothing in the code
// would ever have caught it — a label and a heading are strings in different
// files that no test related.
//
// This relates them. The pairs are listed rather than inferred, because the map
// from a nav label to a route is the thing being asserted; deriving it from the
// nav would make the check agree with whatever the nav happens to say.
{
	const headingOf = (file) => {
		const src = readFileSync(path.join(root, file), 'utf8');
		return (/<h1[^>]*>([^<]+)/.exec(src)?.[1] ?? '').trim();
	};
	for (const [label, file] of [
		['Scouting', 'src/routes/scouting/+page.svelte'],
		['Settings', 'src/routes/settings/+page.svelte'],
		['Event', 'src/routes/studio/event/+page.svelte'],
		['Schedule', 'src/routes/studio/schedule/+page.svelte'],
		['Coverage', 'src/routes/studio/coverage/+page.svelte'],
		['Insights', 'src/routes/studio/insights/+page.svelte'],
		['Accounts', 'src/routes/studio/accounts/+page.svelte']
	]) {
		const h = headingOf(file);
		ok(
			`"${label}" opens a page headed "${label}"`,
			h === label,
			`heading is "${h}"`
		);
	}
}


// ─── no grid track may refuse to shrink ────────────────────────────────────
//
// A bare `1fr` track will not go below its content's min-content width, so a
// text input or a nav row holds the whole grid wider than the viewport and the
// PAGE scrolls sideways. `minmax(0, 1fr)` is identical except that it may
// shrink.
//
// This is here because it shipped three times: the Accounts form at 375px, the
// Studio sidebar on a phone, and eleven tracks found in the sweep between them.
// It is invisible in review — `1fr` looks like exactly what you meant — and only
// shows up on a narrow screen, which is the screen this app is for.
{
	const offenders = [];
	for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
		const rel = path.relative(root, abs);
		const src = readFileSync(abs, 'utf8');
		for (const m of src.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
			// A bare `<n>fr` not already wrapped in minmax().
			const withoutMinmax = m[1].replace(/minmax\([^)]*\)/g, '');
			if (/(?:^|[\s,])\d*fr\b/.test(withoutMinmax)) {
				offenders.push(`${rel}: ${m[0].trim()}`);
			}
		}
	}
	ok(
		'every grid track may shrink (minmax(0, 1fr), not 1fr)',
		offenders.length === 0,
		offenders.slice(0, 3).join(' | ')
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
