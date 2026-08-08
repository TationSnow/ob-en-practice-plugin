import { ChatOpenAI } from '@langchain/openai';
import type { EnPracticeSettings } from '../settings';
import {
	addDebugEntry,
	createRequestId,
	formatDebugDetail,
} from './debug-log';

/** 单次请求超时时间（毫秒），避免接口无响应时界面长时间卡住 */
const REQUEST_TIMEOUT_MS = 60_000;

/** OpenAI 客户端自身最多重试次数，避免无响应时重复等待 */
const REQUEST_MAX_RETRIES = 1;

/**
 * 创建基于用户配置的 ChatOpenAI 实例
 * @param settings 用户设置
 * @returns ChatOpenAI 实例
 */
export function createModel(settings: EnPracticeSettings): ChatOpenAI {
	if (settings.debugMode) {
		addDebugEntry({
			requestId: createRequestId('model'),
			feature: '模型',
			phase: 'model',
			message: '创建 ChatOpenAI 实例',
			detail: formatDebugDetail({
				model: settings.modelName,
				baseUrl: settings.baseUrl,
				streaming: settings.streamingEnabled,
				timeout: REQUEST_TIMEOUT_MS,
				maxRetries: REQUEST_MAX_RETRIES,
			}),
		});
	}

	return new ChatOpenAI({
		model: settings.modelName,
		apiKey: settings.apiKey || undefined,
		configuration: {
			baseURL: settings.baseUrl,
		},
		temperature: 0.3,
		maxTokens: 2048,
		streaming: settings.streamingEnabled,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: REQUEST_MAX_RETRIES,
	});
}
