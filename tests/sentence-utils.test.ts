import { describe, expect, it } from 'vitest';
import { findComponentSpan, splitSentences } from '../src/utils/sentence';

describe('splitSentences', () => {
	it('按 ? 和 . 拆分多句，并保留标点', () => {
		const text =
			'How many of us recognize true loyalty in a friend? ' +
			'Loyalty consists of a friend, who will stick by you, through thick and thin.';
		expect(splitSentences(text)).toEqual([
			'How many of us recognize true loyalty in a friend?',
			'Loyalty consists of a friend, who will stick by you, through thick and thin.',
		]);
	});

	it('多句语法分析输入应切分为独立句子', () => {
		const text =
			'The current trend on the Internet is befriending anyone who requests to be your friend. ' +
			'However, this new trend may lead to disasters. ' +
			'It may be popular and trendy to have a network filled with multitude of mutual friends.';
		expect(splitSentences(text)).toEqual([
			'The current trend on the Internet is befriending anyone who requests to be your friend.',
			'However, this new trend may lead to disasters.',
			'It may be popular and trendy to have a network filled with multitude of mutual friends.',
		]);
	});

	it('引号内的问号不参与拆分', () => {
		expect(splitSentences('You said "?"? Before xxx.')).toEqual([
			'You said "?"?',
			'Before xxx.',
		]);
	});

	it('引号内以句末标点结尾且无后续标点时只算一个句子', () => {
		expect(splitSentences('He asked "Really?"')).toEqual([
			'He asked "Really?"',
		]);
	});

	it('引号内完整句子后跟大写开头时拆分为两句', () => {
		expect(splitSentences('He said "Hi." Then left.')).toEqual([
			'He said "Hi."',
			'Then left.',
		]);
	});

	it('引号内完整句子后跟小写对话说明时不拆分', () => {
		expect(splitSentences('He said "What?" she asked.')).toEqual([
			'He said "What?" she asked.',
		]);
	});

	it('常见缩写句号不参与拆分', () => {
		expect(splitSentences('Dr. Smith left.')).toEqual(['Dr. Smith left.']);
		expect(splitSentences('U.S. citizens are here.')).toEqual([
			'U.S. citizens are here.',
		]);
	});

	it('小数点和省略号不会被误切', () => {
		expect(splitSentences('It costs 3.14 dollars.')).toEqual([
			'It costs 3.14 dollars.',
		]);
		expect(splitSentences('Hello... How are you?')).toEqual([
			'Hello...',
			'How are you?',
		]);
	});

	it('单引号场景与无结尾标点场景', () => {
		expect(splitSentences("He said 'Hi!' Then left.")).toEqual([
			"He said 'Hi!'",
			'Then left.',
		]);
		expect(splitSentences('The quick brown fox')).toEqual([
			'The quick brown fox',
		]);
	});

	it('空文本与紧凑无空格文本', () => {
		expect(splitSentences('')).toEqual([]);
		expect(splitSentences('   ')).toEqual([]);
		expect(splitSentences('What?Next')).toEqual(['What?Next']);
	});
});

describe('findComponentSpan', () => {
	it('忽略大小写与空白差异并返回源文本区间', () => {
		expect(findComponentSpan('How  are you?', 'how are', 0)).toEqual({
			start: 0,
			end: 8,
		});
	});

	it('成分不包含标点时，标点留在区间之外', () => {
		expect(findComponentSpan('a friend?', 'a friend', 0)).toEqual({
			start: 0,
			end: 8,
		});
	});

	it('支持 fromIndex 顺序查找与未命中返回 null', () => {
		const source = 'a friend and a friend';
		expect(findComponentSpan(source, 'a friend', 10)).toEqual({
			start: 13,
			end: 21,
		});
		expect(findComponentSpan(source, 'missing', 0)).toBeNull();
		expect(findComponentSpan(source, '   ', 0)).toBeNull();
	});
});
