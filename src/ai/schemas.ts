import { z } from 'zod';

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

/** 语法分析中的单个成分 schema */
const sentenceComponentSchema = z.object({
	text: z
		.string()
		.min(1)
		.describe('成分的完整文本，必须是原句中的连续字符片段，且包含全部修饰语'),
	type: z.enum(COMPONENT_TYPES).describe('成分类型'),
	details: z
		.string()
		.optional()
		.describe('可选，对该成分内部结构或修饰关系的简要说明'),
}).strict();

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
}).strict();

/** 语法分析结果 schema */
export const grammarSchema = z.object({
	sentence: z.string().describe('原句'),
	components: z.array(sentenceComponentSchema).describe('按句子出现顺序排列的成分列表'),
	clauses: z
		.array(clauseInfoSchema)
		.describe('主句与从句列表，level 0 为主句，从句层级逐级递增'),
	tense: z
		.array(z.string().min(1))
		.min(1)
		.describe('所有出现的时态，不重复，按出现顺序排列')
		.refine((items) => new Set(items).size === items.length, {
			message: '时态列表不能重复',
		}),
	voice: z.string().describe('语态'),
	mood: z.string().describe('语气'),
	sentenceType: z.string().describe('句型'),
	structureSummary: z.string().describe('结构概括'),
}).strict();

export type SentenceComponent = z.infer<typeof sentenceComponentSchema>;
export type ClauseInfo = z.infer<typeof clauseInfoSchema>;
export type GrammarResult = z.infer<typeof grammarSchema>;

/** 翻译生成题目 schema */
export const translationQuestionSchema = z.object({
	chinese: z.string().describe('中文语句'),
	hint: z.string().describe('提示信息，包含目标语法点'),
	targetGrammar: z.string().describe('目标语法点说明'),
}).strict();

export type TranslationQuestion = z.infer<typeof translationQuestionSchema>;

/** 翻译评估结果 schema */
export const translationEvaluationSchema = z.object({
	score: z.number().int().min(0).max(100).describe('0-100 的整数分数'),
	strengths: z.array(z.string()).describe('优点列表'),
	weaknesses: z.array(z.string()).describe('不足列表'),
	suggestions: z.string().describe('具体的改进建议'),
	improvedVersion: z.string().describe('优化后的翻译版本'),
}).strict();

export type TranslationEvaluation = z.infer<typeof translationEvaluationSchema>;
