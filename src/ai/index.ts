import { ChatOpenAI } from '@langchain/openai';
import type { ChatOpenAIFields } from '@langchain/openai';
import type { EnPracticeSettings } from '../settings';
import {
	addDebugEntry,
	createRequestId,
	formatDebugDetail,
} from './debug-log';
import { createProxyFetch, formatProxyAddress } from './proxy-fetch';

/** 单次请求超时时间（毫秒），避免接口无响应时界面长时间卡住 */
const REQUEST_TIMEOUT_MS = 60_000;

/** OpenAI 客户端自身最多重试次数，避免无响应时重复等待 */
const REQUEST_MAX_RETRIES = 1;

/** DeepSeek 等支持思考模式参数（thinking）的模型名模式 */
const THINKING_MODEL_PATTERN = /deepseek/i;

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
				thinking: settings.thinkingEnabled,
				maxTokens: settings.maxTokens,
				timeout: REQUEST_TIMEOUT_MS,
				maxRetries: REQUEST_MAX_RETRIES,
				proxy: settings.proxyEnabled
					? formatProxyAddress(settings.proxyUrl)
					: undefined,
			}),
		});
	}

	// DeepSeek 等推理模型通过 thinking 参数控制思考模式，其他接口不发送该字段
	const modelKwargs: Record<string, unknown> = {};
	if (THINKING_MODEL_PATTERN.test(settings.modelName)) {
		modelKwargs.thinking = {
			type: settings.thinkingEnabled ? 'enabled' : 'disabled',
		};
	}

	const configuration: ChatOpenAIFields['configuration'] = {
		baseURL: settings.baseUrl,
	};
	const proxyAddress = settings.proxyUrl.trim();
	if (settings.proxyEnabled && proxyAddress) {
		const proxyFetch = createProxyFetch(proxyAddress);
		if (proxyFetch) {
			configuration.fetch = proxyFetch;
		}
	}

	return new ChatOpenAI({
		model: settings.modelName,
		apiKey: settings.apiKey || undefined,
		configuration,
		temperature: 0.3,
		maxTokens: settings.maxTokens,
		streaming: settings.streamingEnabled,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: REQUEST_MAX_RETRIES,
		// 保留原始响应分块，便于流式兼容读取 reasoning_content
		__includeRawResponse: true,
		modelKwargs,
	});
}
