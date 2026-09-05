import { describe, expect, it, vi } from 'vitest';
import type { ChatOpenAI } from '@langchain/openai';
import {
	evaluateTranslation,
	generateQuestion,
} from '../src/ai/translation-writing';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EnPracticeSettings } from '../src/settings';

// runStructuredTask 内部会创建真实模型，测试中替换为桩实现
const { createModelMock } = vi.hoisted(() => ({ createModelMock: vi.fn() }));
vi.mock('../src/ai/index', () => ({ createModel: createModelMock }));

/** 合法的翻译题输出（fake 模型返回值） */
const VALID_QUESTION_JSON = JSON.stringify({
	chinese: '植物通过光合作用把阳光转化为生长所需的养分。',
	hint: '注意方式状语与被动语态的表达',
	targetGrammar: '方式状语与被动语态',
});

/** 合法的翻译评估输出（fake 模型返回值） */
const VALID_EVALUATION_JSON = JSON.stringify({
	score: 90,
	strengths: ['译文准确流畅'],
	weaknesses: ['个别用词可优化'],
	suggestions: '可尝试更地道的表达方式',
	improvedVersion: 'Plants convert sunlight into nutrients by photosynthesis.',
});

/** 流式分块结构（与 LangChain 消息分块形状一致的最小子集） */
interface FakeChunk {
	content: unknown;
}

/** 构造一个按块输出的假流 */
async function* createChunkStream(
	chunks: FakeChunk[],
): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/** 假模型句柄：model 供注入，invoke/stream 记录收到的渲染后消息 */
interface FakeModelHandles {
	model: ChatOpenAI;
	invoke: ReturnType<typeof vi.fn>;
	stream: ReturnType<typeof vi.fn>;
}

/**
 * 构造带桩的假 ChatOpenAI。
 * withConfig 返回统一调用器，与 collectModelText 的 JSON Mode 接线一致。
 */
function createFakeModel(reply: string): FakeModelHandles {
	const invoke = vi.fn(() => Promise.resolve({ content: reply }));
	const stream = vi.fn(() =>
		Promise.resolve(createChunkStream([{ content: reply }])),
	);
	const model = {
		withConfig: vi.fn(() => ({ invoke, stream })),
	} as unknown as ChatOpenAI;
	return { model, invoke, stream };
}

/** 构造最小完整设置；固定关闭流式，走非流式 invoke 路径便于断言渲染消息 */
function createSettings(
	overrides: Partial<EnPracticeSettings> = {},
): EnPracticeSettings {
	return {
		...DEFAULT_SETTINGS,
		apiKey: 'test-key',
		baseUrl: 'https://example.com/v1',
		modelName: 'test-model',
		debugMode: false,
		streamingEnabled: false,
		maxTokens: 4096,
		proxyEnabled: false,
		proxyUrl: '',
		writingThemes: [],
		...overrides,
	};
}

/** 提取假模型收到的一条消息文本 */
function messageText(handle: FakeModelHandles, index: number): string {
	const messages = handle.invoke.mock.calls[0]?.[0] as
		| Array<{ content: unknown }>
		| undefined;
	const message = messages?.[index];
	return typeof message?.content === 'string' ? message.content : '';
}

describe('generateQuestion 提示词变量渲染', () => {
	it('回归：同时提供参考句与主题时，两者都应完整渲染且标注角色分工', async () => {
		const handle = createFakeModel(VALID_QUESTION_JSON);
		createModelMock.mockReset().mockReturnValue(handle.model);

		const question = await generateQuestion(
			'Whorf came to believe in a sort of linguistic determinism.',
			'cet4',
			createSettings(),
			undefined,
			{ theme: '植物', seed: 'seed-test' },
		);

		expect(question).toEqual(JSON.parse(VALID_QUESTION_JSON));
		const human = messageText(handle, 1);
		// 参考句仅作语法参考：模板必须显式标注其角色，防止模型把参考句当作待翻译内容
		expect(human).toContain(
			'参考英语表达（仅参考其语法结构，严禁翻译其内容）：Whorf came to believe in a sort of linguistic determinism.',
		);
		// 主题必须渲染，且标注为内容硬约束（回归：theme 曾被模型完全忽略）
		expect(human).toContain('主题（语句内容必须围绕该主题）：植物');
		expect(human.endsWith('随机数种子：seed-test')).toBe(true);
		// 系统提示必须包含参考句与主题同时提供时的组合规则（tie-breaker）
		const system = messageText(handle, 0);
		expect(system).toContain('内容服从主题，语法结构借鉴参考表达');
		// 流式关闭时不应走 stream 路径
		expect(handle.stream).not.toHaveBeenCalled();
	});

	it('未提供参考句与主题时应回退为（无）占位符', async () => {
		const handle = createFakeModel(VALID_QUESTION_JSON);
		createModelMock.mockReset().mockReturnValue(handle.model);

		await generateQuestion('', 'cet6', createSettings(), undefined, {
			theme: null,
		});

		const human = messageText(handle, 1);
		expect(human).toContain(
			'参考英语表达（仅参考其语法结构，严禁翻译其内容）：（无）',
		);
		expect(human).toContain('主题（语句内容必须围绕该主题）：（无）');
	});

	it('种子未提供时应自动生成随机种子', async () => {
		const handle = createFakeModel(VALID_QUESTION_JSON);
		createModelMock.mockReset().mockReturnValue(handle.model);

		await generateQuestion('', 'cet4', createSettings(), undefined, {
			theme: '环保',
		});

		const human = messageText(handle, 1);
		expect(human).toMatch(/随机数种子：seed-/);
	});
});

describe('evaluateTranslation 提示词变量渲染', () => {
	it('应完整渲染中文原文、用户翻译与参考表达', async () => {
		const handle = createFakeModel(VALID_EVALUATION_JSON);
		createModelMock.mockReset().mockReturnValue(handle.model);

		const evaluation = await evaluateTranslation(
			'植物通过光合作用把阳光转化为生长所需的养分。',
			'Plants turn sunlight into nutrients by photosynthesis.',
			'Plants convert sunlight into nutrients through photosynthesis.',
			'cet4',
			createSettings(),
		);

		expect(evaluation).toEqual(JSON.parse(VALID_EVALUATION_JSON));
		const human = messageText(handle, 1);
		expect(human).toContain('中文原文：植物通过光合作用把阳光转化为生长所需的养分。');
		expect(human).toContain(
			'用户翻译：Plants turn sunlight into nutrients by photosynthesis.',
		);
		expect(human).toContain(
			'参考表达：Plants convert sunlight into nutrients through photosynthesis.',
		);
	});

	it('未提供参考表达时应回退为（无）占位符', async () => {
		const handle = createFakeModel(VALID_EVALUATION_JSON);
		createModelMock.mockReset().mockReturnValue(handle.model);

		await evaluateTranslation(
			'猫坐在垫子上。',
			'The cat sat on the mat.',
			'',
			'cet4',
			createSettings(),
		);

		const human = messageText(handle, 1);
		expect(human).toContain('参考表达：（无）');
	});
});
