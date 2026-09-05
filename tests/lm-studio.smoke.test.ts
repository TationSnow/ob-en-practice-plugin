import { describe, expect, it } from 'vitest';
import { classifyGrammar } from '../src/ai/grammar-router';
import { clearDebugLog, getDebugLog } from '../src/ai/debug-log';
import {
	clearStructuredCapabilityCache,
	getCachedStructuredMode,
	modelCapabilityCacheKey,
} from '../src/ai/structured-mode';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EnPracticeSettings } from '../src/settings';

/**
 * LM Studio 真机冒烟测试（默认跳过，避免日常测试依赖本地服务）：
 *   LM_SMOKE=1 npx vitest run tests/lm-studio.smoke.test.ts
 *
 * 直连本地 LM Studio（OpenAI 兼容协议，无需 API Key），验证 response_format
 * 兼容修复的完整链路：
 * 1. auto 模式：json_object 被拒（LM Studio 仅支持 json_schema/text）
 *    → 自动降级 json_schema → 请求成功 → 能力缓存写入 json_schema；
 * 2. 手动 json_schema 模式：直接成功；
 * 3. none 模式：不发送 response_format，靠提示词约束 + 本地修复解析成功。
 */

const LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1';
const LM_STUDIO_MODEL = 'qwen3.8-9b-heretic-uncensored-nvfp4';
const SMOKE_ENABLED = process.env.LM_SMOKE === '1';

/** 路由判定用的示例句子（与真实日志一致） */
const SMOKE_SENTENCE =
	'Some schools require students to provide community service by volunteering in a nursing home, child care center or government agency.';

/** 构造指向本地 LM Studio 的设置 */
function createSettings(structuredOutput: EnPracticeSettings['models'][number]['structuredOutput']): EnPracticeSettings {
	return {
		...DEFAULT_SETTINGS,
		models: [
			{
				id: 'smoke-local',
				name: '本地 LM Studio',
				protocol: 'openai-compatible',
				baseUrl: LM_STUDIO_BASE_URL,
				// LM Studio 无需真实密钥，但 openai SDK 要求非空凭据（与设置页提示一致）
				apiKey: 'lm-studio',
				modelName: LM_STUDIO_MODEL,
				structuredOutput,
			},
		],
		activeModelId: 'smoke-local',
	};
}

describe.skipIf(!SMOKE_ENABLED)(
	'LM Studio 真机冒烟（LM_SMOKE=1 开启）',
	() => {
		it(
			'auto 模式：json_object 被拒后自动降级 json_schema 成功并缓存能力',
			async () => {
				clearStructuredCapabilityCache();
				clearDebugLog();
				const result = await classifyGrammar(
					SMOKE_SENTENCE,
					createSettings('auto'),
					{ debug: true },
				);

				expect(typeof result.hasGrammarIssues).toBe('boolean');
				// 调试日志完整记录降级过程
				const messages = getDebugLog().map((entry) => entry.message);
				expect(messages).toContain(
					'接口不支持 json_object 模式的 response_format',
				);
				// 能力缓存写入探测结论，后续请求直达 json_schema
				expect(
					getCachedStructuredMode(
						modelCapabilityCacheKey(
							'openai-compatible',
							LM_STUDIO_BASE_URL,
							LM_STUDIO_MODEL,
						),
					),
				).toBe('json_schema');
			},
			120_000,
		);

		it(
			'手动 json_schema 模式直接成功',
			async () => {
				const result = await classifyGrammar(
					SMOKE_SENTENCE,
					createSettings('json_schema'),
				);
				expect(typeof result.hasGrammarIssues).toBe('boolean');
			},
			120_000,
		);

		it(
			'none 模式不发送 response_format，依赖提示词与本地修复解析成功',
			async () => {
				clearStructuredCapabilityCache();
				const result = await classifyGrammar(
					SMOKE_SENTENCE,
					createSettings('none'),
				);
				expect(typeof result.hasGrammarIssues).toBe('boolean');
			},
			120_000,
		);
	},
);
