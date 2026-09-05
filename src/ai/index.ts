import { ChatOpenAI } from '@langchain/openai';
import type { ChatOpenAIFields } from '@langchain/openai';
import type { ResolvedModelSettings } from '../settings/models';
import { AiError } from '../types';
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
 * 模型工厂：按运行配置的协议分发到具体实现（策略分发点）。
 * 当前仅实现 OpenAI 兼容协议；未来 anthropic-compatible 等在此新增分支
 * （如引入 @langchain/anthropic 的 ChatAnthropic），结构化输出能力差异
 * 由 structured-mode 的模式映射承载，主调用链（runStructuredTask）不变。
 * @param resolved 模型运行配置（由 resolveActiveModelSettings / resolveModelSettingsForProfile 合成）
 * @param maxTokensCap 可选的输出 token 上限，与配置取小，
 *   用于输出体积可预期的任务，防止模型失控生成长文本
 * @returns ChatOpenAI 实例
 */
export function createModel(
	resolved: ResolvedModelSettings,
	maxTokensCap?: number,
): ChatOpenAI {
	switch (resolved.protocol) {
		case 'openai-compatible':
			return createOpenAICompatibleModel(resolved, maxTokensCap);
		default:
			// 当前协议联合类型只有一个成员，default 分支为未来协议预留；
			// 收窄后 resolved 为 never，读取字段需经此转换
			throw new AiError(
				'CONFIG_MISSING',
				`暂不支持该模型协议：${String((resolved as { protocol?: unknown }).protocol)}`,
			);
	}
}

/**
 * 创建 OpenAI 兼容协议的 ChatOpenAI 实例
 * @param resolved 模型运行配置
 * @param maxTokensCap 可选的输出 token 上限，与配置取小
 * @returns ChatOpenAI 实例
 */
function createOpenAICompatibleModel(
	resolved: ResolvedModelSettings,
	maxTokensCap?: number,
): ChatOpenAI {
	const maxTokens = maxTokensCap
		? Math.min(resolved.maxTokens, maxTokensCap)
		: resolved.maxTokens;

	if (resolved.debugMode) {
		addDebugEntry({
			requestId: createRequestId('model'),
			feature: '模型',
			phase: 'model',
			message: '创建 ChatOpenAI 实例',
			detail: formatDebugDetail({
				model: resolved.modelName,
				baseUrl: resolved.baseUrl,
				protocol: resolved.protocol,
				structuredOutput: resolved.structuredOutput,
				streaming: resolved.streamingEnabled,
				maxTokens,
				timeout: REQUEST_TIMEOUT_MS,
				maxRetries: REQUEST_MAX_RETRIES,
				proxy: resolved.proxyEnabled
					? formatProxyAddress(resolved.proxyUrl)
					: undefined,
			}),
		});
	}

	// 推理类模型显式关闭思考模式；其他接口发送未知字段可能被拒绝，保持不发送
	const modelKwargs: Record<string, unknown> = {};
	if (THINKING_DISABLED_PATTERN.test(resolved.modelName)) {
		modelKwargs.thinking = { type: 'disabled' };
	}

	const configuration: ChatOpenAIFields['configuration'] = {
		baseURL: resolved.baseUrl,
	};
	const proxyAddress = resolved.proxyUrl.trim();
	if (resolved.proxyEnabled && proxyAddress) {
		const proxyFetch = createProxyFetch(proxyAddress);
		if (proxyFetch) {
			configuration.fetch = proxyFetch;
		}
	}

	return new ChatOpenAI({
		model: resolved.modelName,
		apiKey: resolved.apiKey || undefined,
		configuration,
		temperature: 0.3,
		maxTokens,
		streaming: resolved.streamingEnabled,
		timeout: REQUEST_TIMEOUT_MS,
		maxRetries: REQUEST_MAX_RETRIES,
		// 保留原始响应分块，便于流式兼容读取 reasoning_content
		__includeRawResponse: true,
		modelKwargs,
	});
}
