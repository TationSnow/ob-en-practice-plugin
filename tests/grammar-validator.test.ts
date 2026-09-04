import { describe, expect, it } from 'vitest';
import {
	repairGrammarResult,
	validateGrammarResult,
} from '../src/ai/grammar-validator';
import type { GrammarResult } from '../src/types';

const SENTENCE =
	'A friend who is always honest will indeed find true loyalty in difficult times.';

/** 去掉句尾句号的版本，模拟“用户输入无句号”的场景 */
const PLAIN_SENTENCE = SENTENCE.replace(/\.$/, '');

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
	translation: '一个始终诚实的朋友在困难时确实会找到真正的忠诚。',
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

describe('repairGrammarResult', () => {
	it('sentence 仅差句尾句号时修复为原句', () => {
		// 用户输入没有句尾句号，模型按英文习惯补上了句号
		const result: GrammarResult = {
			...VALID_RESULT,
			sentence: PLAIN_SENTENCE,
		};
		repairGrammarResult(result, SENTENCE);
		expect(result.sentence).toBe(SENTENCE);
		expect(validateGrammarResult(result, SENTENCE)).toEqual([]);
	});

	it('sentence 存在多余空白时修复为原句', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			sentence: `  ${SENTENCE.replace(/\s+/g, ' ')}  `,
		};
		repairGrammarResult(result, SENTENCE);
		expect(result.sentence).toBe(SENTENCE);
	});

	it('sentence 语义改写不属于可修复差异', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			sentence: 'A friend will find loyalty.',
		};
		repairGrammarResult(result, SENTENCE);
		expect(result.sentence).toBe('A friend will find loyalty.');
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'sentence 与原句不一致',
		);
	});

	it('片段比原句短（缺句尾句号）时无需修复，校验直接通过', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			clauses: [
				{
					text: PLAIN_SENTENCE,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
			],
		};
		repairGrammarResult(result, SENTENCE);
		// 片段本身已是原句连续片段，保持模型输出不变
		expect(result.clauses[0]?.text).toBe(PLAIN_SENTENCE);
		expect(validateGrammarResult(result, SENTENCE)).toEqual([]);
	});

	it('成分文本带原句没有的句尾句号时应修复为原句中的精确子串', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'in difficult times.',
					type: 'adverbial',
				},
			],
			clauses: [
				{
					text: SENTENCE,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
			],
		};
		repairGrammarResult(result, PLAIN_SENTENCE);
		expect(result.components[0]?.text).toBe('in difficult times');
		expect(validateGrammarResult(result, PLAIN_SENTENCE)).toEqual([]);
	});

	it('子成分应相对修复后的父成分修复', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'true loyalty',
					type: 'object',
					children: [{ text: 'loyalty.', type: 'other' }],
				},
			],
		};
		repairGrammarResult(result, SENTENCE);
		expect(result.components[0]?.children?.[0]?.text).toBe('loyalty');
		expect(validateGrammarResult(result, SENTENCE)).toEqual([]);
	});

	it('无法修复的幻觉片段保持原样，由校验报错', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'honest friend who is always.',
					type: 'subject',
				},
			],
		};
		repairGrammarResult(result, SENTENCE);
		// 剥除句尾标点后仍不是连续片段，不应篡改文本
		expect(result.components[0]?.text).toBe('honest friend who is always.');
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'成分未在原句中找到连续片段：honest friend who is always.',
		);
	});

	it('回归：子成分挂载层级与文本不符时应提升为平级成分', () => {
		// 取自真实报错日志的句型：两个宾语从句被挂在较短的定语成分下，
		// 文本上并不包含在父成分内；信息完整，只是挂载层级错误
		const input =
			'Whorf came to believe in a sort of linguistic determinism which, in its strongest form, states that language imprisons the mind, and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society.';
		const result: GrammarResult = {
			sentence: input,
			components: [
				{ text: 'Whorf', type: 'subject' },
				{
					text: 'came to believe',
					type: 'predicate',
					details: '谓语动词：believe；一般过去时，主动语态',
				},
				{ text: 'in a sort of linguistic determinism', type: 'adverbial' },
				{
					text: 'which, in its strongest form, states',
					type: 'attributive',
					children: [
						{
							text: 'that language imprisons the mind',
							type: 'object',
							children: [
								{ text: 'language', type: 'subject' },
								{
									text: 'imprisons',
									type: 'predicate',
									details: '谓语动词：imprisons；一般现在时',
								},
								{ text: 'the mind', type: 'object' },
							],
						},
						{
							text: 'and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
							type: 'object',
						},
					],
				},
			],
			clauses: [
				{
					text: input,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
				{
					text: 'which, in its strongest form, states that language imprisons the mind, and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
					level: 1,
					type: '定语从句',
					function: '修饰 linguistic determinism',
				},
				{
					text: 'that language imprisons the mind',
					level: 2,
					type: '宾语从句',
					function: '作 states 的宾语',
				},
				{
					text: 'and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
					level: 2,
					type: '宾语从句',
					function: '与前面宾语从句并列',
				},
			],
			tense: ['一般过去时', '一般现在时'],
			voice: '主动语态',
			mood: '陈述语气',
			sentenceType: '复合句',
			structureSummary: '主句 + 定语从句 + 两个并列宾语从句。',
			translation: '测试翻译。',
		};

		repairGrammarResult(result, input);

		// 两个宾语从句被提升为平级成分，父成分不再保留 children
		expect(result.components).toHaveLength(6);
		expect(result.components[3]?.children).toBeUndefined();
		expect(result.components[4]?.text).toBe(
			'that language imprisons the mind',
		);
		expect(result.components[4]?.children).toHaveLength(3);
		expect(result.components[5]?.text).toBe(
			'and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
		);
		// 修复后整个结果通过校验，无需重新请求
		expect(validateGrammarResult(result, input)).toEqual([]);
	});

	it('子成分文本是幻觉（原句中不存在）时保留原样交由校验报错', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [
				{
					text: 'true loyalty',
					type: 'object',
					children: [{ text: 'loyalty beyond words', type: 'other' }],
				},
			],
		};
		repairGrammarResult(result, SENTENCE);
		// 文本在原句中不存在，无法提升，保持原样由校验器拦截
		expect(result.components[0]?.children?.[0]?.text).toBe(
			'loyalty beyond words',
		);
		expect(validateGrammarResult(result, SENTENCE)).toContain(
			'子成分未包含在父成分中：loyalty beyond words',
		);
	});

	it('回归：整句从句作为无 children 的单个成分时应从从句数组合成 children', () => {
		// 取自真实日志：定语从句整体作为 attributive 成分、无 children，
		// 渲染层只能整段灰白；clauses 数组中的类型与层级信息仍可用来恢复结构
		const input =
			'Whorf came to believe in a sort of linguistic determinism which, in its strongest form, states that language imprisons the mind, and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society.';
		const clauseTextL2b =
			'that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society';
		const result: GrammarResult = {
			sentence: input,
			components: [
				{ text: 'Whorf', type: 'subject' },
				{
					text: 'came to believe',
					type: 'predicate',
					details: '谓语动词：believe；一般过去时，主动语态',
				},
				{ text: 'in a sort of linguistic determinism', type: 'object' },
				{
					text: 'which, in its strongest form, states that language imprisons the mind, and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
					type: 'attributive',
				},
			],
			clauses: [
				{
					text: input,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
				{
					text: 'which, in its strongest form, states that language imprisons the mind, and that the grammatical patterns in a language can produce far-reaching consequences for the culture of a society',
					level: 1,
					type: '定语从句',
					function: '修饰 linguistic determinism',
				},
				{
					text: 'that language imprisons the mind',
					level: 2,
					type: '宾语从句',
					function: '作 states 的宾语',
				},
				{
					text: clauseTextL2b,
					level: 2,
					type: '宾语从句',
					function: '与前面宾语从句并列',
				},
			],
			tense: ['一般过去时', '一般现在时'],
			voice: '主动语态',
			mood: '陈述语气',
			sentenceType: '复合句',
			structureSummary: '主句 + 定语从句 + 两个并列宾语从句。',
			translation: '测试翻译。',
		};

		repairGrammarResult(result, input);

		// 两个嵌套宾语从句按类型映射合成为 object 子成分
		const children = result.components[3]?.children;
		expect(children).toHaveLength(2);
		expect(children?.[0]?.text).toBe('that language imprisons the mind');
		expect(children?.[0]?.type).toBe('object');
		expect(children?.[1]?.text).toBe(clauseTextL2b);
		expect(children?.[1]?.type).toBe('object');
		expect(validateGrammarResult(result, input)).toEqual([]);
	});

	it('嵌套从句应递归合成多层 children', () => {
		const input = 'It supports the idea which suggests that A matters.';
		const result: GrammarResult = {
			sentence: input,
			components: [
				{ text: 'It supports', type: 'predicate' },
				{
					text: 'the idea which suggests that A matters',
					type: 'object',
				},
			],
			clauses: [
				{
					text: input,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
				{
					text: 'which suggests that A matters',
					level: 1,
					type: '定语从句',
					function: '修饰 the idea',
				},
				{
					text: 'that A matters',
					level: 2,
					type: '宾语从句',
					function: '作 suggests 的宾语',
				},
			],
			tense: ['一般现在时'],
			voice: '主动语态',
			mood: '陈述语气',
			sentenceType: '复合句',
			structureSummary: '主句 + 定语从句 + 宾语从句。',
			translation: '测试翻译。',
		};

		repairGrammarResult(result, input);

		// 一级定语从句合成进 children，其内部的二级宾语从句继续递归合成
		const firstChild = result.components[1]?.children?.[0];
		expect(firstChild?.text).toBe('which suggests that A matters');
		expect(firstChild?.type).toBe('attributive');
		expect(firstChild?.children?.[0]?.text).toBe('that A matters');
		expect(firstChild?.children?.[0]?.type).toBe('object');
		expect(validateGrammarResult(result, input)).toEqual([]);
	});

	it('不包含从句文本的成分不做合成', () => {
		const result: GrammarResult = {
			...VALID_RESULT,
			components: [{ text: 'true loyalty', type: 'object' }],
			clauses: [
				{
					text: SENTENCE,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
			],
		};
		repairGrammarResult(result, SENTENCE);
		// 成分内没有嵌套从句文本，不应凭空合成 children
		expect(result.components[0]?.children).toBeUndefined();
	});

	it('回归：用户输入无句号而模型补句号时应整体自动修复', () => {
		// 取自真实报错日志的句子：输入无句尾句号，模型输出全部带句号
		const input =
			'The parents and grandparents of your students are resources and assets for their children';
		const result: GrammarResult = {
			sentence: `${input}.`,
			components: [
				{
					text: 'The parents and grandparents of your students',
					type: 'subject',
				},
				{ text: 'are', type: 'predicate' },
				{ text: 'resources and assets', type: 'complement' },
				{ text: 'for their children', type: 'adverbial' },
			],
			clauses: [
				{
					text: `${input}.`,
					level: 0,
					type: '主句',
					function: '全句主干，陈述主要观点',
				},
			],
			tense: ['一般现在时'],
			voice: '主动语态',
			mood: '陈述语气',
			sentenceType: '简单句',
			structureSummary: '主系表结构。',
			translation: '你学生的父母和祖父母是他们孩子的资源和财富。',
		};

		repairGrammarResult(result, input);
		expect(validateGrammarResult(result, input)).toEqual([]);
		expect(result.sentence).toBe(input);
		expect(result.clauses[0]?.text).toBe(input);
	});
});
