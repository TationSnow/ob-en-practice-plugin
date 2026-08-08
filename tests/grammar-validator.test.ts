import { describe, expect, it } from 'vitest';
import { validateGrammarResult } from '../src/ai/grammar-validator';
import type { GrammarResult } from '../src/types';

const SENTENCE =
	'A friend who is always honest will indeed find true loyalty in difficult times.';

const VALID_RESULT: GrammarResult = {
	sentence: SENTENCE,
	components: [
		{
			text: 'A friend who is always honest',
			type: 'subject',
			details: '名词短语，内含定语从句',
		},
		{
			text: 'will indeed find',
			type: 'predicate',
			details: '一般将来时，主动语态',
		},
		{
			text: 'true loyalty',
			type: 'object',
			details: '名词短语作宾语',
		},
		{
			text: 'in difficult times',
			type: 'adverbial',
			details: '介词短语作时间状语',
		},
	],
	clauses: [
		{
			text: SENTENCE,
			level: 0,
			type: '主句',
			function: '全句主干',
		},
		{
			text: 'who is always honest',
			level: 1,
			type: '定语从句',
			function: '修饰 A friend',
		},
	],
	tense: ['一般将来时', '一般现在时'],
	voice: '主动语态',
	mood: '陈述语气',
	sentenceType: '复合句',
	structureSummary: '主句含定语从句，时态组合为将来时 + 现在时。',
};

describe('validateGrammarResult', () => {
	it('合法结果应通过校验', () => {
		expect(validateGrammarResult(VALID_RESULT, SENTENCE)).toEqual([]);
	});

	it('成分不是原句连续片段时应被拒绝', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'honest friend who is always',
					type: 'subject',
				},
				...VALID_RESULT.components.slice(1),
			],
		};
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'成分未在原句中找到连续片段：honest friend who is always',
		);
	});

	it('嵌套子成分包含在父成分内时应通过校验', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'true loyalty',
					type: 'object',
					children: [
						{ text: 'loyalty', type: 'other' },
					],
				},
			],
		};
		expect(validateGrammarResult(result, SENTENCE)).toEqual([]);
	});

	it('子成分超出父成分范围时应被拒绝', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'true loyalty',
					type: 'object',
					children: [
						{ text: 'A friend', type: 'subject' },
					],
				},
			],
		};
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'子成分未包含在父成分中：A friend',
		);
	});

	it('缺少 level 0 主句时应被拒绝', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			clauses: VALID_RESULT.clauses.filter((clause) => clause.level > 0),
		};
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'必须且只能有一个 level 0 主句',
		);
	});

	it('从句缺少上一级宿主或类型无效时应被拒绝', () => {
		const noParent: GrammarResult = {
			...VALID_RESULT,
			clauses: [
				{
					text: 'who is always honest',
					level: 1,
					type: '定语从句',
					function: '修饰 A friend',
				},
			],
		};
		expect(validateGrammarResult(noParent, SENTENCE)).toContain(
			'level 1 从句缺少上一级宿主：who is always honest',
		);

		const wrongType: GrammarResult = {
			...VALID_RESULT,
			clauses: [
				VALID_RESULT.clauses[0] as (typeof VALID_RESULT.clauses)[number],
				{
					text: 'who is always honest',
					level: 1,
					type: '主句',
					function: '修饰 A friend',
				},
			],
		};
		expect(validateGrammarResult(wrongType, SENTENCE)).toContain(
			'level 1 从句类型无效：主句',
		);
	});

	it('sentence 与输入不一致或 level 0 类型错误时应被拒绝', () => {
		const changedSentence: GrammarResult = {
			...VALID_RESULT,
			sentence: 'A friend will find loyalty.',
		};
		expect(validateGrammarResult(changedSentence, SENTENCE)).toContain(
			'sentence 与原句不一致',
		);

		const wrongMainType: GrammarResult = {
			...VALID_RESULT,
			clauses: [
				{
					...VALID_RESULT.clauses[0]!,
					type: '定语从句',
				},
			],
		};
		expect(validateGrammarResult(wrongMainType, SENTENCE)).toContain(
			'level 0 的类型必须为主句',
		);
	});
});
