import { ChatOpenAI } from '@langchain/openai';
import type { EnPracticeSettings } from '../settings';

/**
 * 创建基于用户配置的 ChatOpenAI 实例
 * @param settings 用户设置
 * @returns ChatOpenAI 实例
 */
export function createModel(settings: EnPracticeSettings): ChatOpenAI {
	return new ChatOpenAI({
		model: settings.modelName,
		apiKey: settings.apiKey || undefined,
		configuration: {
			baseURL: settings.baseUrl,
		},
		temperature: 0.3,
		maxTokens: 2048,
	});
}
