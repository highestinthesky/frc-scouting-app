import test from 'node:test';
import assert from 'node:assert/strict';
import * as coverage from './coverage.js';

const match = (n, played = false, level = 'qm') => ({
	key: `2026demo_${level}${n}`, comp_level: level, match_number: n,
	actual_time: played ? 1000 + n : null,
	alliances: {
		red: { team_keys: ['frc1', 'frc2', 'frc3'], score: -1 },
		blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: -1 }
	}
});
const entry = (matchNumber, teamNumber, extra = {}) => ({
	eventCode: '2026demo', matchNumber, teamNumber, scoutName: 'Alex Rivera', ...extra
});
const overview = (extra = {}) => coverage.eventOverview?.({ eventCode: '2026demo', ...extra });

test('played matches with no submissions remain visible as gaps', () => {
	const result = overview({ matches: [match(1, true), match(2, true), match(3)], entries: [entry(1, 1)] });
	assert.deepEqual(result?.gaps.map(r => [r.match.match_number, r.coverage.scoutedTeams]), [[1, 1], [2, 0]]);
	assert.equal(result?.expected, 12);
	assert.equal(result?.recorded, 1);
	assert.equal(result?.nextMatch?.match_number, 3);
});

test('future matches and playoffs do not dilute current coverage', () => {
	const result = overview({ matches: [match(1, true), match(2), match(1, true, 'sf')], entries: [entry(1, 1)] });
	assert.equal(result?.matchCount, 2);
	assert.equal(result?.expected, 6);
	assert.equal(result?.percent, 17);
});

test('duplicates, other events and unscheduled robots do not inflate coverage', () => {
	const result = overview({ matches: [match(1, true)], entries: [entry(1, 1), entry(1, 1), entry(1, 999), entry(1, 2, { eventCode: '2026other' })] });
	assert.equal(result?.recorded, 1);
});

test('a match with submissions is tracked even before its result arrives', () => {
	const result = overview({ matches: [match(1), match(2)], entries: [entry(1, 1)] });
	assert.equal(result?.trackedCount, 1);
	assert.equal(result?.expected, 6);
	assert.equal(result?.latestMatch?.match_number, 1);
});

test('unplayed events show unknown coverage instead of a misleading zero', () => {
	assert.equal(overview({ matches: [match(1)] })?.percent, null);
	assert.deepEqual(overview({})?.gaps, []);
});

test('zero scores count as played and absent scores do not', () => {
	const scored = match(1);
	scored.alliances.red.score = 0;
	scored.alliances.blue.score = 0;
	const upcoming = match(2);
	delete upcoming.alliances.red.score;
	delete upcoming.alliances.blue.score;
	assert.equal(overview({ matches: [scored, upcoming] })?.trackedCount, 1);
});

test('scout activity uses account identity and the selected event', () => {
	const result = overview({
		roster: [
			{ profileId: 'a', first_name: 'Alex', last_name: 'Rivera', role: 'scout' },
			{ profileId: 'b', first_name: 'Alex', last_name: 'Rivera', role: 'scout' },
			{ profileId: 'c', username: 'casey', role: 'manager' }
		],
		entries: [entry(1, 1, { profileId: 'a' }), entry(1, 2, { profileId: 'b', eventCode: '2026other' })]
	});
	assert.deepEqual(result?.activity.map(r => [r.person.profileId, r.count]), [['b', 0], ['a', 1]]);
});
