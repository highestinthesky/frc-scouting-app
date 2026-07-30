// Tests for the dialog body formatter.
//   node src/lib/dialog.test.mjs
//
// splitParagraphs lives in format.js rather than dialog.svelte.js, because a
// .svelte.js module is full of runes and cannot be imported outside a Svelte
// runtime. The string handling has edge cases worth pinning down; the promise
// plumbing around it does not.

import { splitParagraphs } from './format.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(want);
	if (a === b) pass += 1;
	else {
		fail += 1;
		console.log(`  FAIL: ${name}\n    got  ${a}\n    want ${b}`);
	}
};

eq('a blank line starts a new paragraph',
	splitParagraphs('One.\n\nTwo.'), ['One.', 'Two.']);

eq('three or more newlines still make just one break',
	splitParagraphs('One.\n\n\n\nTwo.'), ['One.', 'Two.']);

// Template literals in the call sites wrap across source lines. A single
// newline is a wrap, not a paragraph break, and must not survive into the DOM
// as a hard line ending.
eq('a single newline is collapsed, not a break',
	splitParagraphs('One\nstill one.'), ['One still one.']);

eq('indentation from source templates is collapsed',
	splitParagraphs('One.\n\n    Two   spaced.'), ['One.', 'Two spaced.']);

eq('empty paragraphs are dropped', splitParagraphs('One.\n\n\n\n'), ['One.']);
eq('undefined body is no paragraphs', splitParagraphs(undefined), []);
eq('empty string is no paragraphs', splitParagraphs(''), []);
eq('whitespace-only is no paragraphs', splitParagraphs('   \n\n   '), []);
eq('a non-string is coerced, not thrown at', splitParagraphs(42), ['42']);

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
