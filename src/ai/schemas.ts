import { z } from 'zod';

// 所有对象 schema 均不使用 .strict()：
// 弱模型偶尔会在 JSON 中附加额外说明字段，strict 会拒绝整个输出，
// 默认模式会静默剥离未知字段，对解析更宽容，也不影响合法输出。

/** 语法成分类型常量，供 UI 标注与 schema 校验共用 */
export const COMPONENT_TYPES = [
	'subject',
	'predicate',
	'object',
	'complement',
	'adverbial',
	'attributive',
	'other',
] as const;

/** 语法成分类型 */
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** 从句类型常量，level 0 主句使用“主句”，其余为从句类型 */
export const CLAUSE_TYPES = [
	'主句',
	'定语从句',
	'状语从句',
	'主语从句',
	'宾语从句',
	'表语从句',
	'同位语从句',
	'比较从句',
] as const;

/** 除主句外的从句类型，供层级校验使用 */
export const SUBORDINATE_CLAUSE_TYPES = CLAUSE_TYPES.filter(
	(type) => type !== '主句',
);

/** 从句类型 */
export type ClauseType = (typeof CLAUSE_TYPES)[number];

/**
 * 归一化模型输出的成分类型。
 * 封闭枚举对模型过于苛刻：它偶尔会发明列表外的类型
 * （如把从句引导词标注为 conjunction），整份输出因单个字段作废得不偿失。
 * 规则：字符串去首尾空白并转小写后能命中类型列表则归位，其余一律归入 other。
 * @param value 模型输出的类型值
 * @returns 合法的成分类型
 */
function normalizeComponentType(value: unknown): ComponentType {
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if ((COMPONENT_TYPES as readonly string[]).includes(normalized)) {
			return normalized as ComponentType;
		}
	}
	return 'other';
}

/** 成分类型 schema：对模型输出宽容，未知类型归入 other 而非整体拒绝 */
const componentTypeSchema = z.preprocess(
	normalizeComponentType,
	z.enum(COMPONENT_TYPES),
);

/** 语法分析中的单个成分结构（递归：children 内可继续嵌套） */
export interface SentenceComponent {
	text: string;
	type: ComponentType;
	details?: string;
	children?: SentenceComponent[];
}

/** 语法分析中的单个成分 schema（递归定义，children 允许嵌套；输入类型为 unknown 因 type 字段经 preprocess 归一化） */
const sentenceComponentSchema: z.ZodType<
	SentenceComponent,
	z.ZodTypeDef,
	unknown
> = z.lazy(() =>
	z.object({
		text: z
			.string()
			.min(1)
			.describe('成分的完整文本，必须是原句中的连续字符片段，且包含全部修饰语'),
		type: componentTypeSchema.describe('成分类型'),
		details: z
			.string()
			.optional()
			.describe('可选，对该成分内部结构或修饰关系的简要说明'),
		children: z
			.array(sentenceComponentSchema)
			.optional()
			.describe('可选，从句内部继续标注的主语、谓语、宾语等子成分，逐层嵌套'),
	}),
);

/** 从句信息 schema */
const clauseInfoSchema = z.object({
	text: z.string().min(1).describe('主句或从句的完整文本'),
	level: z
		.number()
		.int()
		.min(0)
		.describe('0 为主句，1 为一级从句，2 为二级从句，依此类推'),
	type: z.enum(CLAUSE_TYPES).describe('主句类型为“主句”，其余为具体从句类型'),
	function: z.string().describe('该从句在句中的作用，如修饰主语、作条件状语等'),
});

/** 语法分析结果 schema */
export const grammarSchema = z.object({
	sentence: z.string().describe('原句'),
	components: z.array(sentenceComponentSchema).describe('按句子出现顺序排列的成分列表'),
	clauses: z
		.array(clauseInfoSchema)
		.describe('主句与从句列表，level 0 为主句，从句层级逐级递增'),
	// 时态去重交由 normalizeGrammarResult 后处理，不在 schema 层做业务规则校验：
	// 弱模型常按“逐谓语列出”的指令输出重复时态，refine 会直接拒绝整个结果
	tense: z
		.array(z.string().min(1))
		.min(1)
		.describe('所有出现的时态，不重复，按出现顺序排列'),
	voice: z.string().describe('语态'),
	mood: z.string().describe('语气'),
	sentenceType: z.string().describe('句型'),
	structureSummary: z.string().describe('结构概括'),
	translation: z.string().describe('整句准确、地道的中文翻译'),
});

export type ClauseInfo = z.infer<typeof clauseInfoSchema>;
export type GrammarResult = z.infer<typeof grammarSchema>;

/** 翻译生成题目 schema */
export const translationQuestionSchema = z.object({
	chinese: z.string().describe('中文语句'),
	hint: z.string().describe('提示信息，包含目标语法点'),
	targetGrammar: z.string().describe('目标语法点说明'),
});

export type TranslationQuestion = z.infer<typeof translationQuestionSchema>;

/** 翻译评估结果 schema */
export const translationEvaluationSchema = z.object({
	score: z.number().int().min(0).max(100).describe('0-100 的整数分数'),
	strengths: z.array(z.string()).describe('优点列表'),
	weaknesses: z.array(z.string()).describe('不足列表'),
	suggestions: z.string().describe('具体的改进建议'),
	improvedVersion: z.string().describe('优化后的翻译版本'),
});

export type TranslationEvaluation = z.infer<typeof translationEvaluationSchema>;

/** 语法路由判定结果 schema */
export const grammarRouterSchema = z.object({
	hasGrammarIssues: z.boolean().describe('句子是否存在语法问题'),
	summary: z
		.string()
		.optional()
		.describe('路由判定的简短理由，供调试与界面展示'),
});

export type GrammarRouterResult = z.infer<typeof grammarRouterSchema>;

/** 语法改进中的单个错误项 schema */
const grammarIssueSchema = z.object({
	text: z.string().describe('出错片段（原句中的连续片段；无法定位时使用完整句子）'),
	type: z.string().describe('错误类型，如 主谓一致、时态错误'),
	explanation: z.string().describe('错误原因说明'),
	suggestion: z.string().describe('针对该错误的修改建议'),
});

/** 语法改进中的单个句式项 schema */
const grammarPatternSchema = z.object({
	pattern: z.string().describe('使用的句式，如 between...and...'),
	usage: z.string().describe('句式用法说明'),
	example: z.string().optional().describe('符合该句式的正确例句'),
});

/** 语法改进结果 schema */
export const grammarImprovementSchema = z.object({
	sentence: z.string().describe('用户输入的原始句子'),
	issues: z.array(grammarIssueSchema).describe('语法错误列表'),
	patterns: z.array(grammarPatternSchema).describe('句子中使用的句式列表'),
	suggestions: z.array(z.string()).describe('整体改进建议列表'),
	improvedSentence: z.string().describe('改进后的句子，保留原意'),
	translation: z.string().describe('原始句子的准确、地道中文翻译'),
});

export type GrammarIssue = z.infer<typeof grammarIssueSchema>;
export type GrammarPattern = z.infer<typeof grammarPatternSchema>;
export type GrammarImprovementResult = z.infer<typeof grammarImprovementSchema>;
