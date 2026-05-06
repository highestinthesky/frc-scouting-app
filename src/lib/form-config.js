// Defines the fields that appear on the entry form.
//
// To change what scouts capture, edit this file. The form, the export
// format, and the manager view all read from here, so a single edit
// here updates everything.
//
// Field types currently supported:
//   number       — numeric input (validated)
//   text         — single-line text
//   textarea     — multi-line text
//   select       — dropdown, requires `options`
//   pills        — tap-one-of choice, requires `options` (nicer on phones than select)
//   autocomplete — text input that suggests previously-used values from the local DB.
//                  Set `suggestKey` to the observations key whose distinct prior values
//                  populate the suggestion list.
//   boolean      — yes/no toggle (renders as a switch)
//
// Put `required: true` on fields that must be filled.

/**
 * @typedef {object} Field
 * @property {string} key            unique key, used as the property name on the entry
 * @property {string} label          shown above the input
 * @property {'number'|'text'|'textarea'|'select'|'pills'|'autocomplete'|'boolean'} type
 * @property {boolean} [required]
 * @property {string[]} [options]    for select / pills
 * @property {string} [placeholder]
 * @property {string} [help]         small grey text shown under the label
 * @property {string} [suggestKey]   for autocomplete: which observations key to source suggestions from
 * @property {string} [tagSource]    for textarea: render top-used phrases (from this observations key) as one-tap pills above the input
 */

/** Identity fields — what match / which robot. */
/** @type {Field[]} */
export const IDENTITY_FIELDS = [
	{
		key: 'matchNumber',
		label: 'Qualifier #',
		type: 'number',
		required: true,
		placeholder: 'e.g. 14'
	},
	{
		key: 'teamNumber',
		label: 'Team #',
		type: 'number',
		required: true,
		placeholder: 'e.g. 1234'
	},
	{
		key: 'allianceColor',
		label: 'Alliance',
		type: 'pills',
		required: true,
		options: ['red', 'blue']
	}
];

/** Observation fields — what the scout saw. */
/** @type {Field[]} */
export const OBSERVATION_FIELDS = [
	{
		key: 'autoPathing',
		label: 'Auto pathing',
		type: 'autocomplete',
		required: false,
		suggestKey: 'autoPathing',
		placeholder: 'e.g. Center start → left scoring',
		help: 'Pick a path you used before, or type a new one.'
	},
	{
		key: 'strengths',
		label: 'Strengths',
		type: 'textarea',
		required: false,
		placeholder: 'What did they do well?',
		tagSource: 'strengths'
	},
	{
		key: 'weaknesses',
		label: 'Weaknesses',
		type: 'textarea',
		required: false,
		placeholder: 'What did they struggle with?',
		tagSource: 'weaknesses'
	},
	{
		key: 'defense',
		label: 'Defense played',
		type: 'textarea',
		required: false,
		placeholder: 'Did they play defense? How well?',
		help: 'Optional.',
		tagSource: 'defense'
	},
	{
		key: 'brokeDown',
		label: 'Did it break down?',
		type: 'boolean',
		required: false,
		help: 'Toggle on if anything failed mid-match.'
	},
	{
		key: 'comments',
		label: 'Additional comments',
		type: 'textarea',
		required: false,
		placeholder: 'Anything else worth knowing?',
		help: 'Optional.'
	}
];

/** All fields in the order they appear on the form. */
export const ALL_FIELDS = [...IDENTITY_FIELDS, ...OBSERVATION_FIELDS];

/**
 * Bumped to 2: replaced the free-text `failures` textarea with a boolean
 * `brokeDown` toggle plus a separate `comments` textarea. Old entries with
 * `observations.failures` still display correctly thanks to compatibility
 * shims in import.js, aggregate.js, and the entry render paths.
 */
export const SCHEMA_VERSION = 2;
