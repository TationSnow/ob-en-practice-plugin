import { describe, expect, it } from 'vitest';
import { createModel } from '../src/ai';
import { resolveActiveModelSettings } from '../src/settings/models';
import type { EnPracticeSettings } from '../src/settings';
import type { ModelProfile } from '../src/settings/models';

/** 构造最小完整设置（旧版扁平字段 + 新档位结构） */
function createSettings(
	overrides: Partial<EnPracticeSettings> = {},
): EnPracticeSettings {
	return {
		models: [],
		activeModelId: '',
		apiKey: 'test-key',
		baseUrl: 'https://api.deepseek.com/v1',
		modelName: 'deepseek-v4-flash',
		debugMode: false,
		streamingEnabled: true,
		maxTokens: 4096,
		proxyEnabled: false,
		proxyUrl: 'http://127.0.0.1:7897',
		writingThemes: [],
		...overrides,
	};
}

/** 构造一个模型档位 */
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

/** 经解析器创建模型（与生产路径 runStructuredTask 同款接线） */
function createModelFromSettings(
	settings: EnPracticeSettings,
	maxTokensCap?: number,
) {
	return createModel(resolveActiveModelSettings(settings), maxTokensCap);
}

describe('createModel', () => {
	it('推理类模型固定发送 thinking disabled 以保证响应速度', () => {
		const deepseek = createModelFromSettings(
			createSettings({ modelName: 'deepseek-v4-flash' }),
		);
		expect(deepseek.modelKwargs?.thinking).toEqual({ type: 'disabled' });

		const glm = createModelFromSettings(
			createSettings({ modelName: 'glm-4.5-air' }),
		);
		expect(glm.modelKwargs?.thinking).toEqual({ type: 'disabled' });

		// 不支持该参数的接口不发送，避免请求被拒绝
		const openai = createModelFromSettings(
			createSettings({ modelName: 'gpt-4o' }),
		);
		expect(openai.modelKwargs?.thinking).toBeUndefined();
	});

	it('按设置透传 maxTokens 并保留原始响应', () => {
		const model = createModelFromSettings(
			createSettings({ maxTokens: 8192 }),
		);

		expect(model.maxTokens).toBe(8192);
		expect(model.__includeRawResponse).toBe(true);
	});

	it('任务级 token 上限与用户设置取小', () => {
		// 上限低于用户设置时生效，防止个别任务失控输出
		expect(
			createModelFromSettings(createSettings({ maxTokens: 4096 }), 512)
				.maxTokens,
		).toBe(512);
		// 用户设置更低时以用户设置为准
		expect(
			createModelFromSettings(createSettings({ maxTokens: 256 }), 512)
				.maxTokens,
		).toBe(256);
		// 未指定上限时直接使用用户设置
		expect(
			createModelFromSettings(createSettings({ maxTokens: 4096 })).maxTokens,
		).toBe(4096);
	});

	it('档位覆盖的 maxTokens 与任务上限取小', () => {
		const settings = createSettings({
			models: [createProfile({ maxTokens: 2048 })],
			activeModelId: 'profile-1',
		});
		expect(createModelFromSettings(settings, 512).maxTokens).toBe(512);
		expect(createModelFromSettings(settings).maxTokens).toBe(2048);
	});

	it('激活档位的地址与模型名覆盖旧版扁平字段', () => {
		const model = createModelFromSettings(
			createSettings({
				models: [createProfile()],
				activeModelId: 'profile-1',
			}),
		) as unknown as { clientConfig?: { baseURL?: string } };

		expect(model.clientConfig?.baseURL).toBe('http://127.0.0.1:1234/v1');
	});

	it('启用代理时注入自定义 fetch（全局开关）', () => {
		const model = createModelFromSettings(
			createSettings({ proxyEnabled: true }),
		) as unknown as {
			clientConfig?: { fetch?: unknown };
		};

		expect(model.clientConfig?.fetch).toBeTypeOf('function');
	});

	it('档位代理覆盖优先于全局开关：本地直连档位不注入 fetch', () => {
		const settings = createSettings({
			proxyEnabled: true,
			models: [createProfile({ proxyEnabled: false })],
			activeModelId: 'profile-1',
		});
		const model = createModelFromSettings(settings) as unknown as {
			clientConfig?: { fetch?: unknown };
		};

		expect(model.clientConfig?.fetch).toBeUndefined();
	});

	it('未启用代理时不注入自定义 fetch', () => {
		const model = createModelFromSettings(createSettings()) as unknown as {
			clientConfig?: { fetch?: unknown };
		};

		expect(model.clientConfig?.fetch).toBeUndefined();
	});

	it('不支持的协议抛出配置错误', () => {
		const resolved = {
			...resolveActiveModelSettings(createSettings()),
			protocol: 'anthropic-compatible' as never,
		};
		expect(() => createModel(resolved)).toThrow(
			expect.objectContaining({ code: 'CONFIG_MISSING' }),
		);
	});
});
