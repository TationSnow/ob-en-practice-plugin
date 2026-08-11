import { describe, expect, it } from 'vitest';
import { getScoreClass } from '../src/utils/score';

describe('getScoreClass', () => {
	it('80 分及以上为高分', () => {
		expect(getScoreClass(80)).toBe('is-high');
		expect(getScoreClass(100)).toBe('is-high');
	});

	it('60-79 分为中档', () => {
		expect(getScoreClass(60)).toBe('is-mid');
		expect(getScoreClass(79)).toBe('is-mid');
	});

	it('60 分以下为低分', () => {
		expect(getScoreClass(0)).toBe('is-low');
		expect(getScoreClass(59)).toBe('is-low');
	});
});
