import { describe, expect, it, vi } from 'vitest';
import {
	createGrammarGraph,
	type GrammarGraphDeps,
} from '../src/ai/grammar-graph';
import {
	AiError,
	type GrammarImprovementResult,
	type GrammarResult,
} from '../src/types';

const SENTENCE = 'The cat sat on the mat.';

const ANALYSIS_RESULT: GrammarResult = {
	sentence: SENTENCE,
	components: [
		{ text: 'The cat', type: 'subject' },
		{ text: 'sat', type: 'predicate' },
		{ text: 'on the mat', type: 'adverbial' },
	],
	clauses: [
		{ text: SENTENCE, level: 0, type: '主句', function: '全句主干' },
	],
	tense: ['一般过去时'],
	voice: '主动语态',
	mood: '陈述语气',
	sentenceType: '简单句',
	structureSummary: '主语 + 谓语 + 状语',
};

const IMPROVEMENT_RESULT: GrammarImprovementResult = {
	sentence: SENTENCE,
	issues: [
		{
			text: 'The cat',
			type: '主谓一致',
			explanation: '测试错误说明',
			suggestion: '测试修改建议',
		},
	],
	patterns: [],
	suggestions: ['测试整体建议'],
	improvedSentence: 'The cats sit on the mat.',
};

/** 构造带 mock 的图依赖，默认路由到语法分析分支 */
function createDeps(
	overrides: Partial<GrammarGraphDeps> = {},
): GrammarGraphDeps {
	const classify = vi
		.fn<GrammarGraphDeps['classify']>()
		.mockResolvedValue({ hasGrammarIssues: false, summary: '结构正常' });
	const analyze = vi
		.fn<GrammarGraphDeps['analyze']>()
		.mockResolvedValue(ANALYSIS_RESULT);
	const improve = vi
		.fn<GrammarGraphDeps['improve']>()
		.mockResolvedValue(IMPROVEMENT_RESULT);
	return {
		classify: overrides.classify ?? classify,
		analyze: overrides.analyze ?? analyze,
		improve: overrides.improve ?? improve,
	};
}

describe('createGrammarGraph', () => {
	it('无语法问题时路由到语法分析分支', async () => {
		const deps = createDeps();

		const result = await createGrammarGraph(deps).invoke({
			sentence: SENTENCE,
		});

		expect(deps.classify).toHaveBeenCalledWith(SENTENCE);
		expect(deps.analyze).toHaveBeenCalledWith(SENTENCE);
		expect(deps.improve).not.toHaveBeenCalled();
		expect(result.route).toBe('analysis');
		expect(result.analysis).toEqual(ANALYSIS_RESULT);
	});

	it('分析节点解析失败时降级到改进分支并标记 degraded', async () => {
		const deps = createDeps({
			analyze: vi
				.fn<GrammarGraphDeps['analyze']>()
				.mockRejectedValue(
					new AiError('PARSE_ERROR', '模型输出无法解析'),
				),
		});

		const result = await createGrammarGraph(deps).invoke({
			sentence: SENTENCE,
		});

		// 分析失败后应调用改进节点并标记降级
		expect(deps.analyze).toHaveBeenCalledWith(SENTENCE);
		expect(deps.improve).toHaveBeenCalledWith(SENTENCE);
		expect(result.route).toBe('improvement');
		expect(result.improvement).toEqual(IMPROVEMENT_RESULT);
		expect(result.degraded).toBe(true);
	});

	it('分析节点抛出非解析错误时不降级，错误继续上抛', async () => {
		const deps = createDeps({
			analyze: vi
				.fn<GrammarGraphDeps['analyze']>()
				.mockRejectedValue(new AiError('API_ERROR', '网络错误')),
		});

		await expect(
			createGrammarGraph(deps).invoke({ sentence: SENTENCE }),
		).rejects.toMatchObject({ code: 'API_ERROR' });
		// 非解析错误不应触发改进分支
		expect(deps.improve).not.toHaveBeenCalled();
	});

	it('存在语法问题时路由到改进分支', async () => {
		const deps = createDeps({
			classify: vi
				.fn<GrammarGraphDeps['classify']>()
				.mockResolvedValue({
					hasGrammarIssues: true,
					summary: '存在搭配错误',
				}),
		});

		const result = await createGrammarGraph(deps).invoke({
			sentence: SENTENCE,
		});

		expect(deps.classify).toHaveBeenCalledWith(SENTENCE);
		expect(deps.improve).toHaveBeenCalledWith(SENTENCE);
		expect(deps.analyze).not.toHaveBeenCalled();
		expect(result.route).toBe('improvement');
		expect(result.improvement).toEqual(IMPROVEMENT_RESULT);
	});
});
