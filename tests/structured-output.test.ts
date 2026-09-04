import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { grammarImprovementSchema, grammarSchema, translationEvaluationSchema } from '../src/ai/schemas';
import { invokeStructured, runStructuredTask } from '../src/ai/structured-output';
import { clearDebugLog, getDebugLog } from '../src/ai/debug-log';
import type { EnPracticeSettings } from '../src/settings';

// runStructuredTask 内部会创建真实模型，测试中替换为桩实现
const { createModelMock } = vi.hoisted(() => ({ createModelMock: vi.fn() }));
vi.mock('../src/ai/index', () => ({ createModel: createModelMock }));

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
	components: [
		{ text: 'The cat', type: 'subject' },
		{ text: 'sat', type: 'predicate' },
		{
			text: 'on the mat',
			type: 'adverbial',
			details: '介词短语作地点状语',
		},
	],
	clauses: [
		{
			text: 'The cat sat on the mat.',
			level: 0,
			type: '主句',
			function: '全句主干',
		},
	],
	tense: ['一般过去时'],
	voice: '主动语态',
	mood: '陈述语气',
	sentenceType: '简单句',
	structureSummary: '主语 + 谓语 + 状语',
	translation: '那只猫坐在垫子上。',
};

/** 流式分块结构（与 LangChain 消息分块形状一致的最小子集） */
interface FakeChunk {
	content: unknown;
	additional_kwargs?: Record<string, unknown>;
}

/** 构造一个按块输出的假流 */
async function* createChunkStream(
	chunks: FakeChunk[],
): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/** 假模型句柄：model 供调用，stream/invoke 供断言 */
interface FakeModelHandles {
	model: ChatOpenAI;
	stream: ReturnType<typeof vi.fn>;
	invoke: ReturnType<typeof vi.fn>;
}

/**
 * 构造带桩的假 ChatOpenAI。
 * withConfig 返回统一调用器，流式与非流式都经由它，可分别断言调用情况。
 */
function createFakeModel(
	options: {
		chunks?: FakeChunk[];
		message?: { content: unknown; additional_kwargs?: Record<string, unknown> };
	} = {},
): FakeModelHandles {
	const stream = vi.fn(() =>
		Promise.resolve(createChunkStream(options.chunks ?? [])),
	);
	const invoke = vi.fn(() =>
		Promise.resolve(options.message ?? { content: '' }),
	);
	const model = {
		model: 'test-model',
		withConfig: vi.fn(() => ({ stream, invoke })),
	} as unknown as ChatOpenAI;
	return { model, stream, invoke };
}

/** invokeStructured 的公共测试参数 */
function baseOptions() {
	return {
		prompt: TEST_PROMPT,
		outputName: 'translationEvaluation',
		variables: { input: 'test' },
	};
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

	it('未知字段应被剥离而不是整体拒绝', () => {
		// 弱模型偶尔会附加额外字段；非 strict 模式下静默剥离，解析更宽容
		const parsed = grammarSchema.parse({
			...VALID_GRAMMAR,
			extraField: '模型附带的说明',
		});
		expect(parsed).toEqual(VALID_GRAMMAR);
	});

	it('包含嵌套 children 的语法结果应通过校验', () => {
		const result = {
			...VALID_GRAMMAR,
			components: [
				{
					text: 'that language imprisons the mind',
					type: 'object',
					details: '宾语从句作宾语',
					children: [
						{ text: 'language', type: 'subject' },
						{ text: 'imprisons', type: 'predicate' },
						{ text: 'the mind', type: 'object' },
					],
				},
			],
		};

		expect(grammarSchema.parse(result)).toEqual(result);
	});
});

describe('invokeStructured', () => {
	beforeEach(() => {
		clearDebugLog();
	});

	it('流式路径逐块回调并返回校验通过的结果', async () => {
		const json = JSON.stringify(VALID_EVALUATION);
		const { model, stream } = createFakeModel({
			chunks: [{ content: json.slice(0, 20) }, { content: json.slice(20) }],
		});
		const tokens: string[] = [];

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			onToken: (token) => tokens.push(token),
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(stream).toHaveBeenCalledTimes(1);
		expect(tokens.join('')).toBe(json);
	});

	it('非流式路径单次调用并返回校验通过的结果', async () => {
		const { model, invoke } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it('流式 content 为空时回退读取 reasoning_content', async () => {
		const json = JSON.stringify(VALID_EVALUATION);
		const raw = { choices: [{ delta: { reasoning_content: json } }] };
		const { model } = createFakeModel({
			chunks: [{ content: '', additional_kwargs: { __raw_response: raw } }],
		});

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			onToken: vi.fn(),
		});

		expect(result).toEqual(VALID_EVALUATION);
	});

	it('非流式 content 为空时回退读取 reasoning_content', async () => {
		const json = JSON.stringify(VALID_EVALUATION);
		const raw = { choices: [{ message: { reasoning_content: json } }] };
		const { model, invoke } = createFakeModel({
			message: { content: '', additional_kwargs: { __raw_response: raw } },
		});

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it('JSON 解析失败立即抛出 PARSE_ERROR，不再重试', async () => {
		const { model, stream } = createFakeModel({
			chunks: [{ content: '{ "score": "90" }' }],
		});

		await expect(
			invokeStructured({
				...baseOptions(),
				model,
				schema: translationEvaluationSchema,
				onToken: vi.fn(),
			}),
		).rejects.toMatchObject({ code: 'PARSE_ERROR' });
		// 快速失败：只发生一次请求
		expect(stream).toHaveBeenCalledTimes(1);
	});

	it('schema 校验失败的调试日志记录完整错误，不截断', async () => {
		// 构造超出旧 200 字符截断上限的失败输出
		const raw = `{ "score": "90", "pad": "${'x'.repeat(600)}" }`;
		const { model } = createFakeModel({ message: { content: raw } });

		await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			debug: true,
		}).catch(() => {});

		const entry = getDebugLog().find(
			(e) => e.message === '输出未通过 schema 校验',
		);
		expect(entry).toBeDefined();
		// 调试日志必须包含完整原始输出，保证面板展示与复制日志可用于排查
		expect(entry?.detail).toContain('x'.repeat(600));
		expect(entry?.detail?.endsWith('...')).toBe(false);
	});

	it('字符串值内未转义引号时本地修复解析成功（回归线上日志）', async () => {
		// 取自真实报错日志：usage 值内的英文双引号未转义，导致 JSON 解析失败
		const raw = `{
  "sentence": "The parents and grandparents of your students are resources and assets for their children",
  "issues": [
    {
      "text": "for their children",
      "type": "指代不明",
      "explanation": "their children 指代不明确，可能指学生们的孩子。",
      "suggestion": "改为 for them"
    }
  ],
  "patterns": [
    {
      "pattern": "resources and assets",
      "usage": "表示"资源和资产"，用于描述有价值的人或物。",
      "example": "Our employees are our greatest resources and assets."
    }
  ],
  "suggestions": [
    "修正指代问题，使句子表达更加清晰准确。"
  ],
  "improvedSentence": "The parents and grandparents of your students are resources and assets for them.",
  "translation": "你学生的父母和祖父母是他们的资源和资产。"
}`;
		const { model } = createFakeModel({ message: { content: raw } });

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: grammarImprovementSchema,
			debug: true,
		});

		// 修复后字段值原样保留
		expect(result.patterns[0]?.usage).toBe(
			'表示"资源和资产"，用于描述有价值的人或物。',
		);
		// 本地修复不应产生额外模型请求
		const repairEntries = getDebugLog().filter(
			(e) => e.message === 'JSON 语法修复后解析成功',
		);
		expect(repairEntries).toHaveLength(1);
	});

	it('附加校验失败立即抛出 PARSE_ERROR，消息包含问题与原始输出', async () => {
		const { model } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});

		const err = (await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			additionalValidation: () => ['分数低于 80'],
		}).catch((error: unknown) => error)) as AiErrorLike;

		expect(err.code).toBe('PARSE_ERROR');
		expect(err.message).toContain('分数低于 80');
		expect(err.message).toContain('"score"');
	});

	it('附加校验通过时返回解析结果', async () => {
		const { model } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});

		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			additionalValidation: () => [],
		});

		expect(result).toEqual(VALID_EVALUATION);
	});

	it('流式模型调用抛错时抛出 API_ERROR', async () => {
		const { model, stream } = createFakeModel();
		stream.mockRejectedValue(new Error('network error'));

		await expect(
			invokeStructured({
				...baseOptions(),
				model,
				schema: translationEvaluationSchema,
				onToken: vi.fn(),
			}),
		).rejects.toMatchObject({ code: 'API_ERROR' });
	});

	it('非流式模型调用抛错时抛出 API_ERROR', async () => {
		const { model, invoke } = createFakeModel();
		invoke.mockRejectedValue(new Error('network error'));

		await expect(
			invokeStructured({
				...baseOptions(),
				model,
				schema: translationEvaluationSchema,
			}),
		).rejects.toMatchObject({ code: 'API_ERROR' });
	});

	it('debug 开启时写入请求与成功日志', async () => {
		const { model } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});

		await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			debug: true,
		});

		const messages = getDebugLog().map((entry) => entry.message);
		expect(messages).toContain('开始请求');
		expect(messages).toContain('请求成功');
	});
});

describe('runStructuredTask', () => {
	/** 构造最小完整设置 */
	function createSettings(
		overrides: Partial<EnPracticeSettings> = {},
	): EnPracticeSettings {
		return {
			apiKey: 'test-key',
			baseUrl: 'https://example.com/v1',
			modelName: 'test-model',
			debugMode: false,
			streamingEnabled: true,
			maxTokens: 4096,
			proxyEnabled: false,
			proxyUrl: '',
			writingThemes: [],
			...overrides,
		};
	}

	it('创建模型并透传任务级 token 上限，流式回调接通', async () => {
		const { model, stream } = createFakeModel({
			chunks: [{ content: JSON.stringify(VALID_EVALUATION) }],
		});
		createModelMock.mockReset().mockReturnValue(model);
		const settings = createSettings();
		const onToken = vi.fn();

		const result = await runStructuredTask(
			settings,
			{ onToken },
			{
				outputName: 'grammarRouter',
				prompt: TEST_PROMPT,
				schema: translationEvaluationSchema,
				variables: { input: 'test' },
				maxTokens: 512,
			},
		);

		expect(result).toEqual(VALID_EVALUATION);
		expect(createModelMock).toHaveBeenCalledWith(settings, 512);
		expect(stream).toHaveBeenCalledTimes(1);
	});

	it('关闭流式输出设置时不接通 onToken，走非流式调用', async () => {
		const { model, stream, invoke } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});
		createModelMock.mockReset().mockReturnValue(model);

		await runStructuredTask(
			createSettings({ streamingEnabled: false }),
			{ onToken: vi.fn() },
			{
				outputName: 'grammarRouter',
				prompt: TEST_PROMPT,
				schema: translationEvaluationSchema,
				variables: { input: 'test' },
			},
		);

		expect(stream).not.toHaveBeenCalled();
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it('debug 选项透传到日志', async () => {
		const { model } = createFakeModel({
			message: { content: JSON.stringify(VALID_EVALUATION) },
		});
		createModelMock.mockReset().mockReturnValue(model);

		await runStructuredTask(
			createSettings(),
			{ debug: true },
			{
				outputName: 'grammarResult',
				prompt: TEST_PROMPT,
				schema: translationEvaluationSchema,
				variables: { input: 'test' },
			},
		);

		const features = getDebugLog().map((entry) => entry.feature);
		expect(features).toContain('grammarResult');
	});
});

/** 测试中使用的错误形状 */
interface AiErrorLike {
	code: string;
	message: string;
}
