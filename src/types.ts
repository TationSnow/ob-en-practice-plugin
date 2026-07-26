/** 难度级别 */
export type Difficulty = 'cet4' | 'cet6' | 'postgraduate';

/** 难度级别显示文本映射 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
	cet4: '四级',
	cet6: '六级',
	postgraduate: '考研',
};

/** 语法成分类型 */
export type ComponentType =
	| 'subject'       // 主语
	| 'predicate'     // 谓语
	| 'object'        // 宾语
	| 'attribute'     // 定语
	| 'adverbial'     // 状语
	| 'complement'    // 补语
	| 'clause'        // 从句
	| 'other';        // 其他

/** 语法分析中的单个成分 */
export interface SentenceComponent {
	text: string;
	type: ComponentType;
}

/** 从句信息 */
export interface ClauseInfo {
	text: string;
	level: number;    // 从句层级（1 为主从句，2 为嵌套从句）
	type: string;     // 如 "状语从句"、"定语从句"、"名词性从句"
}

/** 语法分析结果 */
export interface GrammarResult {
	sentence: string;
	components: SentenceComponent[];
	clauses: ClauseInfo[];
	tense: string;         // 时态，如 "一般现在时"
	voice: string;         // 语态，如 "主动语态"
	mood: string;          // 语气，如 "陈述语气"
	sentenceType: string;  // 句型，如 "复合句"
	structureSummary: string; // 结构概括
}

/** 翻译生成题目的结果 */
export interface TranslationQuestion {
	chinese: string;
	hint: string;
	targetGrammar: string;
}

/** 翻译评估结果 */
export interface TranslationEvaluation {
	score: number;
	strengths: string[];
	weaknesses: string[];
	suggestions: string;
	improvedVersion: string;
}

/** AI 调用错误 */
export interface AiError {
	message: string;
	code: 'CONFIG_MISSING' | 'API_ERROR' | 'PARSE_ERROR';
}

/** 检查插件设置是否完整 */
export function isConfigValid(settings: {
	baseUrl: string;
	modelName: string;
}): boolean {
	return settings.baseUrl.trim() !== '' && settings.modelName.trim() !== '';
}
