import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { grammarImprovementSchema, grammarSchema, translationEvaluationSchema } from '../src/ai/schemas';
import { invokeStructured, runStructuredTask } from '../src/ai/structured-output';
import { clearDebugLog, getDebugLog } from '../src/ai/debug-log';
import {
	clearStructuredCapabilityCache,
	getCachedStructuredMode,
	setCachedStructuredMode,
} from '../src/ai/structured-mode';
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

	it('合法语法结果应通过校验', () => {
		expect(grammarSchema.parse(VALID_GRAMMAR)).toEqual(VALID_GRAMMAR);
	});

	it('未知成分类型应归入 other 而不是整体拒绝（回归：conjunction）', () => {
		// 模型可能发明封闭列表外的类型（如把引导词标注为 conjunction），
		// 整份输出因单个字段作废得不偿失，统一归入 other
		const parsed = grammarSchema.parse({
			...VALID_GRAMMAR,
			components: [{ text: 'that', type: 'conjunction' }],
		});
		expect(parsed.components[0]?.type).toBe('other');
	});

	it('成分类型的大小写与空白偏差应归一化', () => {
		const parsed = grammarSchema.parse({
			...VALID_GRAMMAR,
			components: [{ text: 'The cat', type: ' Subject ' }],
		});
		expect(parsed.components[0]?.type).toBe('subject');
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
		clearStructuredCapabilityCache();
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
			models: [],
			activeModelId: '',
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

	beforeEach(() => {
		clearStructuredCapabilityCache();
	});

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
		// 模型工厂收到的是解析后的运行配置（激活档位 / 旧字段回退 → ResolvedModelSettings）
		expect(createModelMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'https://example.com/v1',
				modelName: 'test-model',
				structuredOutput: 'auto',
			}),
			512,
		);
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

/**
 * 构造按 response_format 类型区分成败的假模型（降级阶梯测试用）。
 * withConfig 收到的 response_format.type 为 undefined 表示 none 模式
 * （不经过 withConfig，直接调用模型本身）。
 */
function createLadderFakeModel(
	options: {
		/** 直接失败的模式列表；undefined 表示 none 模式 */
		failTypes?: Array<string | undefined>;
		/** 失败时抛出的错误消息 */
		failMessage?: string;
		content?: string;
	} = {},
) {
	const callTypes: Array<string | undefined> = [];
	const failMessage =
		options.failMessage ??
		`400 "'response_format.type' must be 'json_schema' or 'text'"`;
	const json = options.content ?? JSON.stringify(VALID_EVALUATION);
	const callerFor = (type: string | undefined) => {
		const invoke = vi.fn(async (_messages?: unknown) => {
			callTypes.push(type);
			if (options.failTypes?.some((item) => item === type)) {
				throw new Error(failMessage);
			}
			return { content: json };
		});
		const stream = vi.fn(async (_messages?: unknown) => {
			callTypes.push(type);
			if (options.failTypes?.some((item) => item === type)) {
				throw new Error(failMessage);
			}
			return createChunkStream([{ content: json }]);
		});
		return { invoke, stream };
	};
	const callers = new Map<
		string | undefined,
		ReturnType<typeof callerFor>
	>();
	const getCaller = (type: string | undefined) => {
		let caller = callers.get(type);
		if (!caller) {
			caller = callerFor(type);
			callers.set(type, caller);
		}
		return caller;
	};
	const model = {
		invoke: (messages: unknown) => getCaller(undefined).invoke(messages),
		stream: (messages: unknown) => getCaller(undefined).stream(messages),
		withConfig: vi.fn(
			(config: { response_format?: { type?: string } }) =>
				getCaller(config?.response_format?.type),
		),
	} as unknown as ChatOpenAI;
	return { model, callTypes };
}

describe('结构化输出模式降级（response_format 兼容）', () => {
	beforeEach(() => {
		clearDebugLog();
		clearStructuredCapabilityCache();
	});

	it('auto 模式：json_object 被拒后自动降级 json_schema 重试并缓存能力', async () => {
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_object'],
		});
		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			capabilityCacheKey: 'ladder-1',
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(callTypes).toEqual(['json_object', 'json_schema']);
		expect(getCachedStructuredMode('ladder-1')).toBe('json_schema');
	});

	it('auto 模式：json_schema 也被拒时最终降级为不发送 response_format', async () => {
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_object', 'json_schema'],
		});
		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			capabilityCacheKey: 'ladder-2',
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(callTypes).toEqual(['json_object', 'json_schema', undefined]);
	});

	it('auto 模式：降级重试同样适用于流式请求', async () => {
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_object'],
		});
		const tokens: string[] = [];
		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			onToken: (token) => tokens.push(token),
		});

		expect(result).toEqual(VALID_EVALUATION);
		expect(tokens.join('')).toBe(JSON.stringify(VALID_EVALUATION));
		expect(callTypes).toEqual(['json_object', 'json_schema']);
	});

	it('命中能力缓存时直接单次请求，不重走阶梯', async () => {
		setCachedStructuredMode('ladder-3', 'json_schema');
		const { model, callTypes } = createLadderFakeModel({});
		await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			capabilityCacheKey: 'ladder-3',
		});

		expect(callTypes).toEqual(['json_schema']);
	});

	it('缓存模式失效（后端配置变化）时清除缓存并重走完整阶梯', async () => {
		setCachedStructuredMode('ladder-4', 'json_object');
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_object'],
		});
		await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			capabilityCacheKey: 'ladder-4',
		});

		// 缓存命中的 json_object 失败一次 + 重走阶梯（json_object 再失败、json_schema 成功）
		expect(callTypes).toEqual(['json_object', 'json_object', 'json_schema']);
		expect(getCachedStructuredMode('ladder-4')).toBe('json_schema');
	});

	it('非 response_format 的 400（如上下文超长）不触发降级，快速抛出', async () => {
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_object'],
			failMessage: "400 'context length exceeded'",
		});
		await expect(
			invokeStructured({
				...baseOptions(),
				model,
				schema: translationEvaluationSchema,
				structuredOutputMode: 'auto',
				capabilityCacheKey: 'ladder-5',
			}),
		).rejects.toMatchObject({ code: 'API_ERROR' });
		expect(callTypes).toEqual(['json_object']);
	});

	it('手动模式只尝试指定模式，失败即上抛且不写缓存', async () => {
		const { model, callTypes } = createLadderFakeModel({
			failTypes: ['json_schema'],
		});
		await expect(
			invokeStructured({
				...baseOptions(),
				model,
				schema: translationEvaluationSchema,
				structuredOutputMode: 'json_schema',
				capabilityCacheKey: 'ladder-6',
			}),
		).rejects.toMatchObject({ code: 'API_ERROR' });
		expect(callTypes).toEqual(['json_schema']);
		expect(getCachedStructuredMode('ladder-6')).toBeUndefined();
	});

	it('none 模式完全不发送 response_format', async () => {
		const { model, callTypes } = createLadderFakeModel({});
		const result = await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'none',
			capabilityCacheKey: 'ladder-7',
		});

		expect(result).toEqual(VALID_EVALUATION);
		// undefined 类型表示请求未经 withConfig（未携带 response_format）
		expect(callTypes).toEqual([undefined]);
	});

	it('降级过程写入调试日志，便于排查', async () => {
		const { model } = createLadderFakeModel({ failTypes: ['json_object'] });
		await invokeStructured({
			...baseOptions(),
			model,
			schema: translationEvaluationSchema,
			structuredOutputMode: 'auto',
			debug: true,
		});

		const messages = getDebugLog().map((entry) => entry.message);
		expect(messages).toContain('接口不支持 json_object 模式的 response_format');
	});
});
