// Defines the fields that appear on the entry form.
//
// To change what scouts capture, edit this file. The form, the export
// format, and the manager view all read from here, so a single edit
// here updates everything.
//
// Field types currently supported:
//   number       — numeric input (validated)
//   counter      — tap −/+ stepper. Blank means "not recorded", which is a
//                  different fact from a recorded 0. Use for anything countable.
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
 * @property {'number'|'counter'|'text'|'textarea'|'select'|'pills'|'autocomplete'|'boolean'} type
 * @property {boolean} [required]
 * @property {string[]} [options]    for select / pills
 * @property {string} [placeholder]
 * @property {string} [help]         small grey text shown under the label
 * @property {string} [suggestKey]   for autocomplete: which observations key to source suggestions from
 * @property {string} [tagSource]    for textarea: render top-used phrases (from this observations key) as one-tap pills above the input
 * @property {number} [max]          for counter: upper clamp
 * @property {boolean} [higherIsBetter]  for counter: which direction is good. Drives
 *                                       leader highlighting in compare and the sign of
 *                                       the picklist weight. Defaults to true.
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

/**
 * Numeric metrics — the countable part of a match.
 *
 * Deliberately game-agnostic: FRC changes the scoring elements every January,
 * so these are named for what a scout physically counts rather than for this
 * season's game pieces. Retune the labels and `max` values each kickoff; the
 * form, the CSV export, the aggregation engine and every manager surface read
 * from this array, so editing here is the only change needed.
 *
 * Keep the list short. A scout has ~2.5 minutes and one pair of eyes, and a
 * metric nobody reliably records is worse than no metric at all.
 *
 * @type {Field[]}
 */
export const METRIC_FIELDS = [
	{
		key: 'autoScored',
		label: 'Auto scored',
		type: 'counter',
		max: 20,
	},
	{
		key: 'teleopScored',
		label: 'Teleop scored',
		type: 'counter',
		max: 99
	},
	{
		key: 'cycles',
		label: 'Cycles',
		type: 'counter',
		max: 40,
	},
	{
		key: 'missed',
		label: 'Missed / dropped',
		type: 'counter',
		max: 40,
		higherIsBetter: false
	}
];

/** Qualitative fields — what the scout saw but can't put a number on. */
/** @type {Field[]} */
export const NOTE_FIELDS = [
	{
		key: 'autoPathing',
		label: 'Auto pathing',
		type: 'autocomplete',
		required: false,
		suggestKey: 'autoPathing',
		placeholder: 'e.g. Center start → left scoring',
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
		type: 'defense-entry',
		required: false
	},
	{
		key: 'brokeDown',
		label: 'Did it break down?',
		type: 'boolean',
		required: false
	},
	{
		key: 'comments',
		label: 'Additional comments',
		type: 'textarea',
		required: false,
		placeholder: 'Anything else worth knowing?'
	}
];

/**
 * Everything stored under `entry.observations`, counts first. Anything that
 * iterates the whole observation set (save, edit, CSV export) uses this.
 */
export const OBSERVATION_FIELDS = [...METRIC_FIELDS, ...NOTE_FIELDS];

/** All fields in the order they appear on the form. */
export const ALL_FIELDS = [...IDENTITY_FIELDS, ...OBSERVATION_FIELDS];

/** Metric keys, for callers that want to iterate numeric fields only. */
export const METRIC_KEYS = METRIC_FIELDS.map((f) => f.key);

/**
 * Look up a metric's config by key. Returns undefined for non-metric keys.
 * @param {string} key
 * @returns {Field|undefined}
 */
export function metricField(key) {
	return METRIC_FIELDS.find((f) => f.key === key);
}

/**
 * 3: added METRIC_FIELDS (numeric counters).
 * 2: replaced the free-text `failures` textarea with a boolean `brokeDown`
 *    toggle plus a separate `comments` textarea.
 *
 * Entries recorded under an older version are missing the newer keys. Every
 * read path treats a missing key as "not recorded" rather than 0, so old data
 * stays valid — it just doesn't contribute to metric averages.
 */
export const SCHEMA_VERSION = 3;
