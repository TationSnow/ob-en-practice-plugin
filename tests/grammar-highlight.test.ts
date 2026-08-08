import { describe, expect, it } from 'vitest';
import {
	buildRenderItems,
	findClauseRanges,
	findPredicateVerbRange,
} from '../src/utils/grammar-highlight';

describe('findClauseRanges', () => {
	it('应定位主语成分内的定语从句区间', () => {
		const text = 'A friend who is always honest';
		const ranges = findClauseRanges(text, [
			{ text: 'who is always honest', level: 1 },
		]);

		expect(ranges).toEqual([
			{
				start: text.indexOf('who is always honest'),
				end: text.indexOf('honest') + 'honest'.length,
				level: 1,
			},
		]);
	});

	it('未匹配到从句时应返回空数组', () => {
		expect(findClauseRanges('The cat sat.', [{ text: 'missing', level: 1 }])).toEqual([]);
	});

	it('level 0 主句不应被当作从句包裹', () => {
		const text = 'The cat sat on the mat.';
		expect(
			findClauseRanges(text, [
				{ text: 'The cat sat on the mat.', level: 0 },
			]),
		).toEqual([]);
	});
});

describe('buildRenderItems', () => {
	it('应合并子成分与从句，且同一位置时从句优先', () => {
		const text = 'that language imprisons the mind';
		const items = buildRenderItems(
			text,
			[
				{ text: 'language', type: 'subject' },
				{ text: 'imprisons', type: 'predicate' },
				{ text: 'the mind', type: 'object' },
			],
			[{ text, level: 1 }],
		);

		expect(items[0]).toMatchObject({
			kind: 'clause',
			start: 0,
			end: text.length,
			level: 1,
		});
		expect(
			items.some(
				(item) =>
					item.kind === 'component' &&
					item.component?.type === 'subject',
			),
		).toBe(true);
	});
});

describe('findPredicateVerbRange', () => {
	it('应优先使用 details 中的谓语动词标记', () => {
		const text = 'will indeed find';
		const range = findPredicateVerbRange(
			text,
			'谓语动词：find；一般将来时，主动语态；indeed 为句中状语',
		);

		expect(text.slice(range?.start, range?.end)).toBe('find');
	});

	it('缺少标记时应通过启发式跳过状语并定位动词', () => {
		const text = 'will indeed find';
		const range = findPredicateVerbRange(text);

		expect(text.slice(range?.start, range?.end)).toBe('find');
	});

	it('启发式应跳过句尾副词或短语小品词', () => {
		const takenAway = findPredicateVerbRange('was taken away');
		expect('was taken away'.slice(takenAway?.start, takenAway?.end)).toBe(
			'taken',
		);

		const notGo = findPredicateVerbRange('will not go');
		expect('will not go'.slice(notGo?.start, notGo?.end)).toBe('go');
	});
});
