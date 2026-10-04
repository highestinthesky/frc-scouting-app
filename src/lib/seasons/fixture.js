// The 1999 season — THROWAWAY. Data only.
//
// This season does not exist. It is deliberately unlike 2026 in every way the
// framework claims to support, so that a framework which is secretly 2026-shaped
// has somewhere to fail: a squarer field, an asymmetric one, no start
// constraint at all, a different auto length, four start bands instead of three,
// five actions on a different set of keys, a cycle that is not collect-and-score,
// and an endgame that is not a climb.
//
// Switching `CURRENT_SEASON` in `./index.js` to `1999` is how a change to the
// framework is proven. If the recorder, the replay and the stats all still work
// with this file and no other edit, nothing 2026-specific has leaked into them.
// If one only works with 2026, it is wrong.
//
// Nothing here is a game manual's number. Every value was picked to be unlike
// its 2026 counterpart, and the obstacles are deliberately NOT mirrored — a
// framework that assumes the field is symmetric would draw this one wrong.

/** @type {import('./index.js').SeasonSpec} */
export default {
	year: 1999,
	name: 'THROWAWAY',
	fieldVersion: 1,
	autoMs: 20_000,
	field: {
		lengthIn: 480,
		widthIn: 360,
		robotIn: 30,
		obstacles: [
			{ kind: 'rect', label: 'pillar', x: 0.35, y: 0.3, w: 0.06, h: 0.08 },
			{ kind: 'rect', label: 'wall', x: 0.62, y: 0.7, w: 0.04, h: 0.3 }
		],
		features: [
			{ kind: 'rect', label: 'pad', look: 'outline', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
			{ kind: 'line', label: 'mid line', look: 'dashed', x: 0.5 }
		],
		allianceBands: [
			{ end: 'near', x: 0.05, w: 0.1 },
			{ end: 'far', x: 0.95, w: 0.1 }
		],
		// Starts are not constrained at all: a robot may begin anywhere it fits.
		startDepth: null,
		startBands: [
			{ label: 'Far left', upTo: 0.2 },
			{ label: 'Left', upTo: 0.5 },
			{ label: 'Right', upTo: 0.8 },
			{ label: 'Far right', upTo: 1 }
		]
	},
	actions: [
		{ key: 'grab', label: 'Grab', doing: 'Grabbing', hotkey: 'a', icon: null, tone: 'accent' },
		{
			key: 'place',
			label: 'Place',
			doing: 'Placing',
			hotkey: 's',
			icon: null,
			tone: 'success',
			questions: [
				{
					key: 'lvl',
					ask: 'Which level?',
					role: 'level',
					options: [
						{ value: 1, label: 'Low', says: 'low' },
						{ value: 2, label: 'Mid', says: 'mid' },
						{ value: 3, label: 'High', says: 'high' }
					]
				},
				{
					key: 'node',
					ask: 'Which node?',
					options: [
						{ value: 'L', label: 'Left', says: 'left node' },
						{ value: 'C', label: 'Centre', says: 'centre node' },
						{ value: 'R', label: 'Right', says: 'right node' }
					]
				}
			]
		},
		{ key: 'bumped', label: 'Bumped', doing: 'Bumped', hotkey: 'd', icon: 'fault', tone: 'warning', role: 'fault' },
		{ key: 'defend', label: 'Defend', doing: 'Defending', hotkey: 'f', icon: null, tone: 'accent' },
		{
			key: 'park',
			label: 'Park',
			doing: 'Parking',
			hotkey: 'g',
			icon: null,
			tone: 'accent',
			ends: true,
			questions: [
				{
					key: 'spot',
					ask: 'Where?',
					options: [
						{ value: 'A', label: 'Bay A', says: 'bay A' },
						{ value: 'B', label: 'Bay B', says: 'bay B' }
					]
				}
			]
		}
	],
	cycle: { from: 'grab', to: 'place' }
};
