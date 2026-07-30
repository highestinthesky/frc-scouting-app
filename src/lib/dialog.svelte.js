// In-app confirm dialogs, replacing the browser's window.confirm().
//
// Why bother: window.confirm() blocks the main thread, can't be styled, reads
// as a browser chrome intrusion rather than part of the app, and in an
// installed iOS PWA it renders with the site's origin in the title — which
// looks like a phishing prompt to anyone paying attention. It is also the one
// piece of UI in this app that ignored the design system entirely.
//
// Usage mirrors the thing it replaces, minus the synchrony:
//
//     if (!(await dialog.confirm({
//         title: 'Publish schedule?',
//         body: 'This replaces the current published schedule.',
//         confirmLabel: 'Publish'
//     }))) return;
//
// One dialog instance lives in +layout.svelte and every page drives it through
// this module, so pages don't each mount their own copy and there is exactly
// one thing on screen at a time.

import { splitParagraphs } from './format.js';

/**
 * @typedef {object} DialogRequest
 * @property {string} title            Short, and a question if it is a confirm.
 * @property {string} [body]           Blank lines split into paragraphs.
 * @property {string} [confirmLabel]   Verb. "Publish", "Delete" — never "OK".
 * @property {string} [cancelLabel]
 * @property {boolean} [danger]        Destructive: styles the confirm as danger.
 */

/** Fresh object each time — a shared literal would hand every reset the same
 *  array instance, which is fine until something mutates it. */
const closed = () => ({
	open: false,
	title: '',
	paragraphs: /** @type {string[]} */ ([]),
	confirmLabel: 'Confirm',
	cancelLabel: 'Cancel',
	danger: false
});

const state = $state(closed());

/** Resolver for the promise handed to the caller; null when nothing is open. */
let resolve = /** @type {((v: boolean) => void) | null} */ (null);

function settle(value) {
	const r = resolve;
	resolve = null;
	Object.assign(state, closed());
	// Resolve after clearing state so a caller that immediately opens another
	// dialog isn't fighting the close of this one.
	if (r) r(value);
}

export const dialog = {
	get open() {
		return state.open;
	},
	get title() {
		return state.title;
	},
	get paragraphs() {
		return state.paragraphs;
	},
	get confirmLabel() {
		return state.confirmLabel;
	},
	get cancelLabel() {
		return state.cancelLabel;
	},
	get danger() {
		return state.danger;
	},

	/**
	 * Ask the user to confirm. Resolves true if they confirmed, false for
	 * cancel, Escape, or a backdrop click — same contract as window.confirm(),
	 * so call sites read the same way.
	 *
	 * @param {DialogRequest} req
	 * @returns {Promise<boolean>}
	 */
	confirm(req) {
		// Two dialogs at once shouldn't be possible from a single tap, but if it
		// happens, decline the older one rather than leaving its promise pending
		// forever — an un-settled promise here means a caller hangs silently.
		if (resolve) settle(false);
		return new Promise((res) => {
			resolve = res;
			Object.assign(state, {
				open: true,
				title: req.title,
				paragraphs: splitParagraphs(req.body),
				confirmLabel: req.confirmLabel ?? 'Confirm',
				cancelLabel: req.cancelLabel ?? 'Cancel',
				danger: Boolean(req.danger)
			});
		});
	},

	/** Called by the Dialog component. Not for pages. */
	_accept: () => settle(true),
	/** Called by the Dialog component. Not for pages. */
	_dismiss: () => settle(false)
};
