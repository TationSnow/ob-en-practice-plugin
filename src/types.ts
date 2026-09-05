import type {
	ClauseInfo,
	ComponentType,
	GrammarImprovementResult,
	GrammarIssue,
	GrammarPattern,
	GrammarResult,
	GrammarRouterResult,
	SentenceComponent,
	TranslationEvaluation,
	TranslationQuestion,
} from './ai/schemas';
import { resolveActiveModelSettings, type GlobalModelDefaults } from './settings/models';

export type {
	ClauseInfo,
	ComponentType,
	GrammarImprovementResult,
	GrammarIssue,
	GrammarPattern,
	GrammarResult,
	GrammarRouterResult,
	SentenceComponent,
	TranslationEvaluation,
	TranslationQuestion,
};

/** 难度级别 */
export type Difficulty = 'cet4' | 'cet6' | 'postgraduate';

/** 难度级别显示文本映射 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
	cet4: '四级',
	cet6: '六级',
	postgraduate: '考研',
};

/** AI 调用错误 */
export class AiError extends Error {
	readonly code: 'CONFIG_MISSING' | 'API_ERROR' | 'PARSE_ERROR';

	constructor(
		code: 'CONFIG_MISSING' | 'API_ERROR' | 'PARSE_ERROR',
		message: string,
	) {
		super(message);
		this.name = 'AiError';
		this.code = code;
	}
}

/** 检查插件设置是否完整（基于激活模型档位解析后的运行配置判定） */
export function isConfigValid(settings: GlobalModelDefaults): boolean {
	const resolved = resolveActiveModelSettings(settings);
	return resolved.baseUrl !== '' && resolved.modelName !== '';
}
