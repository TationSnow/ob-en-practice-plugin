/**
 * 结构化输出模式层：负责“结构化输出”与各家 OpenAI 兼容后端能力的适配。
 *
 * 背景：structured-output 统一以 response_format 约束模型输出 JSON，
 * 但各家后端支持度分裂——LM Studio / llama.cpp / vLLM 只接受 json_schema，
 * DeepSeek 等部分云端只接受 json_object，个别老网关两者皆不支持。
 * 因此按模型档位配置模式（auto 阶梯或手动锁定），请求失败特征命中时
 * 在调用链内自动降级并缓存已验证能力，避免每次请求重复探测。
 */

import { toJsonSchema } from '@langchain/core/utils/json_schema';
import type { z } from 'zod';
import type { StructuredOutputMode } from '../settings/models';

/** 具体结构化输出模式（auto 在请求时解析为具体值） */
export type ConcreteStructuredOutputMode = Exclude<StructuredOutputMode, 'auto'>;

/** OpenAI 兼容接口的 response_format 载荷（本插件用到的结构化子集） */
export type ResponseFormatPayload =
	| { type: 'json_object' }
	| {
			type: 'json_schema';
			json_schema: {
				/** 架构名称（OpenAI 要求 ^[a-zA-Z0-9_-]{1,64}$，直接复用任务标识） */
				name: string;
				/** JSON Schema 定义 */
				schema: Record<string, unknown>;
			};
	  };

/**
 * 解析请求阶梯：auto 按兼容面从广到窄依次尝试
 * （json_object 为既有云端默认行为，保持无回归；json_schema 覆盖 LM Studio 等本地后端；
 * none 不发送该字段，由提示词约束 + 本地解析修复兜底）。
 * 手动模式只尝试用户指定的单一模式，行为完全确定。
 * @param mode 档位配置的结构化输出模式
 * @returns 依次尝试的模式列表
 */
export function resolveModeLadder(
	mode: StructuredOutputMode,
): ConcreteStructuredOutputMode[] {
	if (mode === 'auto') {
		return ['json_object', 'json_schema', 'none'];
	}
	return [mode];
}

/**
 * 把 zod schema 转换为请求用 JSON Schema。
 * @langchain/core 的 toJsonSchema 在不传自定义参数时按 schema 引用内部缓存，
 * 无需额外缓存层；递归 schema（z.lazy）以 $defs/$ref 表达。
 * @param schema zod schema
 * @returns JSON Schema 对象
 */
export function zodToJsonSchemaForRequest(
	schema: z.ZodType,
): Record<string, unknown> {
	return toJsonSchema(schema);
}

/**
 * 构造 response_format 载荷；none 模式返回 undefined（完全不发送该字段）。
 * json_schema 载荷兼容 OpenAI / LM Studio / llama.cpp / vLLM 等实现。
 * @param mode 具体结构化输出模式
 * @param schema zod schema（json_schema 模式需要）
 * @param name 架构名称（json_schema 模式需要，取任务标识）
 * @returns 载荷；none 模式为 undefined
 */
export function responseFormatPayload(
	mode: ConcreteStructuredOutputMode,
	schema: z.ZodType,
	name: string,
): ResponseFormatPayload | undefined {
	if (mode === 'none') {
		return undefined;
	}
	if (mode === 'json_object') {
		return { type: 'json_object' };
	}
	return {
		type: 'json_schema',
		json_schema: { name, schema: zodToJsonSchemaForRequest(schema) },
	};
}

/**
 * 获取错误的可读文本。
 * @param err 未知错误
 * @returns 错误信息
 */
export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * 判断错误是否为“后端不支持该 response_format”的特征错误。
 * 严格签名限定：HTTP 400（openai SDK 错误对象的 status 属性，
 * 或 LangChain 包装后以 “400 ” 开头的消息）且错误文本含 response_format 关键词。
 * 其余 400（如上下文超长、鉴权失败）与任何其他错误一律不视为该特征，避免误降级。
 * @param err 待判定错误
 * @returns 是否命中特征
 */
export function isResponseFormatUnsupportedError(err: unknown): boolean {
	const text = getErrorMessage(err);
	if (!/response_format/i.test(text)) {
		return false;
	}
	const status = (err as { status?: unknown }).status;
	if (typeof status === 'number') {
		return status === 400;
	}
	return /^400\s/.test(text);
}

/**
 * 后端能力缓存：记录“某接入口已验证可用的结构化输出模式”，
 * 使 auto 阶梯只在首次请求时付出降级探测成本，后续请求直达正确模式。
 * 键为 协议|地址|模型名；仅存于内存（Obsidian 重启后自动失效，重新探测无副作用）。
 */
const capabilityCache = new Map<string, ConcreteStructuredOutputMode>();

/**
 * 构造能力缓存键。
 * @param protocol 接口协议
 * @param baseUrl API 地址
 * @param modelName 模型名称
 * @returns 缓存键
 */
export function modelCapabilityCacheKey(
	protocol: string,
	baseUrl: string,
	modelName: string,
): string {
	return `${protocol}|${baseUrl.trim()}|${modelName.trim()}`;
}

/**
 * 读取已验证的结构化输出模式。
 * @param key 缓存键
 * @returns 已验证模式；未探测过返回 undefined
 */
export function getCachedStructuredMode(
	key: string,
): ConcreteStructuredOutputMode | undefined {
	return capabilityCache.get(key);
}

/**
 * 写入已验证的结构化输出模式。
 * @param key 缓存键
 * @param mode 请求成功时实际使用的模式
 */
export function setCachedStructuredMode(
	key: string,
	mode: ConcreteStructuredOutputMode,
): void {
	capabilityCache.set(key, mode);
}

/**
 * 清除单个接入口的能力缓存（缓存模式请求失败时使用，后端配置可能已变化）。
 * @param key 缓存键
 */
export function clearCachedStructuredMode(key: string): void {
	capabilityCache.delete(key);
}

/** 清空全部能力缓存（测试复位用） */
export function clearStructuredCapabilityCache(): void {
	capabilityCache.clear();
}
