import { describe, expect, it } from 'vitest';
import { grammarImprovementSchema } from '../src/ai/schemas';

const VALID_RESULT = {
	sentence: 'I am interesting in between read and write.',
	issues: [
		{
			text: 'am interesting in',
			type: '搭配错误',
			explanation: 'be interested in 是固定搭配。',
			suggestion: '改为 am interested in',
		},
	],
	patterns: [
		{
			pattern: 'between ... and ...',
			usage: '后接名词或动名词。',
			example: 'She is torn between staying and leaving.',
		},
	],
	suggestions: ['修正固定搭配后句子即可恢复正确。'],
	improvedSentence: 'I am interested in reading and writing.',
	translation: '我在阅读和写作之间感到有趣。',
};

describe('grammarImprovementSchema', () => {
	it('合法改进结果应通过校验', () => {
		expect(grammarImprovementSchema.parse(VALID_RESULT)).toEqual(
			VALID_RESULT,
		);
	});

	it('缺少必填字段应被拒绝', () => {
		const { sentence: _sentence, ...missingSentence } = VALID_RESULT;
		expect(() => grammarImprovementSchema.parse(missingSentence)).toThrow();

		const { improvedSentence: _improved, ...missingImproved } =
			VALID_RESULT;
		expect(() =>
			grammarImprovementSchema.parse(missingImproved),
		).toThrow();

		const { translation: _translation, ...missingTranslation } =
			VALID_RESULT;
		expect(() =>
			grammarImprovementSchema.parse(missingTranslation),
		).toThrow();
	});

	it('非法错误项结构应被拒绝', () => {
		expect(() =>
			grammarImprovementSchema.parse({
				...VALID_RESULT,
				issues: [{ text: 'x' }],
			}),
		).toThrow();
	});

	it('空错误列表仍可通过校验', () => {
		expect(
			grammarImprovementSchema.parse({
				...VALID_RESULT,
				issues: [],
			}).issues,
		).toEqual([]);
	});
});
