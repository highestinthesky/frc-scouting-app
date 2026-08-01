// WCAG AA contrast assertions over the real token values.
//   node scripts/check_contrast.mjs      (part of `npm test`)
//
// design.md commits to AA: 4.5:1 for body text, 3:1 for large text and for
// non-text boundaries like a chip border. Those numbers are easy to write down
// and impossible to keep by eye, because every pair has to hold in TWO themes
// and the dark values are not derived from the light ones — they were picked
// by hand.
//
// That is exactly how this project has failed before:
//
//   · --text-faint shipped at 3.54:1 light / 3.42:1 dark. It reads fine on a
//     bright laptop and disappears in a gym.
//   · Alliance fills were hardcoded to the LIGHT values in four places. Dark
//     mode lightens them to #f1746a / #6fa8ec, where the white label on top
//     falls to 2.82 and 2.47 — worse than no styling at all.
//
// Both were found by measuring, not by looking. So measure, every commit.
//
// Only pairs the app actually renders are listed. A table of every possible
// combination would be mostly noise and would fail on pairs nobody ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const layout = readFileSync(path.join(root, 'src/routes/+layout.svelte'), 'utf8');

/** Token declarations inside one CSS block, by its opening selector. */
function block(startPattern) {
	const i = layout.search(startPattern);
	if (i === -1) throw new Error(`token block not found: ${startPattern}`);
	const open = layout.indexOf('{', i);
	let depth = 0;
	let end = open;
	for (let j = open; j < layout.length; j += 1) {
		if (layout[j] === '{') depth += 1;
		else if (layout[j] === '}') {
			depth -= 1;
			if (depth === 0) {
				end = j;
				break;
			}
		}
	}
	const body = layout.slice(open, end);
	return Object.fromEntries(
		[...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
	);
}

const light = block(/:global\(:root\)\s*\{/);
// One dark block, keyed on an explicit attribute. "system" is resolved to
// light|dark in JS (app.html pre-paint, +layout.svelte thereafter) precisely so
// this palette is written down once — there were two copies, and they had
// already drifted.
const dark = { ...light, ...block(/:global\(:root\[data-theme='dark'\]\)\s*\{/) };

// ─── colour maths ──────────────────────────────────────────────────────────

function parse(css) {
	const hex = /^#([0-9a-f]{3,8})$/i.exec(css.trim());
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = [...h].map((c) => c + c).join('');
		return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
	}
	const rgba = /^rgba?\(([^)]+)\)$/i.exec(css.trim());
	if (rgba) {
		const parts = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number);
		return parts.slice(0, 3);
	}
	throw new Error(`cannot parse colour: ${css}`);
}

const luminance = (rgb) => {
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
	const [hi, lo] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

// ─── the pairs the app renders ─────────────────────────────────────────────
//
// [ink, surface, floor, what it is]
// 4.5 = body text. 3.0 = large text (>=24px or >=19px bold) and UI boundaries.

const PAIRS = [
	['--text-primary', '--bg-page', 4.5, 'body text on the page'],
	['--text-primary', '--bg-card', 4.5, 'body text on a card'],
	['--text-primary', '--bg-subtle', 4.5, 'body text on a subtle fill'],
	['--text-muted', '--bg-page', 4.5, 'secondary text'],
	['--text-muted', '--bg-card', 4.5, 'secondary text on a card'],
	['--text-muted', '--bg-subtle', 4.5, 'secondary text on a chip'],
	// The smallest type in the app (--fs-xs, 12px) uses this. It is body text
	// by WCAG's definition, so it gets the full 4.5 — it shipped at 3.54 once.
	['--text-faint', '--bg-page', 4.5, 'timestamps and counts'],
	['--text-faint', '--bg-card', 4.5, 'timestamps on a card'],
	['--text-faint', '--bg-subtle', 4.5, 'timestamps on a chip'],

	['--accent', '--bg-page', 4.5, 'links and match numbers'],
	['--accent', '--bg-card', 4.5, 'links on a card'],
	['--accent', '--bg-subtle', 4.5, 'links on a subtle fill'],
	['--accent', '--accent-soft', 4.5, 'accent text in an accent chip'],
	['--on-accent', '--accent', 4.5, 'label on a primary button'],
	['--on-accent', '--accent-hover', 4.5, 'label on a hovered primary button'],

	// Added when the hardcoded alliance literals came out. In dark mode the
	// fills lighten, so the ink has to darken — white would be 2.47 on blue.
	['--on-alliance', '--alliance-red', 4.5, 'label on a red alliance fill'],
	['--on-alliance', '--alliance-blue', 4.5, 'label on a blue alliance fill'],
	['--alliance-red', '--bg-card', 4.5, 'red alliance text'],
	['--alliance-blue', '--bg-card', 4.5, 'blue alliance text'],
	['--alliance-blue', '--banner-blue-bg', 4.5, 'blue text in a blue banner'],
	['--alliance-red', '--banner-red-bg', 4.5, 'red text in a red banner'],

	['--danger', '--bg-card', 4.5, 'error text'],
	['--danger', '--danger-bg', 4.5, 'error text in an error banner'],
	['--success', '--bg-card', 4.5, 'success text'],
	['--success', '--success-bg', 4.5, 'success text in a success banner'],
	['--warning', '--bg-card', 4.5, 'warning text'],
	['--warning', '--warning-bg', 4.5, 'warning text in a warning banner'],

	// The app bar is fixed purple in both themes, so these do not vary.
	['--bar-ink', '--bar-bg', 4.5, 'app bar text'],
	['--bar-badge-ink', '--bar-badge-bg', 4.5, 'manager badge'],
	['--pending-ink', '--dot-pending', 4.5, 'unsynced count bubble'],

	// Non-text: a boundary only has to be distinguishable, not readable.
	['--border-strong', '--bg-card', 3.0, 'input outline'],
	['--border-strong', '--bg-page', 3.0, 'input outline on the page'],
	['--accent', '--bg-card', 3.0, 'focus ring'],
	// Deliberately absent: --warning-border on --warning-bg and --success-border
	// on --success-bg. WCAG 1.4.11 covers boundaries REQUIRED to identify a
	// component. A banner is identified by its fill and its text; delete the
	// border and nothing is lost. Holding decoration to 3:1 would force these
	// tints dark enough to read as errors.
];

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
	if (cond) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}${detail ? '\n        ' + detail : ''}`);
	}
};

for (const [theme, tokens] of [
	['light', light],
	['dark', dark]
]) {
	for (const [ink, surface, floor, what] of PAIRS) {
		const a = tokens[ink];
		const b = tokens[surface];
		if (!a || !b) {
			ok(`${theme}: ${ink} on ${surface}`, false, `token missing: ${!a ? ink : surface}`);
			continue;
		}
		const r = ratio(a, b);
		ok(
			`${theme}: ${what} — ${ink} on ${surface}`,
			r >= floor,
			`${r.toFixed(2)}:1, needs ${floor.toFixed(1)}:1  (${a} on ${b})`
		);
	}
}

// A second palette block must not come back. The obvious "fix" for the
// pre-paint problem is to re-add @media (prefers-color-scheme: dark) with a
// copy of the dark tokens — and that copy is what drifted last time. It was
// missing --on-alliance, so a scout on OS-level dark got white text on a light
// blue pill while a scout who picked dark in Settings got the correct ink, and
// neither could reproduce what the other was seeing.
//
// Matches the CSS at-rule only. The layout also calls window.matchMedia with
// the same string, which is the mechanism that replaced the duplicate.
{
	// Comments stripped first. The comment three lines above the dark block
	// explains why the media query was removed — and matched this check, which
	// is the second time a checker in this repo has failed against its own
	// prose. Search the code, not the commentary.
	const code = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const dupes = [...code.matchAll(/@media[^{]*prefers-color-scheme/g)].length;
	ok(
		'the dark palette is defined in exactly one place',
		dupes === 0,
		`+layout.svelte has ${dupes} @media(prefers-color-scheme) block(s). The theme ` +
			'is resolved to an explicit data-theme in JS — a media query here would be a second copy.'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
