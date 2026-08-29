import { describe, expect, it } from 'vitest';
import { normalizeGrammarResult } from '../src/ai/grammar-normalize';
import { grammarSchema } from '../src/ai/schemas';
import type { GrammarResult } from '../src/types';

/** 2026-08-27 线上 bug 的原始输出：两个分句同为一般现在时，tense 出现重复项 */
const BUG_FIXTURE: GrammarResult = {
	sentence:
		"Some people like Silent Gear, while some like Tinker's Construct.",
	components: [
		{ text: 'Some people', type: 'subject', details: '名词短语作主语' },
		{
			text: 'like',
			type: 'predicate',
			details: '谓语动词：like；一般现在时，主动语态',
		},
		{ text: 'Silent Gear', type: 'object', details: '名词短语作宾语' },
		{
			text: ', while',
			type: 'other',
			details: '从属连词，引导状语从句',
		},
		{ text: 'some', type: 'subject', details: '代词作主语，指代people' },
		{
			text: 'like',
			type: 'predicate',
			details: '谓语动词：like；一般现在时，主动语态',
		},
		{
			text: "Tinker's Construct",
			type: 'object',
			details: '名词短语作宾语',
		},
	],
	clauses: [
		{
			text:
				"Some people like Silent Gear, while some like Tinker's Construct.",
			level: 0,
			type: '主句',
			function: '全句主干，表达对不同事物的喜好对比',
		},
		{
			text: 'while some like Tinker\'s Construct',
			level: 1,
			type: '状语从句',
			function: '表示对比，修饰主句',
		},
	],
	tense: ['一般现在时', '一般现在时'],
	voice: '主动语态',
	mood: '陈述语气',
	sentenceType: '复合句',
	structureSummary:
		'全句为复合句，主句为Some people like Silent Gear，while引导的状语从句表示对比。',
};

describe('normalizeGrammarResult', () => {
	it('重复时态应按首次出现顺序去重', () => {
		const normalized = normalizeGrammarResult(BUG_FIXTURE);
		expect(normalized.tense).toEqual(['一般现在时']);
	});

	it('不同时态应保留原顺序且不去重不同项', () => {
		const normalized = normalizeGrammarResult({
			...BUG_FIXTURE,
			tense: ['一般将来时', '一般现在时', '一般将来时'],
		});
		expect(normalized.tense).toEqual(['一般将来时', '一般现在时']);
	});

	it('不应修改入参对象', () => {
		const original = { ...BUG_FIXTURE, tense: ['一般现在时', '一般现在时'] };
		normalizeGrammarResult(original);
		expect(original.tense).toEqual(['一般现在时', '一般现在时']);
	});
});

describe('grammarSchema 对重复时态的容忍度', () => {
	it('含重复时态的输出应通过 schema（去重交由归一化后处理）', () => {
		expect(() => grammarSchema.parse(BUG_FIXTURE)).not.toThrow();
	});
});
