// Tests for scoping, the team profile and the match report.
//   node src/lib/aggregate.test.mjs
//
// These are the pure half of aggregate.js, split out of summarize() when the
// event partition was added. The bug they exist to prevent already shipped:
// summarize() read every entry from every event and grouped by team with no
// event filter, so a team's mean silently pooled two events and a manager
// reading "4.2 average" in a gym had no way to know how much of it came from a
// different weekend.
//
// It is the blank-is-not-zero failure wearing different clothes — a number that
// looks like one thing and is another — so the assertions here are mostly about
// what must NOT be pooled.

import { scopeEntries, summarizeEntries, teamProfile, matchReport, autoSummary } from './aggregate.js';
import { encodeTrack } from './auto-track.js';

let pass = 0;
let fail = 0;
function ok(label, cond) {
	if (cond) {
		pass += 1;
	} else {
		fail += 1;
		console.error(`FAIL: ${label}`);
	}
}

let seq = 0;
/** An entry with just enough shape for the aggregation to be real. */
function entry(eventCode, matchNumber, teamNumber, extra = {}) {
	seq += 1;
	return {
		id: seq,
		eventCode,
		matchNumber,
		teamNumber,
		allianceColor: extra.allianceColor ?? 'red',
		scoutName: extra.scoutName ?? 'ada',
		createdAt: extra.createdAt ?? `2026-08-${String(10 + seq).padStart(2, '0')}T00:00:00.000Z`,
		schemaVersion: 3,
		observations: extra.observations ?? {}
	};
}

// ─── scoping ───────────────────────────────────────────────────────────────
{
	const rows = [
		entry('2026onsum', 1, 254),
		entry('2026onto', 1, 254),
		entry('2025onsum', 1, 254),
		entry('practice', 1, 254)
	];

	ok('no scope is everything', scopeEntries(rows).length === 4);
	ok('an event scope is that event', scopeEntries(rows, { eventCode: '2026onsum' }).length === 1);
	ok('scoping is case-insensitive',
		scopeEntries(rows, { eventCode: '2026ONSUM' }).length === 1);
	ok('a season scope crosses events within a year',
		scopeEntries(rows, { season: 2026 }).length === 2);
	ok('a season scope never crosses a year',
		scopeEntries(rows, { season: 2025 }).length === 1);
	ok('an undated event is in no season',
		scopeEntries(rows, { season: 2026 }).every((e) => e.eventCode !== 'practice'));

	// A filter that matched nothing must yield nothing. Falling back to the whole
	// collection is exactly how the original pooling stayed invisible.
	ok('an unknown event yields nothing, not everything',
		scopeEntries(rows, { eventCode: 'nosuchevent' }).length === 0);
	ok('junk input is safe', scopeEntries(null).length === 0);
}

// ─── the pooling bug, stated directly ──────────────────────────────────────
{
	const rows = [
		entry('2026onsum', 1, 254, { observations: { autoScored: 10 } }),
		entry('2026onsum', 2, 254, { observations: { autoScored: 10 } }),
		entry('2026onto', 1, 254, { observations: { autoScored: 0 } })
	];

	const pooled = summarizeEntries(rows).teams[0];
	const scoped = summarizeEntries(scopeEntries(rows, { eventCode: '2026onsum' })).teams[0];

	ok('pooling all events sees three entries', pooled.entryCount === 3);
	ok('scoping to one event sees two', scoped.entryCount === 2);
	ok('and the two answers differ, which is the whole point',
		pooled.entryCount !== scoped.entryCount);
}

// ─── the team profile ──────────────────────────────────────────────────────
{
	const rows = [
		entry('2026onsum', 1, 254),
		entry('2026onsum', 2, 254),
		entry('2026onto', 1, 254),
		entry('2025onsum', 1, 254),
		entry('2026onsum', 1, 1114)
	];

	const p = teamProfile(rows, 254, '2026onsum');
	ok('the season is read off the event code', p.season === 2026);
	ok('the event block counts only this event', p.event.entryCount === 2);
	ok('the season block crosses events in the year', p.seasonWide.entryCount === 3);
	ok('the season block does not cross years', p.seasonWide.entryCount !== 4);
	ok('another team is not in this profile', p.event.teamNumber === 254);

	ok('the breakdown has one row per event in the season', p.byEvent.length === 2);
	ok('the current event is flagged',
		p.byEvent.filter((r) => r.isCurrent).length === 1 &&
			p.byEvent.find((r) => r.isCurrent).eventCode === '2026onsum');
	ok('the breakdown is chronological by last entry',
		p.byEvent[p.byEvent.length - 1].eventCode === '2026onto');

	// A team with nothing at this event but a season record behind it. The event
	// block must be null rather than an empty summary, so the page can say "not
	// seen here yet" instead of rendering a row of zeroes.
	const unseen = teamProfile(rows, 1114, '2026onto');
	ok('a team unseen at this event has a null event block', unseen.event === null);
	ok('but still has a season record', unseen.seasonWide.entryCount === 1);
}

// An undated event pools with nothing, including other undated events.
{
	const rows = [entry('practice', 1, 254), entry('scrimmage', 1, 254)];
	const p = teamProfile(rows, 254, 'practice');
	ok('an undated event has a null season', p.season === null);
	ok('an undated event does not pool with another undated one',
		p.seasonWide.entryCount === 1);
	ok('and its breakdown is one row', p.byEvent.length === 1);
}

// ─── the match report ──────────────────────────────────────────────────────
{
	const lineup = { red: [254, 1114, 2056], blue: [118, 33, 67] };
	const rows = [
		entry('2026onsum', 12, 254, { scoutName: 'ada' }),
		entry('2026onsum', 12, 254, { scoutName: 'rey' }),
		entry('2026onsum', 12, 118, { scoutName: 'ada', allianceColor: 'blue' }),
		entry('2026onsum', 13, 254, { scoutName: 'ada' }),
		entry('2026onto', 12, 254, { scoutName: 'ada' })
	];

	const r = matchReport(rows, '2026onsum', 12, lineup);
	ok('the report is scoped to one match at one event', r.entryCount === 3);
	ok('a different match is excluded', !r.red.some((s) => s.entries.some((e) => e.matchNumber === 13)));
	ok('the same match at another event is excluded',
		!r.red.some((s) => s.entries.some((e) => e.eventCode === '2026onto')));

	ok('every scheduled team gets a seat', r.red.length === 3 && r.blue.length === 3);
	ok('a team nobody watched is present, not missing',
		r.red.find((s) => s.teamNumber === 1114) !== undefined);
	ok('and it is marked uncovered',
		r.red.find((s) => s.teamNumber === 1114).covered === false);
	ok('coverage counts only teams with entries', r.teamsCovered === 2);
	ok('against the scheduled total', r.teamsScheduled === 6);

	ok('two scouts on one team is flagged',
		r.red.find((s) => s.teamNumber === 254).duplicated === true);
	ok('and both scouts are listed',
		r.red.find((s) => s.teamNumber === 254).scouts.length === 2);
	ok('one scout is not flagged as duplicated',
		r.blue.find((s) => s.teamNumber === 118).duplicated === false);
	ok('the match scout list is deduplicated across teams', r.scouts.length === 2);
}

// A scout who typed the wrong match number produced a real observation. It must
// not vanish because it disagrees with TBA.
{
	const lineup = { red: [254, 1114, 2056], blue: [118, 33, 67] };
	const rows = [entry('2026onsum', 12, 9999, { scoutName: 'ada' })];
	const r = matchReport(rows, '2026onsum', 12, lineup);
	ok('an unscheduled team is kept', r.stray.length === 1);
	ok('and flagged', r.stray[0].unscheduled === true);
	ok('and not counted as a scheduled seat', r.teamsScheduled === 6);
	ok('but it is counted as an entry', r.entryCount === 1);

	// The coverage fraction is rendered as "n/6" and a stray in the numerator
	// reads as a scheduled team being watched. It overstated coverage — the one
	// figure a manager acts on mid-event — until the page was actually opened.
	ok('a stray does not inflate coverage', r.teamsCovered === 0);
}

// No schedule cached yet: the page still has to render what was recorded.
{
	const rows = [entry('2026onsum', 12, 254)];
	const r = matchReport(rows, '2026onsum', 12, {});
	ok('with no lineup there are no seats', r.hasLineup === false);
	ok('but the entries are still reachable', r.stray.length === 1);
	ok('and counted', r.entryCount === 1);
}

// ─── what the auto recordings add up to ────────────────────────────────────
//
// The assertion that matters most here is the one about entries with NO track.
// An entry recorded before v0.81, or by a scout who ran out of time, must
// contribute nothing — a start-position histogram that silently counts fifty
// blank entries as a zone looks exactly like real data.
{
	const withTrack = (eventCode, teamNumber, allianceColor, y, acts) =>
		entry(eventCode, 1, teamNumber, {
			allianceColor,
			observations: {
				autoTrack: encodeTrack({
					start: { x: 0.08, y },
					samples: [{ x: 0.08, y }, { x: 0.4, y }],
					intervals: acts.map((a, i) => ({ a, t0: i * 1000, t1: i * 1000 + 600 }))
				})
			}
		});

	const rows = [
		withTrack('2026onsum', 254, 'red', 0.5, ['collect', 'score']),
		withTrack('2026onsum', 254, 'red', 0.5, ['collect', 'score']),
		withTrack('2026onsum', 254, 'red', 0.1, ['score']),
		entry('2026onsum', 4, 254),                       // no track at all
		entry('2026onsum', 5, 254, { observations: { autoPathing: 'middle three piece' } })
	];

	const a = autoSummary(rows);
	ok('only entries with a track are counted', a.n === 3);
	ok('but the entry total is still reported', a.ofEntries === 5);

	ok('start zones are histogrammed', a.zones.length === 2);
	ok('commonest zone first', a.zones[0].zone === 'Middle' && a.zones[0].count === 2);

	ok('identical routes cluster', a.routes[0].count === 2);
	ok('a different start zone is a different route', a.routes.length === 2);

	ok('cycles are averaged over entries WITH tracks', a.cycles.n === 3);
	// Two entries with one cycle each, one with none: 2/3.
	ok('and the mean is over that n', Math.abs(a.cycles.meanCycles - 2 / 3) < 1e-9);

	// Nothing recorded must produce nothing, not a zero.
	const none = autoSummary([entry('2026onsum', 1, 999)]);
	ok('no tracks means n = 0', none.n === 0);
	ok('and no cycle figures at all, rather than zeroes', none.cycles === null);
	ok('and an empty histogram', none.zones.length === 0);
	ok('junk is safe', autoSummary(null).n === 0);

	// The alliance perspective has to survive the aggregation: the same field
	// position is a different zone to each alliance.
	const mirrored = autoSummary([
		withTrack('2026onsum', 7, 'red', 0.05, []),
		withTrack('2026onsum', 7, 'blue', 0.05, [])
	]);
	ok('one field position is two zones to two alliances', mirrored.zones.length === 2);
}

// teamProfile carries the auto view, scoped the same two ways as everything else.
{
	const t = (eventCode, y) =>
		entry(eventCode, 1, 254, {
			allianceColor: 'red',
			observations: { autoTrack: encodeTrack({ start: { x: 0.08, y } }) }
		});
	const p = teamProfile([t('2026onsum', 0.5), t('2026onto', 0.1), t('2025onsum', 0.9)], 254, '2026onsum');
	ok('the event auto view sees this event only', p.auto.n === 1);
	ok('the season auto view crosses events in the year', p.autoSeason.n === 2);
	ok('and never crosses a year', p.autoSeason.n !== 3);
}

console.log(fail === 0 ? `${pass} passed` : `${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
