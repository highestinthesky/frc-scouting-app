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

// Comments stripped before anything is parsed out of this file. A comment that
// mentions a token by name — "deliberately separate from --accent: this is the
// one that…" — is matched by the declaration regex below, and the value it
// captures then runs to the next semicolon, several lines into real CSS.
//
// This is the THIRD time a checker here has failed against its own commentary,
// and the first two were fixed by rewording the comment. That is the wrong
// repair: it leaves the trap armed for the next person who explains a token by
// naming another one, which is the most natural sentence to write about a
// palette. Strip once, parse the code.
const code = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Token declarations inside one CSS block, by its opening selector. */
function block(startPattern) {
	const i = code.search(startPattern);
	if (i === -1) throw new Error(`token block not found: ${startPattern}`);
	const open = code.indexOf('{', i);
	let depth = 0;
	let end = open;
	for (let j = open; j < code.length; j += 1) {
		if (code[j] === '{') depth += 1;
		else if (code[j] === '}') {
			depth -= 1;
			if (depth === 0) {
				end = j;
				break;
			}
		}
	}
	const body = code.slice(open, end);
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
// Studio remaps the base tokens rather than only adding --studio-* ones, so the
// whole PAIRS table below applies to it unchanged. That is the point of the
// remap and the reason this is three lines instead of a second table: a surface
// Studio renders is a surface the scout app renders, in different colours.
//
// Two of them since v0.75. Studio follows the app theme now, so BOTH have to be
// measured: the light one is a fresh palette where every role inverted, and an
// unmeasured palette is how --border-strong shipped at 2.27 the first time.
const studioLight = { ...light, ...block(/:global\(:root\[data-studio\]\)\s*\{/) };
const studioDark = {
	...dark,
	...block(/:global\(:root\[data-studio\]\[data-theme='dark'\]\)\s*\{/)
};

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
	// The Studio button: outlined at rest, filled with the bar's ink on hover.
	['--bar-edge', '--bar-bg', 3.0, 'the Studio button outline'],
	['--bar-bg', '--bar-ink', 4.5, 'the Studio button label when hovered'],
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

// Studio-only pairings. The palette's whole shape is "three of these four
// cannot carry white text", so what needs asserting is the assignment: the fill
// is the one that can, the series are the ones that are drawn with, and nothing
// has quietly swapped places.
// Studio-only pairings, split by palette because the ROLES INVERT between them.
//
// That inversion is the whole design and it is exactly what a shared table would
// hide. On dark, cyan and aqua are ink and purple is a fill nobody may write on.
// On light it is the reverse: purple is the only one of the four that reads, and
// cyan and aqua are decorative — 1.64 and 1.06 on a raised panel. Asserting them
// as ink in both directions demanded something the light palette must never do.
const STUDIO_PAIRS_SHARED = [
	['--on-studio-fill', '--studio-fill', 4.5, 'the ink the one white-text fill is designed for'],
	// Every series doubles as its own legend label, so each is held to the text
	// floor against both grounds a chart sits on — including the raised panel,
	// which is the hardest case in the light palette and the one nobody checks.
	...[1, 2, 3, 4].flatMap((n) => [
		[`--studio-series-${n}`, '--bg-card', 4.5, `series ${n} on a panel`],
		[`--studio-series-${n}`, '--bg-elev', 4.5, `series ${n} on a raised panel`]
	]),
	// The drawable purple, whichever direction it had to move to become drawable:
	// lifted on dark, darkened on light.
	['--studio-violet', '--bg-card', 4.5, 'the drawable purple as ink'],
	['--studio-violet', '--bg-elev', 4.5, 'the drawable purple on a raised panel']
];

// On DARK the light three become the readable ones — that is what the dark
// ground buys, and it is the reason Studio was dark in the first place.
const STUDIO_PAIRS_DARK = [
	['--studio-cyan', '--bg-elev', 4.5, 'the cyan as ink'],
	['--studio-aqua', '--bg-elev', 4.5, 'the aqua as ink'],
	// Blue is a mark, a border or a fill, never a sentence: it is 4.36 on the
	// raised panel and passes everywhere else, so it would have shipped failing
	// on the one surface nobody checks.
	['--studio-blue', '--bg-elev', 3.0, 'the blue as a mark, not as text']
];

// On LIGHT only the purple reads. Nothing asserts cyan, aqua or the raw blue as
// ink here, because they must not be used as ink here — the darkened
// --studio-series-* are what carry anything that has to be read.
const STUDIO_PAIRS_LIGHT = [
	['--studio-purple', '--bg-card', 4.5, 'the purple as ink'],
	['--studio-purple', '--bg-elev', 4.5, 'the purple on a raised panel']
];


for (const [theme, tokens] of [
	['light', light],
	['dark', dark],
	['studio-light', studioLight],
	['studio-dark', studioDark]
]) {
	const extra = theme.startsWith('studio')
		? [...STUDIO_PAIRS_SHARED, ...(theme === 'studio-dark' ? STUDIO_PAIRS_DARK : STUDIO_PAIRS_LIGHT)]
		: [];
	for (const [ink, surface, floor, what] of [...PAIRS, ...extra]) {
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
	// Searches `code`, not `layout` — the comment three lines above the dark
	// block explains why the media query was removed, and matched this check when
	// it read the raw file. That stripping is now done once at the top, for every
	// search in this script rather than this one.
	const dupes = [...code.matchAll(/@media[^{]*prefers-color-scheme/g)].length;
	ok(
		'the dark palette is defined in exactly one place',
		dupes === 0,
		`+layout.svelte has ${dupes} @media(prefers-color-scheme) block(s). The theme ` +
			'is resolved to an explicit data-theme in JS — a media query here would be a second copy.'
	);
}

// Studio's block has to come after the dark one. `:root[data-theme='dark']` and
// `:root[data-studio]` are both (0,2,0), so specificity does not separate them
// and source order is the entire mechanism. Moving the block up — a tidy-up
// anybody might make, grouping the two palettes "logically" — would leave a
// manager on the dark theme seeing scout colours in Studio, and nothing else in
// the suite would notice: every token still resolves, every pair still passes.
{
	const darkAt = code.search(/:global\(:root\[data-theme='dark'\]\)\s*\{/);
	const studioAt = code.search(/:global\(:root\[data-studio\]\)\s*\{/);
	ok(
		'the light Studio palette is declared after the dark theme palette',
		darkAt !== -1 && studioAt > darkAt,
		'both are (0,2,0) — source order is the only thing deciding which wins, so a ' +
			'manager on the dark theme would otherwise open Studio and get scout colours'
	);

	// The dark Studio block is (0,3,0) and outranks both regardless of order, but
	// it must still exist — without it, a manager on the dark theme gets the LIGHT
	// Studio palette, which is a different bug with the same cause.
	const studioDarkAt = code.search(/:global\(:root\[data-studio\]\[data-theme='dark'\]\)\s*\{/);
	ok(
		'Studio has a dark variant keyed on both attributes',
		studioDarkAt > -1,
		'Studio follows the app theme; the dark variant is what makes that true'
	);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
