import { describe, expect, it } from 'vitest';
import { createModel } from '../src/ai';
import type { EnPracticeSettings } from '../src/settings';

/** 构造最小完整设置 */
function createSettings(
	overrides: Partial<EnPracticeSettings> = {},
): EnPracticeSettings {
	return {
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

describe('createModel', () => {
	it('推理类模型固定发送 thinking disabled 以保证响应速度', () => {
		const deepseek = createModel(
			createSettings({ modelName: 'deepseek-v4-flash' }),
		);
		expect(deepseek.modelKwargs?.thinking).toEqual({ type: 'disabled' });

		const glm = createModel(createSettings({ modelName: 'glm-4.5-air' }));
		expect(glm.modelKwargs?.thinking).toEqual({ type: 'disabled' });

		// 不支持该参数的接口不发送，避免请求被拒绝
		const openai = createModel(createSettings({ modelName: 'gpt-4o' }));
		expect(openai.modelKwargs?.thinking).toBeUndefined();
	});

	it('按设置透传 maxTokens 并保留原始响应', () => {
		const model = createModel(createSettings({ maxTokens: 8192 }));

		expect(model.maxTokens).toBe(8192);
		expect(model.__includeRawResponse).toBe(true);
	});

	it('任务级 token 上限与用户设置取小', () => {
		// 上限低于用户设置时生效，防止个别任务失控输出
		expect(createModel(createSettings({ maxTokens: 4096 }), 512).maxTokens).toBe(
			512,
		);
		// 用户设置更低时以用户设置为准
		expect(createModel(createSettings({ maxTokens: 256 }), 512).maxTokens).toBe(
			256,
		);
		// 未指定上限时直接使用用户设置
		expect(createModel(createSettings({ maxTokens: 4096 })).maxTokens).toBe(
			4096,
		);
	});

	it('启用代理时注入自定义 fetch', () => {
		const model = createModel(
			createSettings({ proxyEnabled: true }),
		) as unknown as {
			clientConfig?: { fetch?: unknown };
		};

		expect(model.clientConfig?.fetch).toBeTypeOf('function');
	});

	it('未启用代理时不注入自定义 fetch', () => {
		const model = createModel(createSettings()) as unknown as {
			clientConfig?: { fetch?: unknown };
		};

		expect(model.clientConfig?.fetch).toBeUndefined();
	});
});
