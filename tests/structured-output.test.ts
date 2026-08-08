import { describe, expect, it, vi } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import {
	grammarSchema,
	translationEvaluationSchema,
} from '../src/ai/schemas';
import {
	invokeStructured,
	resolveOutputMethods,
} from '../src/ai/structured-output';

const TEST_PROMPT = ChatPromptTemplate.fromMessages([
	new SystemMessage('返回一个合法的 JSON 对象。'),
	['human', '{input}'],
]);

const VALID_EVALUATION = {
	score: 90,
	strengths: ['优点'],
	weaknesses: ['不足'],
	suggestions: '改进建议',
	improvedVersion: '优化版本',
};

const VALID_GRAMMAR = {
	sentence: 'The cat sat on the mat.',
	components: [{ text: 'The cat', type: 'subject' }],
	clauses: [],
	tense: '一般现在时',
	voice: '主动语态',
	mood: '陈述语气',
	sentenceType: '简单句',
	structureSummary: '主语 + 谓语 + 状语',
};

/** 构造用于测试的假 ChatOpenAI */
function createFakeModel(
	overrides: Partial<
		Pick<
			ChatOpenAI,
			| 'model'
			| 'profile'
			| 'withStructuredOutput'
			| 'invoke'
			| 'withConfig'
			| 'stream'
		>
	>,
): ChatOpenAI {
	return {
		model: 'deepseek-v4-flash',
		profile: {},
		withStructuredOutput: vi.fn(),
		invoke: vi.fn(),
		withConfig: vi.fn(),
		stream: vi.fn(),
		...overrides,
	} as unknown as ChatOpenAI;
}

/** 构造一个按块输出的假流 */
async function* createChunkStream(
	chunks: { content: string; additional_kwargs?: Record<string, unknown> }[],
): AsyncGenerator<{ content: string; additional_kwargs?: Record<string, unknown> }> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

describe('Zod schema 校验', () => {
	it('合法评估结果应通过校验', () => {
		expect(translationEvaluationSchema.parse(VALID_EVALUATION)).toEqual(
			VALID_EVALUATION,
		);
	});

	it('错误类型或越界分数应被拒绝', () => {
		expect(() =>
			translationEvaluationSchema.parse({
				...VALID_EVALUATION,
				score: '90',
			}),
		).toThrow();
		expect(() =>
			translationEvaluationSchema.parse({
				...VALID_EVALUATION,
				score: 101,
			}),
		).toThrow();
	});

	it('合法语法结果应通过，非法成分类型应被拒绝', () => {
		expect(grammarSchema.parse(VALID_GRAMMAR)).toEqual(VALID_GRAMMAR);
		expect(() =>
			grammarSchema.parse({
				...VALID_GRAMMAR,
				components: [{ text: 'x', type: 'invalid' }],
			}),
		).toThrow();
	});
});

describe('resolveOutputMethods', () => {
	it('DeepSeek 应优先 jsonMode', () => {
		const model = createFakeModel({ model: 'deepseek-v4-flash' });
		expect(resolveOutputMethods(model)).toEqual([
			'jsonMode',
			'functionCalling',
		]);
	});

	it('DeepSeek 开启思考模式时跳过 functionCalling', () => {
		const model = createFakeModel({ model: 'deepseek-v4-flash' });
		expect(resolveOutputMethods(model, true)).toEqual(['jsonMode']);
	});

	it('OpenAI 结构化输出模型应优先 jsonSchema', () => {
		const model = createFakeModel({ model: 'gpt-4o' });
		expect(resolveOutputMethods(model)).toEqual([
			'jsonSchema',
			'functionCalling',
			'jsonMode',
		]);
	});

	it('未知模型应默认 jsonMode', () => {
		const model = createFakeModel({ model: 'qwen-3' });
		expect(resolveOutputMethods(model)).toEqual([
			'jsonMode',
			'functionCalling',
		]);
	});
});

describe('invokeStructured', () => {
	it('jsonMode 开启流式回调时逐块输出并完成校验', async () => {
		const json = JSON.stringify(VALID_EVALUATION);
		const stream = createChunkStream([
			{ content: json.slice(0, 20) },
			{ content: json.slice(20) },
		]);
		const withConfig = vi.fn().mockReturnValue({
			stream: vi.fn().mockResolvedValue(stream),
		});
		const model = createFakeModel({
			withConfig,
		});
		const tokens: string[] = [];

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: translationEvaluationSchema,
			outputName: 'translationEvaluation',
			variables: { input: 'test' },
			maxRetries: 0,
			onToken: (token) => tokens.push(token),
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(withConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				response_format: { type: 'json_object' },
			}),
		);
		expect(tokens.join('')).toContain('"score"');
	});

	it('content 为空时回退读取 reasoning_content 并完成校验', async () => {
		const json = JSON.stringify(VALID_EVALUATION);
		const raw = {
			choices: [{ delta: { reasoning_content: json } }],
		};
		const stream = createChunkStream([
			{ content: '', additional_kwargs: { __raw_response: raw } },
		]);
		const withConfig = vi.fn().mockReturnValue({
			stream: vi.fn().mockResolvedValue(stream),
		});
		const model = createFakeModel({ withConfig });

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: translationEvaluationSchema,
			outputName: 'translationEvaluation',
			variables: { input: 'test' },
			maxRetries: 0,
			onToken: vi.fn(),
		});

		expect(result).toEqual(VALID_EVALUATION);
	});

	it('思考模式下 DeepSeek 只使用 jsonMode', async () => {
		const usedMethods: string[] = [];
		const withStructuredOutput = vi.fn().mockImplementation(
			(_schema: unknown, config: { method?: string }) => {
				usedMethods.push(config.method ?? '');
				return {
					invoke: vi.fn().mockResolvedValue({
						raw: {},
						parsed: VALID_GRAMMAR,
					}),
				};
			},
		);
		const model = createFakeModel({ withStructuredOutput });

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: grammarSchema,
			outputName: 'grammarResult',
			variables: { input: 'test' },
			maxRetries: 0,
			thinkingEnabled: true,
		});

		expect(result).toEqual(VALID_GRAMMAR);
		expect(usedMethods).toEqual(['jsonMode']);
	});

	it('解析失败时按重试次数重试同一方法', async () => {
		const withStructuredOutput = vi.fn().mockReturnValue({
			invoke: vi
				.fn()
				.mockResolvedValueOnce({ raw: {}, parsed: null })
				.mockResolvedValue({ raw: {}, parsed: VALID_EVALUATION }),
		});
		const model = createFakeModel({ withStructuredOutput });

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: translationEvaluationSchema,
			outputName: 'translationEvaluation',
			variables: { input: 'test' },
			maxRetries: 1,
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(withStructuredOutput).toHaveBeenCalledTimes(2);
		expect(withStructuredOutput).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ method: 'jsonMode', includeRaw: true }),
		);
	});

	it('API 不支持当前方法时自动切换到下一方法', async () => {
		const withStructuredOutput = vi.fn().mockImplementation(
			(_schema: unknown, config: { method?: string }) => {
				if (config.method === 'jsonMode') {
					return {
						invoke: vi.fn().mockRejectedValue(new Error('unsupported')),
					};
				}
				return {
					invoke: vi.fn().mockResolvedValue({
						raw: {},
						parsed: VALID_EVALUATION,
					}),
				};
			},
		);
		const model = createFakeModel({ withStructuredOutput });

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: translationEvaluationSchema,
			outputName: 'translationEvaluation',
			variables: { input: 'test' },
			maxRetries: 0,
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(withStructuredOutput).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ method: 'functionCalling' }),
		);
	});

	it('原生方法全部失败时回退到普通文本并完成 Zod 校验', async () => {
		const withStructuredOutput = vi.fn().mockReturnValue({
			invoke: vi.fn().mockResolvedValue({ raw: {}, parsed: null }),
		});
		const invoke = vi
			.fn()
			.mockResolvedValue({ content: JSON.stringify(VALID_EVALUATION) });
		const model = createFakeModel({ withStructuredOutput, invoke });

		const result = await invokeStructured({
			model,
			prompt: TEST_PROMPT,
			schema: translationEvaluationSchema,
			outputName: 'translationEvaluation',
			variables: { input: 'test' },
			maxRetries: 0,
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(invoke).toHaveBeenCalled();
	});

	it('兜底解析仍失败时抛出 PARSE_ERROR', async () => {
		const withStructuredOutput = vi.fn().mockReturnValue({
			invoke: vi.fn().mockResolvedValue({ raw: {}, parsed: null }),
		});
		const invoke = vi.fn().mockResolvedValue({ content: '不是 JSON' });
		const model = createFakeModel({ withStructuredOutput, invoke });

		await expect(
			invokeStructured({
				model,
				prompt: TEST_PROMPT,
				schema: translationEvaluationSchema,
				outputName: 'translationEvaluation',
				variables: { input: 'test' },
				maxRetries: 0,
			}),
		).rejects.toMatchObject({ code: 'PARSE_ERROR' });
	});

	it('所有原生方法返回解析失败且兜底调用失败时抛出 API_ERROR', async () => {
		const withStructuredOutput = vi.fn().mockReturnValue({
			invoke: vi.fn().mockResolvedValue({ raw: {}, parsed: null }),
		});
		const invoke = vi.fn().mockRejectedValue(new Error('network error'));
		const model = createFakeModel({ withStructuredOutput, invoke });

		await expect(
			invokeStructured({
				model,
				prompt: TEST_PROMPT,
				schema: translationEvaluationSchema,
				outputName: 'translationEvaluation',
				variables: { input: 'test' },
				maxRetries: 0,
			}),
		).rejects.toMatchObject({ code: 'API_ERROR' });
	});
});
