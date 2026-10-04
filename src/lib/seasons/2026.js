// The 2026 season — REBUILT. Data only.
//
// A season file is the game, written down: the field it is played on and what a
// robot can do on it during auto. It holds no logic. The geometry that reads
// these numbers is `../field.js` and the track format that stores the actions is
// `../auto-track.js`; `./index.js` validates this object and builds it.
//
// ADR-002 Decision 5: one field per season, checked in beside METRIC_FIELDS,
// with its own version. The January retune ritual gains a step — update the
// geometry, update the action set, update the legal region, bump
// SCHEMA_VERSION.
//
// ─── everything below is derived from FIRST's published dimensions ─────────
//
// Not traced from a field image, and that is the better outcome rather than a
// compromise: the picture and the collision test read the SAME numbers, so they
// cannot drift, which is the whole reason the ADR asked for regions "derived
// from it rather than maintained as a parallel list of rectangles". A trace
// would have put a bitmap on one side of that line and a hand-kept list on the
// other.
//
// Sources, so the next person can check rather than trust:
//   Field Dimension Drawings  https://www.firstinspires.org/resource-library/frc/playing-field
//   Game Manual, ARENA        https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf
//
// ─── what a placeholder got wrong, for the record ──────────────────────────
//
// The first version of this field was a schematic guess, and it was wrong in
// three ways that matter, all of which would have taught scouts a field that
// does not exist:
//
//   - It had ONE obstacle at field centre. There are TWO HUBs, one per alliance,
//     each 158.6in from ITS OWN alliance wall. Nothing is at the centre line.
//   - The HUB is a 47in square, not a circle.
//   - It would have been natural to add the BUMPs and TRENCHes as obstacles.
//     They are not. A robot drives OVER a BUMP and UNDER a TRENCH, so both are
//     landmarks and neither blocks a path.
//
// Every position below is in the coordinate system `../field.js` describes:
// fractions of the FULL field, (0,0) the red alliance wall's left corner, x
// running red wall → blue wall.

// ─── inches, exactly as published ──────────────────────────────────────────
//
// Kept in inches and converted once, at the bottom. Fractions are unreadable to
// anyone holding the drawings, and "0.2435" cannot be checked against a manual.

/** Carpet, alliance wall to alliance wall. 54 ft 3 in. */
const FIELD_LENGTH_IN = 54 * 12 + 3;
/** Carpet, guardrail to guardrail. 26 ft 3 in. */
const FIELD_WIDTH_IN = 26 * 12 + 3;

/** NEUTRAL ZONE depth, between the two ROBOT STARTING LINES. */
const NEUTRAL_ZONE_IN = 283;

// ─── the alliance zone is DERIVED, and that is deliberate ──────────────────
//
// The manual states 158.6in twice — once as the ALLIANCE ZONE depth and once as
// the distance from an ALLIANCE WALL to that alliance's HUB centre. Its own
// numbers contradict it:
//
//     158.6 + 283 + 158.6 = 600.2,  and the field is 651
//
// Fifty-one inches unaccounted for. Deriving the depth instead makes the three
// zones tile the field exactly, and lands on 184.0in — which is where the HUB
// bands sit on the team's own field image, measured at about 0.282 of the field
// length. Two independent signals agree and the quoted figure is the outlier, so
// the quoted figure is the one not used.
//
// If 158.6 turns out to measure something real — a face rather than a centre,
// or a zone that excludes the BUMP band — this is the line to change, and
// nothing else moves with it.
const ALLIANCE_ZONE_IN = (FIELD_LENGTH_IN - NEUTRAL_ZONE_IN) / 2;

/** The HUB: a 47in square, centred on the starting line, one per alliance. */
const HUB_SIZE_IN = 47;
/** Its opening, which is what a top-down view of the field actually shows. */
const HUB_OPENING_IN = 41.7;

/** TOWER: in the ALLIANCE WALL between the driver stations. RUNGs at 27/45/63in. */
const TOWER_WIDTH_IN = 90;
const TOWER_DEPTH_IN = 12;

/** BUMP: driven OVER. 73in wide, 44.4in deep, 6.5in tall. Landmark, not wall. */
const BUMP_WIDTH_IN = 73;
const BUMP_DEPTH_IN = 44.4;

/** TRENCH: driven UNDER. Guardrail to BUMP, on both sides. 47in deep. */
const TRENCH_DEPTH_IN = 47;

/** DEPOT: 42in x 27in, along the alliance wall. */
const DEPOT_WIDTH_IN = 42;
const DEPOT_DEPTH_IN = 27;

// ─── the robot ─────────────────────────────────────────────────────────────
//
// FRAME PERIMETER at most 120in, STARTING CONFIGURATION at most 30in tall. A
// square robot at the limit is 30in a side. Bumpers add roughly 3.25in per side
// — a 3/4in backing, a pool noodle, and fabric — so the thing that actually
// occupies carpet is about 36.5in across.
//
// That is what everything here measures, because BUMPERS are what the rules
// measure: G303 places a robot by where its BUMPERS are, and a robot cannot
// drive its bumpers through a wall.
const FRAME_PERIMETER_IN = 120;
const BUMPER_THICKNESS_IN = 3.25;
/** A square robot at the perimeter limit, with bumpers. 36.5in. */
const ROBOT_SIZE_IN = FRAME_PERIMETER_IN / 4 + 2 * BUMPER_THICKNESS_IN;
const HALF_ROBOT_IN = ROBOT_SIZE_IN / 2;

// ─── laterally ─────────────────────────────────────────────────────────────
//
// The HUB is centred across the width with a BUMP either side, and the TRENCHes
// run from each guardrail to the outer BUMP edge. That fills the width exactly,
// which is also the check that this reading of the manual is right:
//
//     47 (HUB) + 2 x 73 (BUMPs) + 2 x 62.35 (TRENCHes) = 317.7
//
// The manual gives the TRENCH as 65.65in wide against the 62.35 the layout
// leaves. A 3.3in difference is which face is being measured, so the derived
// number is used — a width that sums is worth more here than one that is quoted.

const MID_W = FIELD_WIDTH_IN / 2;
const HUB_HALF = HUB_SIZE_IN / 2;
const BUMP_OUTER = HUB_HALF + BUMP_WIDTH_IN;

// ─── fractions, derived ────────────────────────────────────────────────────
//
// Local to this file on purpose. `../field.js` derives its own fractions
// (half a robot, the aspect) from `lengthIn`/`widthIn`/`robotIn` with the same
// arithmetic, so a position computed here and a margin computed there agree to
// the last bit.

const fx = (inches) => inches / FIELD_LENGTH_IN;
const fy = (inches) => inches / FIELD_WIDTH_IN;

const mirrorX = (o) => ({ ...o, x: 1 - o.x, label: `far ${o.label}` });

/** One alliance's structures, measured from ITS OWN wall. */
const nearSide = [
	{
		kind: 'rect',
		label: 'hub',
		x: fx(ALLIANCE_ZONE_IN),
		y: 0.5,
		w: fx(HUB_SIZE_IN),
		h: fy(HUB_SIZE_IN),
		// The opening is what a top-down view shows inside the square footprint.
		opening: fy(HUB_OPENING_IN)
	},
	{
		kind: 'rect',
		label: 'depot',
		x: fx(DEPOT_DEPTH_IN / 2),
		y: fy(MID_W),
		w: fx(DEPOT_DEPTH_IN),
		h: fy(DEPOT_WIDTH_IN)
	}
];

/** One alliance's landmarks. Driven over, driven under, or painted on. */
const nearMarks = [
	{
		kind: 'rect',
		label: 'bump',
		look: 'landmark',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy(MID_W - HUB_HALF - BUMP_WIDTH_IN / 2),
		w: fx(BUMP_DEPTH_IN),
		h: fy(BUMP_WIDTH_IN)
	},
	{
		kind: 'rect',
		label: 'bump',
		look: 'landmark',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy(MID_W + HUB_HALF + BUMP_WIDTH_IN / 2),
		w: fx(BUMP_DEPTH_IN),
		h: fy(BUMP_WIDTH_IN)
	},
	{
		kind: 'rect',
		label: 'trench',
		look: 'outline',
		x: fx(ALLIANCE_ZONE_IN),
		y: fy((MID_W - BUMP_OUTER) / 2),
		w: fx(TRENCH_DEPTH_IN),
		h: fy(MID_W - BUMP_OUTER)
	},
	{
		kind: 'rect',
		label: 'trench',
		look: 'outline',
		x: fx(ALLIANCE_ZONE_IN),
		y: 1 - fy((MID_W - BUMP_OUTER) / 2),
		w: fx(TRENCH_DEPTH_IN),
		h: fy(MID_W - BUMP_OUTER)
	},
	{
		kind: 'rect',
		label: 'tower',
		look: 'wall',
		x: fx(TOWER_DEPTH_IN / 2),
		y: 0.5,
		w: fx(TOWER_DEPTH_IN),
		h: fy(TOWER_WIDTH_IN)
	},
	{ kind: 'line', label: 'starting line', look: 'solid', x: fx(ALLIANCE_ZONE_IN) }
];

// ─── where a robot may start ───────────────────────────────────────────────
//
// A start is constrained to the ALLIANCE ZONE — the robot's own end of the
// field, from its alliance wall out to the ROBOT STARTING LINE — and not to the
// line itself. `startDepth` below is that zone's depth; `clampToStart` in
// `../field.js` is what enforces it.
//
// It was pinned to the line, on a reading of G303-D that treated "its BUMPERS
// overlap their ROBOT STARTING LINE" as the only legal placement. The team says
// otherwise: behind the hub is a real start, and they are the ones who watch
// these matches. The tighter reading made a position a scout had actually seen
// impossible to record.
//
// Which is the same argument this file already makes one paragraph down about
// point E, and it generalises: THIS IS A RECORDING AID, NOT A REFEREE. The
// constraint that earns its place is the one that rules out what could not have
// happened — a robot cannot be inside the HUB, and cannot have started at the
// far end of the field — not the one that enforces a rule the app has only
// inferred. Where the two disagree, the scout saw it and this file did not.
//
// `clampToStart()` in `../field.js` lets a start reach half a robot past the
// line, so a robot straddling it is still expressible: that placement is legal and common, and clamping to the
// line exactly would have made it unreachable from the wrong side.
//
// Point E — "it's not contacting the BUMP" — is likewise NOT enforced. The
// lateral BUMP extents here are derived from a width that sums rather than
// measured off a drawing, and hard-blocking a placement on an inferred number
// would fight a scout who watched a robot start somewhere this file is wrong
// about. The BUMPs are drawn; a scout can see them.

/**
 * Start bands, named from the perspective of a member of that alliance.
 *
 * The plan is explicit about both the perspective and the anchor: "behind the
 * hub for this season would be considered Middle". So Middle is the HUB's own
 * lateral footprint, widened by half a robot on each side — a robot overlapping
 * the hub's shadow is behind the hub. Left and Right are what remains, and they
 * land almost exactly on the BUMP/TRENCH boundaries, which is the same thing a
 * driver would say out loud.
 *
 * Derived rather than picked, so moving the HUB moves the bands with it.
 */
const MIDDLE_HALF = fy(HUB_HALF + HALF_ROBOT_IN);

/** @type {import('./index.js').SeasonSpec} */
export default {
	year: 2026,
	name: 'REBUILT',

	/** Bump when the geometry moves. Dates the picture; stored on nothing. */
	fieldVersion: 4,

	// Every track recorded before tracks carried their season was drawn on THIS
	// field — 2026 is the only game the recorder has ever known. So a track with
	// no stamp is a 2026 track, and this season is the one that claims it.
	claimsUnstampedTracks: true,

	/** AUTO is 15 seconds. */
	autoMs: 15_000,

	field: {
		lengthIn: FIELD_LENGTH_IN,
		widthIn: FIELD_WIDTH_IN,
		robotIn: ROBOT_SIZE_IN,

		/**
		 * Where a robot cannot be.
		 *
		 * A recording aid, not a validation rule: it keeps a thumb from parking the
		 * robot inside the HUB, which is a different thing from rejecting a scout's
		 * input. Rectangles in full-field fractions, `x`/`y` being the centre.
		 *
		 * Both HUBs are here, and both are drawn whole. Each is centred on its own
		 * alliance's starting line — which is also why a robot dragged to the
		 * middle of a starting line has to slide sideways or back rather than off
		 * it; see clampToStart in `../field.js`.
		 *
		 * Both ends, because the whole field is drawn — a robot that crossed the
		 * centre line in auto is doing something legal and has to be recordable
		 * where it went.
		 */
		obstacles: [...nearSide, ...nearSide.map(mirrorX)],

		/**
		 * Drawn for orientation, driven straight through.
		 *
		 * These are the difference between a grey box and a field a scout
		 * recognises, and keeping them OUT of the obstacles is the point: a BUMP is
		 * driven over and a TRENCH is driven under, so a robot's path crosses both
		 * and a collision test that stopped it there would be fighting the scout.
		 */
		features: [
			...nearMarks,
			...nearMarks.map((m) => (m.kind === 'line' ? { ...m, x: 1 - m.x, label: 'far starting line' } : mirrorX(m))),
			// No FUEL staging area. It was read off the field image, it is not
			// something a robot's position is ever measured against, and a large soft
			// rectangle across the middle of the picture competes with the path being
			// drawn over it.
			{ kind: 'line', label: 'centre line', look: 'dashed', x: 0.5 }
		],

		/**
		 * Which end of the field belongs to an alliance, as a drawn band.
		 *
		 * The team's field image tints the whole BUMP-HUB-BUMP column in the
		 * alliance's colour, and it is the single thing that makes the picture
		 * readable at a glance: it says which end is yours without a label.
		 * Returned as drawn bounds so the renderer does not have to know the
		 * geometry.
		 */
		allianceBands: [
			{ end: 'near', x: fx(ALLIANCE_ZONE_IN), w: fx(BUMP_DEPTH_IN) },
			{ end: 'far', x: 1 - fx(ALLIANCE_ZONE_IN), w: fx(BUMP_DEPTH_IN) }
		],

		/** Distance from the alliance wall to the ROBOT STARTING LINE, as a fraction. */
		startDepth: fx(ALLIANCE_ZONE_IN),

		startBands: [
			{ label: 'Left', upTo: 0.5 - MIDDLE_HALF },
			{ label: 'Middle', upTo: 0.5 + MIDDLE_HALF },
			{ label: 'Right', upTo: 1 }
		]
	},

	// ─── what a robot can be doing ───────────────────────────────────────────
	//
	// Closed, and versioned with the season alongside METRIC_FIELDS, because what
	// a robot can DO changes every January and a free-text action would be
	// unaggregatable within one event.
	//
	// The hotkeys are A / S / D / F, for the half of the team on a laptop. A
	// drag-only control with hold-to-record buttons is a two-hand job, and on a
	// desktop one of those hands is on the mouse. A / S / D sit under the resting
	// left hand while the right drags, which is the same reason those keys are
	// the movement keys in every game these scouts have played; F is the next
	// finger along.
	actions: [
		{ key: 'collect', label: 'Collect', doing: 'Collecting', hotkey: 'a', icon: 'collect', tone: 'accent' },
		{ key: 'score', label: 'Score', doing: 'Scoring', hotkey: 's', icon: 'score', tone: 'success' },
		{
			// `fault` is the plan's "disrupted from its original path". It is
			// deliberately not called `broke` — the form already has a `brokeDown`
			// boolean and these are not the same claim: a robot can be knocked off its
			// route and finish fine.
			//
			// Labelled "Off path" because it is short enough to survive a quarter of a
			// phone's width. "Disrupted" truncated to "Disrup…" on the rail, and a
			// control whose label is cut off is a control a scout has to remember
			// rather than read. "Off path" is also closer to what the plan actually
			// describes — "disrupted from its original path" — than a word that sounds
			// like the robot's fault.
			key: 'fault',
			label: 'Off path',
			doing: 'Off path',
			hotkey: 'd',
			icon: 'fault',
			tone: 'warning',
			role: 'fault'
		},
		{
			key: 'climb',
			label: 'Climb',
			doing: 'Climbing',
			hotkey: 'f',
			icon: 'climb',
			tone: 'accent',
			ends: true,
			questions: [
				{
					// How high a robot got on the TOWER, as the rungs are actually built.
					//
					// Three RUNGs at 27, 45 and 63 inches. Stored as the level rather than
					// the height, because the level is what a manager says and the heights
					// are season data that moves every January — the same reason a start
					// ZONE is derived and not stored.
					//
					// Optional: a scout who saw a robot get on the tower but could not tell
					// which rung has recorded something true, and forcing a guess would
					// turn it into something false.
					key: 'lvl',
					ask: 'Which rung?',
					role: 'level',
					unknown: 'rung not recorded',
					options: [
						{ value: 1, label: '1', says: 'rung 1' },
						{ value: 2, label: '2', says: 'rung 2' },
						{ value: 3, label: '3', says: 'rung 3' }
					]
				},
				{
					// Three-state like the rung: a climb nobody judged is not a failed one,
					// so an unanswered `ok` is absent rather than false.
					key: 'ok',
					ask: 'Did it make it?',
					role: 'outcome',
					options: [
						{ value: true, label: 'Made it', says: 'made it' },
						{ value: false, label: 'Failed', says: 'failed' }
					]
				}
			]
		}
	],

	/** A cycle is the first score after a collect. */
	cycle: { from: 'collect', to: 'score' }
};
