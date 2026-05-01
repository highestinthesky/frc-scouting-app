// Defines the fields that appear on the entry form.
//
// To change what scouts capture, edit this file. The form, the export
// format, and the manager view all read from here, so a single edit
// here updates everything.
//
// Field types currently supported:
//   number     — numeric input (validated)
//   text       — single-line text
//   textarea   — multi-line text
//   select     — dropdown, requires `options`
//   pills      — tap-one-of choice, requires `options` (nicer on phones than select)
//
// Put `required: true` on fields that must be filled.

/**
 * @typedef {object} Field
 * @property {string} key            unique key, used as the property name on the entry
 * @property {string} label          shown above the input
 * @property {'number'|'text'|'textarea'|'select'|'pills'} type
 * @property {boolean} [required]
 * @property {string[]} [options]    for select / pills
 * @property {string} [placeholder]
 * @property {string} [help]         small grey text shown under the label
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
		type: 'text',
		required: false,
		placeholder: 'e.g. Center start → left coral',
		help: 'Name the autonomous route they ran this match.'
	},
	{
		key: 'strengths',
		label: 'Strengths',
		type: 'textarea',
		required: false,
		placeholder: 'What did they do well?'
	},
	{
		key: 'weaknesses',
		label: 'Weaknesses',
		type: 'textarea',
		required: false,
		placeholder: 'What did they struggle with?'
	},
	{
		key: 'defense',
		label: 'Defense',
		type: 'textarea',
		required: false,
		placeholder: 'Did they play defense? How well?'
	},
	{
		key: 'failures',
		label: 'Failures',
		type: 'textarea',
		required: false,
		placeholder: 'Anything break or stop working?',
		help: 'Optional — leave blank if nothing failed.'
	}
];

/** All fields in the order they appear on the form. */
export const ALL_FIELDS = [...IDENTITY_FIELDS, ...OBSERVATION_FIELDS];

/** A schema version bumped when this file changes shape — used in exports. */
export const SCHEMA_VERSION = 1;
