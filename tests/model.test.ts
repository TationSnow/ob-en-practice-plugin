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
		retryCount: 1,
		debugMode: false,
		streamingEnabled: true,
		thinkingEnabled: false,
		maxTokens: 4096,
		...overrides,
	};
}

describe('createModel', () => {
	it('按设置透传 maxTokens、思考模式并保留原始响应', () => {
		const model = createModel(
			createSettings({ thinkingEnabled: true, maxTokens: 8192 }),
		);

		expect(model.maxTokens).toBe(8192);
		expect(model.__includeRawResponse).toBe(true);
		expect(model.modelKwargs?.thinking).toEqual({ type: 'enabled' });
	});

	it('关闭思考模式时发送 disabled，非 DeepSeek 模型不发送 thinking', () => {
		const deepseek = createModel(createSettings({ thinkingEnabled: false }));
		expect(deepseek.modelKwargs?.thinking).toEqual({ type: 'disabled' });

		const openai = createModel(createSettings({ modelName: 'gpt-4o' }));
		expect(openai.modelKwargs?.thinking).toBeUndefined();
	});
});
