import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonFor, SEASON_YEARS } from './index.js';
import { seasonIsOpen } from '../season-rules.js';

const catalog = await import('./catalog.js').catch((error) => {
	if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
	return {};
});

test('season choices show game names while preserving the existing year keys', () => {
	assert.equal(typeof catalog.seasonOptions, 'function');
	assert.deepEqual(catalog.seasonOptions(), [
		{ value: 2026, label: 'REBUILT · 2026' },
		{ value: 2027, label: 'BIOCORE · 2027' }
	]);
});

test('an unconfigured active season stays visible without becoming a selectable game', () => {
	assert.equal(typeof catalog.seasonOptions, 'function');
	assert.deepEqual(catalog.seasonOptions(2028).at(-1), {
		value: 2028, label: 'Season 2028', disabled: true
	});
});

test('each event label comes from its own season rather than the active season', () => {
	assert.equal(typeof catalog.eventSeasonLabel, 'function');
	for (const [code, label] of [
		['2026nyny-6', 'REBUILT · 2026'],
		[' 2027NYNY ', 'BIOCORE · 2027'],
		['2028test', 'Season 2028'],
		['scrimmage', 'Unknown season'],
		['1999fixture', 'Season 1999'],
		['', 'Unknown season']
	]) assert.equal(catalog.eventSeasonLabel(code), label, code);
});

test('the pending BIOCORE season has a name without inheriting REBUILT scouting rules', () => {
	assert.equal(typeof catalog.seasonLabel, 'function');
	assert.equal(catalog.seasonLabel(2027), 'BIOCORE · 2027');
	assert.equal(seasonFor(2027), null);
	assert.equal(seasonIsOpen({ active_year: 2027, announced: true }, SEASON_YEARS), false);
});
