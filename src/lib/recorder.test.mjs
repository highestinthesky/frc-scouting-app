// Exercise AutoRecorder's script with the real Svelte runes runtime. The DOM
// and timer scheduler are absent; effects, state, derived values and track
// encoding are real. A controlled clock makes an early stop reproducible.
//   node src/lib/recorder.test.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { encodeTrack, decodeTrack, trackDuration, SAMPLE_HZ } from './auto-track.js';
import { seasonFor, currentSeason } from './seasons/index.js';

const require = createRequire(import.meta.url);
const { compileModule } = require('svelte/compiler');
const runtimeUrl = import.meta.resolve('svelte/internal/client');
const { effect_root } = await import(runtimeUrl);
const { flushSync } = await import(new URL('../../index-client.js', runtimeUrl));

const source = readFileSync(new URL('./components/AutoRecorder.svelte', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
	.replace(/^\timport[\s\S]*?;\n/gm, '')
	.replace('$props()', 'props');
// Compile the actual component script as a factory so each test gets fresh
// state. Only component imports/props/lifecycle are adapted for a DOM-free root.
const harness = `
import { SAMPLE_HZ, encodeTrack, decodeTrack, positionAt, trackDuration, cycleStats, describeAnswers }
  from ${JSON.stringify(new URL('./auto-track.js', import.meta.url).href)};
import { currentSeason } from ${JSON.stringify(new URL('./seasons/index.js', import.meta.url).href)};
// Stands in for $lib/screen.svelte.js, whose import is stripped with the rest.
export const screen = $state({ recorder: false });
export function createRecorder(props = {}) {
  const cleanups = [];
  const onDestroy = (fn) => cleanups.push(fn);
  ${script}
  return {place, begin, tick, finish, press, release, openAnswers, answer, discard,
    cleanup: () => cleanups.forEach((fn) => fn()),
    snapshot: () => ({phase, samples, elapsed, scrub, preview, season})};
}`;
const code = compileModule(harness, { filename: 'recorder-test.svelte.js', generate: 'client' }).js.code
	.replaceAll("'svelte/internal/client'", JSON.stringify(runtimeUrl));
const { createRecorder, screen } = await import('data:text/javascript,' + encodeURIComponent(code));

let pass = 0;
let fail = 0;
function ok(label, condition) {
	if (condition) pass += 1;
	else {
		fail += 1;
		console.error(`FAIL: ${label}`);
	}
}

let clock = 0;
let nextTimer = 0;
const timers = new Set();
const savedGlobals = Object.fromEntries(
	['window', 'performance', 'setInterval', 'clearInterval'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
);
globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
globalThis.performance = { now: () => clock };
globalThis.setInterval = () => { timers.add(++nextTimer); return nextTimer; };
globalThis.clearInterval = (timer) => timers.delete(timer);

function mount(props) {
	let recorder;
	const destroy = effect_root(() => { recorder = createRecorder(props); });
	flushSync();
	return { recorder, destroy: () => { recorder.cleanup(); destroy(); } };
}

try {
	// Editing an answer must not reinterpret the stored positions' timestamps.
	{
		const raw = encodeTrack({start: {x: 0.1, y: 0.5}, hz: 20,
			samples: Array.from({length: 101}, (_, i) => ({x: 0.1 + i / 1000, y: 0.5})),
			intervals: [{a: 'place', t0: 100, t1: 1000}]}, seasonFor(1999));
		let emitted;
		const { recorder, destroy } = mount({value: raw, onchange: (value) => { emitted = value; }});
		ok('restored preview preserves the sample rate', recorder.snapshot().preview.hz === raw.hz);
		recorder.openAnswers(0);
		recorder.answer('node', 'L');
		ok('editing an answer preserves the sample rate', emitted.hz === raw.hz);
		ok('editing an answer preserves the track duration',
			trackDuration(decodeTrack(emitted)) === trackDuration(decodeTrack(raw)));
		ok('editing an answer keeps the samples and season', emitted.p === raw.p && emitted.season === 1999 && emitted.v === 2);
		ok('the edited answer survives', decodeTrack(emitted).intervals[0].node === 'L');
		recorder.discard();
		recorder.place({x: 0.1, y: 0.5});
		recorder.begin();
		clock += 200;
		recorder.tick();
		recorder.finish();
		ok('recording again returns to the current season and cadence',
			emitted.season === currentSeason().year && emitted.hz === SAMPLE_HZ);
		destroy();
	}

	// The clock can advance between scheduled ticks, or while a tab is hidden.
	{
		clock = 0;
		let emitted;
		let changes = 0;
		const { recorder, destroy } = mount({allianceColor: 'red', onchange: (value) => { emitted = value; changes += 1; }});
		recorder.place({x: 0.1, y: 0.5});
		recorder.begin();
		ok('the initial position is sampled before the first timer tick', recorder.snapshot().samples.length === 1);
		clock = 20;
		recorder.press(currentSeason().cycle.to);
		clock = 85;
		recorder.finish();
		ok('stopping reads the actual clock', recorder.snapshot().elapsed === 85);
		const mark = decodeTrack(emitted).intervals[0];
		ok('stopping before the first tick keeps the held action', mark?.t0 === 20 && mark?.t1 === 85);
		const afterStop = changes;
		recorder.finish();
		ok('a second stop does not emit again', changes === afterStop);
		destroy();
	}

	{
		clock = 0;
		let emitted;
		const { recorder, destroy } = mount({allianceColor: 'blue', onchange: (value) => { emitted = value; }});
		recorder.place({x: 0.9, y: 0.5});
		recorder.begin();
		clock = 200;
		recorder.press(currentSeason().cycle.to);
		clock = currentSeason().autoMs + 5000;
		recorder.finish();
		const decoded = decodeTrack(emitted);
		ok('a stop after throttled timers fills all samples', decoded.samples.length === currentSeason().autoMs / 1000 * SAMPLE_HZ);
		ok('a late stop closes actions at the whistle', decoded.intervals[0]?.t1 === currentSeason().autoMs);
		ok('all timers are cleared on stop', timers.size === 0);
		destroy();
	}

	// Reminders hold while the recorder owns the screen, and only then.
	{
		clock = 0;
		const { recorder, destroy } = mount({allianceColor: 'red', onchange: () => {}});
		ok('an idle inline recorder leaves the screen free', screen.recorder === false);
		recorder.place({x: 0.1, y: 0.5});
		flushSync();
		ok('the first placement opens full screen and claims it', screen.recorder === true);
		recorder.begin();
		flushSync();
		ok('a live recording holds the screen', screen.recorder === true);
		destroy();
		flushSync();
		ok('unmounting gives the screen back', screen.recorder === false);
	}
} finally {
	for (const [key, descriptor] of Object.entries(savedGlobals)) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
