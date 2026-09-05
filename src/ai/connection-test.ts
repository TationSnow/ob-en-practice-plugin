/**
 * 模型接入口连接测试。
 *
 * 复用 invokeStructured 的完整链路（response_format 模式阶梯 → 解析 → zod 校验），
 * 用一次极小请求验证连通性；auto 模式下顺带完成结构化输出能力探测并写入缓存，
 * 使正式请求不必再付出首次降级的成本。探测结论可在弹窗中展示给用户。
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import type { EnPracticeSettings } from '../settings';
import {
	resolveModelSettingsForProfile,
	type ModelProfile,
} from '../settings/models';
import { createModel } from './index';
import {
	getCachedStructuredMode,
	getErrorMessage,
	modelCapabilityCacheKey,
	type ConcreteStructuredOutputMode,
} from './structured-mode';
import { invokeStructured } from './structured-output';

/** 连接测试结果 */
export interface ConnectionTestResult {
	/** 是否连通且输出可解析 */
	ok: boolean;
	/** 摘要消息（可直接用于 Notice 展示） */
	message: string;
	/** 总耗时（毫秒） */
	latencyMs: number;
	/** 验证可用的结构化输出模式（探测结论，仅连通时存在） */
	detectedMode?: ConcreteStructuredOutputMode;
}

/** 连接测试输出 schema：字段极小，弱模型也能稳定命中 */
const CONNECTION_TEST_SCHEMA = z.object({ ok: z.boolean() });

/** 连接测试提示词：要求模型原样输出固定 JSON（{{}} 转义避免被当作模板变量） */
const CONNECTION_TEST_PROMPT = ChatPromptTemplate.fromMessages([
	['system', '你是一个连接测试探针，只输出 JSON，不要输出任何其他内容。'],
	['human', '请仅输出 {{"ok": true}}'],
]);

/**
 * 测试一个模型接入口的连通性。
 * @param profile 待测档位（可为尚未保存的表单草稿档位）
 * @param settings 插件设置（提供全局默认，如代理与最长 token）
 * @returns 测试结果
 */
export async function testModelConnection(
	profile: ModelProfile,
	settings: EnPracticeSettings,
): Promise<ConnectionTestResult> {
	const resolved = resolveModelSettingsForProfile(settings, profile);
	const cacheKey = modelCapabilityCacheKey(
		resolved.protocol,
		resolved.baseUrl,
		resolved.modelName,
	);
	const startedAt = Date.now();
	try {
		// 32 token 足够输出 {"ok": true}，控制探测成本
		await invokeStructured({
			model: createModel(resolved, 32),
			prompt: CONNECTION_TEST_PROMPT,
			schema: CONNECTION_TEST_SCHEMA,
			outputName: 'connectionTest',
			variables: { input: '' },
			structuredOutputMode: resolved.structuredOutput,
			capabilityCacheKey: cacheKey,
		});
		const detectedMode =
			resolved.structuredOutput === 'auto'
				? getCachedStructuredMode(cacheKey)
				: resolved.structuredOutput;
		return {
			ok: true,
			message: '连接成功',
			latencyMs: Date.now() - startedAt,
			detectedMode,
		};
	} catch (err) {
		return {
			ok: false,
			message: `连接失败：${getErrorMessage(err)}`,
			latencyMs: Date.now() - startedAt,
		};
	}
}
