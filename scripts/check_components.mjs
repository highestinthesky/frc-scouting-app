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

/**
 * Does this selector use the class `name` — that class, not one starting with it?
 *
 * `\b` is the wrong boundary for a CSS identifier. Class names contain hyphens
 * and `\b` treats a hyphen as a boundary, so `/\.back\b/` matches `.back-link`.
 * That surfaced the moment the real `.back` rules were replaced by PageHead: the
 * only thing left on the team page was `.back-link`, a labelled text link, and
 * the back-link check demanded a 44px min-WIDTH of it — which a link reading
 * "Back to Insights" does not need and should not have.
 *
 * A false failure on correct code is the worst outcome for a build-blocking
 * check, because the cheapest way out is to rename the class.
 */
const usesClass = (sel, name) => new RegExp(`(^|[\\s,>+~(])\\.${name}(?![\\w-])`).test(sel);
const declares = (body, prop) => new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body);
const valueOf = (body, prop) => new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();

// ─── Dialog ────────────────────────────────────────────────────────────────
{
	const r = rules('src/lib/components/Dialog.svelte');
	const dlg = r.filter((x) => usesClass(unscoped(x.selector), "dlg"));

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

	for (const variant of ['primary', 'secondary', 'danger', 'ghost']) {
		ok(
			`Button: ${variant} variant is defined`,
			r.some((x) => new RegExp(`\\.${variant}\\b`).test(unscoped(x.selector)))
		);
	}

	// …and nobody asks for one that is not.
	//
	// Four call sites passed variant="ghost" for a release before the rule
	// existed. It rendered `.btn.ghost` against nothing, so those buttons had no
	// fill, no border colour and inherited body text. Nothing failed and nothing
	// could: a variant prop is a class name, and a class with no rule behind it
	// is not an error in CSS, in Svelte, or in any test that does not render.
	//
	// Checked against the SELECTORS in Button.svelte rather than a hardcoded
	// list, so adding a variant to the component is all it takes to allow it.
	{
		const defined = new Set(
			r.flatMap((x) =>
				[...unscoped(x.selector).matchAll(/\.([a-z][\w-]*)\b/g)].map((m) => m[1])
			)
		);
		const offenders = [];
		for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
			const rel = path.relative(root, abs);
			for (const m of readFileSync(abs, 'utf8').matchAll(/<Button[^>]*?\bvariant="([^"]+)"/gs)) {
				if (!defined.has(m[1])) offenders.push(`${rel}: variant="${m[1]}"`);
			}
		}
		ok(
			'every Button variant asked for is one Button defines',
			offenders.length === 0,
			offenders.join('\n        ') + '\n        an unmatched class is not an error — it is an unstyled button'
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

// ─── the font is declared once, on body ────────────────────────────────────
//
// It was declared eighteen times, always on a page's own `main`, and three
// Studio pages never grew a `main` rule: /studio/event, /studio/coverage and
// /studio/insights rendered entirely in Times. In production. For a release.
//
// The failure mode is what makes this worth a check rather than a fix. Every
// page that HAD the rule looked correct, so the app looked correct, and the
// missing ones were the three nobody had opened on a laptop since v0.73 moved
// them. A per-page declaration is a per-page thing to forget, and a redress that
// adds a fourth Studio page would forget it again.
{
	const offenders = [];
	for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
		const rel = path.relative(root, abs);
		for (const x of rules(rel)) {
			if (!declares(x.body, 'font-family')) continue;
			// Monospace is a deliberate exception: a match key or a code sample is
			// a different typeface on purpose, not a copy of the body stack.
			if (/mono/i.test(valueOf(x.body, 'font-family') ?? '')) continue;
			if (rel === path.join('src', 'routes', '+layout.svelte') && /body/.test(x.selector)) continue;
			offenders.push(`${rel}  ${unscoped(x.selector)} { font-family: ${valueOf(x.body, 'font-family')} }`);
		}
	}
	ok(
		'the body font is declared once, in the layout, and inherited',
		offenders.length === 0,
		offenders.join('\n        ') + '\n        a page that declares its own font is a page that can omit it'
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
		const back = r.filter((x) => usesClass(unscoped(x.selector), "back"));
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

	// The sweep above skips a page with no `.back` rule, which is now the normal
	// case in Studio — PageHead owns the control. Same shape as Select and the
	// tap floor: delegating is the better outcome, but the guarantee must not
	// evaporate into "someone else handles it", so the owner is asserted directly.
	const r = rules('src/lib/components/studio/PageHead.svelte');
	ok(
		'PageHead: the back control pages delegate to is 44 x 44',
		r.some(
			(x) =>
				unscoped(x.selector).includes('.back') &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-width') ?? '') &&
				/var\(--tap-min\)/.test(valueOf(x.body, 'min-height') ?? '')
		)
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
	// Studio's pages hand their <h1> to PageHead, so the heading is a `title`
	// prop in the page file rather than an element in it. Reading either is the
	// same guarantee: the string this finds is the string that becomes the
	// heading. What must NOT happen is inferring it from the nav, which would
	// make the check agree with whatever the nav happens to say.
	const headingOf = (file) => {
		const src = readFileSync(path.join(root, file), 'utf8');
		const literal = /<h1[^>]*>([^<{]+)</.exec(src)?.[1];
		if (literal) return literal.trim();
		return (/<PageHead[^>]*\btitle="([^"]+)"/s.exec(src)?.[1] ?? '').trim();
	};

	// …and PageHead has to actually render one. Without this the check above
	// passes on a component that renders its title in a <div>, which is the
	// failure mode where an assertion holds for the wrong reason.
	{
		const src = readFileSync(path.join(root, 'src/lib/components/studio/PageHead.svelte'), 'utf8');
		ok(
			'PageHead renders its title as the page <h1>',
			/<h1[^>]*>\s*\{title\}/.test(src),
			'the nav-label check reads a title prop and trusts it to become the heading'
		);
	}
	// Home is the one deliberate exception, and it is asserted here rather than
	// omitted so the exception is visible instead of being a gap.
	//
	// Its <h1> is a greeting — "Good afternoon, Ada" — because the page's job is
	// to speak to the person, not to title itself. A tab reading "Home" opening a
	// page headed "Good afternoon" is not the drift this check exists to catch:
	// that was "Insights" opening a page headed "Manager", where the two names
	// described different things. Here they describe the same place and one of
	// them is a salutation. What IS asserted is that the greeting is really there
	// — so the exception cannot quietly become an untitled page.
	{
		const src = readFileSync(path.join(root, 'src/routes/home/+page.svelte'), 'utf8');
		ok(
			'"Home" opens a page that greets the scout by name',
			/Good morning|Good afternoon|Good evening/.test(src) && /<h1[^>]*>/.test(src),
			'Home is exempt from label==heading only because its heading is a greeting'
		);
	}

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
	/**
	 * Remove every minmax(...) — including one holding a nested min()/max()/clamp().
	 *
	 * A regex cannot do this: `minmax\([^)]*\)` stops at the FIRST `)`, so
	 * `minmax(min(10rem, 100%), 1fr)` strips down to `, 1fr)` and the check
	 * reports a bare track that is not there. That is the wrong direction for a
	 * build-blocking check — a false failure on ordinary CSS teaches people to
	 * work around the checker, and the whole reason this one exists is that it
	 * catches something nobody can see by eye.
	 */
	function stripMinmax(value) {
		let out = '';
		for (let i = 0; i < value.length; i += 1) {
			if (!value.startsWith('minmax(', i)) {
				out += value[i];
				continue;
			}
			let depth = 0;
			for (let j = i + 'minmax'.length; j < value.length; j += 1) {
				if (value[j] === '(') depth += 1;
				else if (value[j] === ')') {
					depth -= 1;
					if (depth === 0) {
						i = j;
						break;
					}
				}
			}
		}
		return out;
	}

	const offenders = [];
	for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
		const rel = path.relative(root, abs);
		const src = readFileSync(abs, 'utf8');
		for (const m of src.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
			// A bare `<n>fr` not already wrapped in minmax().
			const withoutMinmax = stripMinmax(m[1]);
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

	// ── and no track nests minmax() inside minmax() ────────────────────────
	//
	// `minmax(8.5rem, minmax(0, 1fr))` is not valid CSS — minmax()'s max may not
	// be another minmax() — so the browser drops the WHOLE declaration. The grid
	// silently falls back to one column.
	//
	// Two of these were live: the team page's metric cards and the compare page's
	// columns, both rendering one item per row across a 977px area. It reads as a
	// layout choice, which is why it survived: nothing errors, nothing warns,
	// nothing looks broken — it just looks like somebody wanted a list.
	//
	// It is the shape of a careful mistake, too. Every OTHER track in the app is
	// `minmax(0, 1fr)` to keep it shrinkable, so writing that inside an auto-fit
	// minmax is the obvious next step, and it is the one place it is illegal.
	{
		const nested = [];
		for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
			const rel = path.relative(root, abs);
			for (const m of readFileSync(abs, 'utf8').matchAll(/grid-template-columns:\s*([^;]+);/g)) {
				if (/minmax\([^()]*,\s*minmax\(/.test(m[1])) nested.push(`${rel}: ${m[0].trim()}`);
			}
		}
		ok(
			'no grid track nests minmax() inside minmax()',
			nested.length === 0,
			nested.join('\n        ') +
				"\n        invalid CSS — the browser drops the declaration and the grid collapses to one column"
		);
	}
}


// ─── one box model, so an <a> and a <button> are the same size ──────────────
//
// The UA stylesheet gives form controls border-box and leaves everything else
// content-box. So `min-height: var(--tap-min)` plus padding measured 44px on a
// <button> and 62px on an <a> — same class, same tokens, 18px apart, in one
// toolbar on /studio/insights:
//
//     Compare      <a class="btn">        62px
//     Picklist     <a class="btn">        62px
//     Export CSV   <button class="btn">   44px
//
// Button's href prop promises the element changes and the styling does not, and
// that is not keepable while the two elements measure themselves differently.
// Remove this reset and the promise silently breaks again — nothing else in the
// suite would notice, because every rule still says var(--tap-min).
{
	const r = rules('src/routes/+layout.svelte');
	const reset = r.find(
		(x) => x.selector.includes('*') && valueOf(x.body, 'box-sizing') === 'border-box'
	);
	ok(
		'one box model applies to everything',
		Boolean(reset),
		'without a global border-box reset, <a class="btn"> and <button class="btn"> render 18px apart'
	);
}

// ─── the system's voice does not drift ─────────────────────────────────────
//
// Two rules from design.md § Typography, both of which had already drifted by
// v0.75 and neither of which is visible in review — they are wrong by 0.01em and
// by a font-style keyword.
//
// Found by auditing every page against design.md rather than by looking. That is
// the only way this class of drift surfaces: each instance is defensible alone,
// and the damage is cumulative.
{
	const italics = [];
	const tracking = [];
	for (const abs of readdirRecursive(path.join(root, 'src')).filter((f) => f.endsWith('.svelte'))) {
		const rel = path.relative(root, abs);
		for (const x of rules(rel)) {
			const sel = unscoped(x.selector);

			// "Headings are always roman. No italic display type anywhere."
			// An italicised heading is also the single most reliable AI tell there
			// is, which is why the design system bans it outright rather than
			// leaving it to taste.
			if (
				valueOf(x.body, 'font-style') === 'italic' &&
				/(^|[\s,>+~])(h[1-6]|\.title|\.head|\.heading)(?![\w-])/.test(sel)
			) {
				italics.push(`${rel}  ${sel}`);
			}

			// "Section labels: uppercase, 0.06em tracking, --text-muted."
			// Seven places had drifted to 0.05em. Individually invisible; together
			// they are how a design system stops being one.
			const ls = valueOf(x.body, 'letter-spacing');
			if (valueOf(x.body, 'text-transform') === 'uppercase' && ls && /em$/.test(ls)) {
				const em = parseFloat(ls);
				// 0.04em is the app-bar/event-code voice and predates the rule;
				// anything between it and 0.06 is drift toward one of them.
				if (em > 0.04 && em < 0.06) tracking.push(`${rel}  ${sel} { letter-spacing: ${ls} }`);
			}
		}
	}
	ok('no heading is italic', italics.length === 0, italics.join('\n        '));
	ok(
		'uppercase section labels all track at the system value',
		tracking.length === 0,
		tracking.join('\n        ') + '\n        design.md § Typography: 0.06em'
	);
}

// ─── a moved route still answers ───────────────────────────────────────────
//
// v0.73 moved five surfaces into Studio and its own plan said "Every old path
// redirects. A cached PWA or a bookmark must not 404 on the morning of an
// event." Only /home ever got one. /insights, /insights/compare,
// /insights/picklist, /insights/team/[n] and /accounts returned 404 on a static
// host — measured against the build, not assumed.
//
// This is invisible in development, and that is the whole reason it survived:
// `npm run dev` and `npm run preview` both serve an SPA fallback for any path,
// so every one of these resolves locally and 404s only once deployed.
//
// The pairs are listed rather than derived. Deriving "what used to exist" from
// what exists now is circular — it would agree with any deletion.
{
	const MOVED = [
		// /home is NOT here any more. It was a redirect to /scouting from v0.73
		// until v0.75, when it became a real page again — the scout's landing
		// surface. Installed PWAs that still point at /home now arrive somewhere
		// better than they used to, which is the outcome the redirect existed to
		// approximate.
		['src/routes/insights', '/studio/insights/'],
		['src/routes/insights/compare', '/studio/insights/compare/'],
		['src/routes/insights/picklist', '/studio/insights/picklist/'],
		['src/routes/insights/team/[teamNumber]', '/studio/insights/team/'],
		['src/routes/accounts', '/studio/accounts/']
	];
	const offenders = [];
	for (const [dir, target] of MOVED) {
		const file = path.join(root, dir, '+page.svelte');
		let src = '';
		try {
			src = readFileSync(file, 'utf8');
		} catch {
			offenders.push(`${dir} — no +page.svelte, so this path 404s`);
			continue;
		}
		if (!/\bgoto\(/.test(src)) offenders.push(`${dir} — exists but never calls goto()`);
		else if (!src.includes(target)) offenders.push(`${dir} — redirects somewhere other than ${target}`);
	}
	ok(
		'every route moved in v0.73 still redirects',
		offenders.length === 0,
		offenders.join('\n        ')
	);
}

// ─── the SPA fallback is named what the host looks for ─────────────────────
//
// GitHub Pages serves a fallback for an unresolved path ONLY when it is called
// 404.html. Named index.html it is never reached and merely overwrites the
// prerendered `/` page — which the build has been printing a warning about all
// along ("Consider using a different name for the fallback").
//
// /studio/insights/team/[teamNumber] sets prerender = false, so it has no built
// page and depends entirely on this. Every team detail page 404d in production,
// and the Insights table makes team numbers links, so it is the obvious thing to
// click.
{
	const cfg = readFileSync(path.join(root, 'svelte.config.js'), 'utf8').replace(
		/\/\/.*$|\/\*[\s\S]*?\*\//gm,
		''
	);
	ok(
		'the static fallback is 404.html, which is the name a static host looks for',
		/fallback:\s*'404\.html'/.test(cfg),
		`fallback is ${/fallback:\s*'([^']+)'/.exec(cfg)?.[1] ?? '(unset)'} — index.html is never served for an unresolved path`
	);
}

// ─── a keyboard user can always see where they are ─────────────────────────
//
// Eight components shipped with interactive elements and no :focus-visible.
// The failure is invisible to a mouse, so it survives review indefinitely — and
// the fix is not "add a rule to each", which drifts the moment someone writes
// the ninth. One zero-specificity baseline in the layout covers everything and
// loses to any component that wants its own.
//
// Testing for `:where(` alone does NOT work: Svelte emits its own
// `:where(.svelte-hash)` for scoping, so that matched every scoped rule in the
// file and the assertion passed with the baseline narrowed to `a` and the
// :where() removed. Mutation testing caught it. What actually distinguishes the
// baseline is that ONE selector covers several element types at once.
{
	const r = rules('src/routes/+layout.svelte');
	const covers = (sel, tag) => new RegExp(`(^|[\\s,(])${tag}[\\s,:)]`).test(sel);
	const baseline = r.find(
		(x) =>
			/focus-visible/.test(x.selector) &&
			['button', 'input', 'textarea', 'select'].every((t) => covers(x.selector, t))
	);
	ok(
		'one focus ring covers every interactive element',
		Boolean(baseline),
		'no single :focus-visible rule covers button, input, textarea and select'
	);
	ok(
		'and it draws with the accent token',
		/var\(--accent\)/.test(valueOf(baseline?.body ?? '', 'outline') ?? ''),
		valueOf(baseline?.body ?? '', 'outline') ?? '(no outline)'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
