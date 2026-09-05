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

/** OpenAI 客户端自身最多重试次数：仅容忍一次瞬时网络抖动 */
const REQUEST_MAX_RETRIES = 1;

/**
 * 推理类模型名模式。
 * 这类模型（DeepSeek、GLM-4.5+）默认开启思考会显著拖慢响应，
 * 统一显式发送 thinking: disabled 保证响应速度；其他接口不发送该字段。
 */
const THINKING_DISABLED_PATTERN = /deepseek|glm-4\.5/i;

/**
 * 创建基于用户配置的 ChatOpenAI 实例
 * @param settings 用户设置
 * @param maxTokensCap 可选的输出 token 上限，与用户设置取小，
 *   用于输出体积可预期的任务，防止模型失控生成长文本
 * @returns ChatOpenAI 实例
 */
export function createModel(
	settings: EnPracticeSettings,
	maxTokensCap?: number,
): ChatOpenAI {
	const maxTokens = maxTokensCap
		? Math.min(settings.maxTokens, maxTokensCap)
		: settings.maxTokens;

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
				maxTokens,
				timeout: REQUEST_TIMEOUT_MS,
				maxRetries: REQUEST_MAX_RETRIES,
				proxy: settings.proxyEnabled
					? formatProxyAddress(settings.proxyUrl)
					: undefined,
			}),
		});
	}

	// 推理类模型显式关闭思考模式；其他接口发送未知字段可能被拒绝，保持不发送
	const modelKwargs: Record<string, unknown> = {};
	if (THINKING_DISABLED_PATTERN.test(settings.modelName)) {
		modelKwargs.thinking = { type: 'disabled' };
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
		maxTokens,
		streaming: settings.streamingEnabled,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: REQUEST_MAX_RETRIES,
		// 保留原始响应分块，便于流式兼容读取 reasoning_content
		__includeRawResponse: true,
		modelKwargs,
	});
}
