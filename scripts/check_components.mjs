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

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
