import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatOpenAI } from '@langchain/openai';
import { testModelConnection } from '../src/ai/connection-test';
import {
	clearStructuredCapabilityCache,
	getCachedStructuredMode,
	modelCapabilityCacheKey,
} from '../src/ai/structured-mode';
import type { EnPracticeSettings } from '../src/settings';
import type { ModelProfile } from '../src/settings/models';

// connection-test 内部会创建真实模型，测试中替换为桩实现
const { createModelMock } = vi.hoisted(() => ({ createModelMock: vi.fn() }));
vi.mock('../src/ai/index', () => ({ createModel: createModelMock }));

/** 构造最小完整设置 */
function createSettings(): EnPracticeSettings {
	return {
		models: [],
		activeModelId: '',
		debugMode: false,
		streamingEnabled: true,
		maxTokens: 4096,
		proxyEnabled: false,
		proxyUrl: 'http://127.0.0.1:7897',
		writingThemes: [],
	};
}

/** 构造待测档位（本地 LM Studio 场景，无需 API Key） */
function createProfile(
	overrides: Partial<ModelProfile> = {},
): ModelProfile {
	return {
		id: 'profile-1',
		name: '本地 LM Studio',
		protocol: 'openai-compatible',
		baseUrl: 'http://127.0.0.1:1234/v1',
		apiKey: '',
		modelName: 'qwen3.8-9b',
		structuredOutput: 'auto',
		...overrides,
	};
}

/**
 * 构造按 response_format 类型区分成败的假模型。
 * failTypes 中的模式（undefined 表示 none）抛 LM Studio 特征 400。
 */
function createProbeFakeModel(
	options: { failTypes?: Array<string | undefined>; message?: string } = {},
) {
	const callTypes: Array<string | undefined> = [];
	const failMessage =
		options.message ??
		`400 "'response_format.type' must be 'json_schema' or 'text'"`;
	const callerFor = (type: string | undefined) => ({
		invoke: vi.fn(async (_messages?: unknown) => {
			callTypes.push(type);
			if (options.failTypes?.some((item) => item === type)) {
				throw new Error(failMessage);
			}
			return { content: '{"ok": true}' };
		}),
	});
	const callers = new Map<string | undefined, ReturnType<typeof callerFor>>();
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
		withConfig: vi.fn(
			(config: { response_format?: { type?: string } }) =>
				getCaller(config?.response_format?.type),
		),
	} as unknown as ChatOpenAI;
	return { model, callTypes };
}

describe('testModelConnection', () => {
	beforeEach(() => {
		createModelMock.mockReset();
		clearStructuredCapabilityCache();
	});

	it('连通成功返回耗时与探测到的模式，并写入能力缓存', async () => {
		const { model } = createProbeFakeModel();
		createModelMock.mockReturnValue(model);
		const profile = createProfile();

		const result = await testModelConnection(profile, createSettings());

		expect(result.ok).toBe(true);
		expect(result.message).toBe('连接成功');
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result.detectedMode).toBe('json_object');
		// 探测结论写入能力缓存，正式请求直达正确模式
		expect(
			getCachedStructuredMode(
				modelCapabilityCacheKey(
					'openai-compatible',
					profile.baseUrl,
					profile.modelName,
				),
			),
		).toBe('json_object');
		// 探测请求使用极小 token 上限，控制成本
		expect(createModelMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://127.0.0.1:1234/v1',
				modelName: 'qwen3.8-9b',
			}),
			32,
		);
	});

	it('auto 阶梯降级后仍能连通并报告降级后的模式', async () => {
		const { model } = createProbeFakeModel({ failTypes: ['json_object'] });
		createModelMock.mockReturnValue(model);

		const result = await testModelConnection(createProfile(), createSettings());

		expect(result.ok).toBe(true);
		expect(result.detectedMode).toBe('json_schema');
	});

	it('后端不可达时返回失败结果而非抛错', async () => {
		const { model } = createProbeFakeModel({
			failTypes: ['json_object', 'json_schema', undefined],
			message: 'connect ECONNREFUSED 127.0.0.1:1234',
		});
		createModelMock.mockReturnValue(model);

		const result = await testModelConnection(createProfile(), createSettings());

		expect(result.ok).toBe(false);
		expect(result.message).toContain('连接失败');
		expect(result.message).toContain('ECONNREFUSED');
		expect(result.detectedMode).toBeUndefined();
	});

	it('手动 json_schema 模式只发一次请求且报告该模式', async () => {
		const { model, callTypes } = createProbeFakeModel();
		createModelMock.mockReturnValue(model);

		const result = await testModelConnection(
			createProfile({ structuredOutput: 'json_schema' }),
			createSettings(),
		);

		expect(result.ok).toBe(true);
		expect(result.detectedMode).toBe('json_schema');
		expect(callTypes).toEqual(['json_schema']);
	});
});
