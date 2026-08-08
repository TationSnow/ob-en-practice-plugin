import { z } from 'zod';

/** 语法成分类型常量，供 UI 标注与 schema 校验共用 */
export const COMPONENT_TYPES = [
	'subject',
	'predicate',
	'object',
	'attribute',
	'adverbial',
	'complement',
	'clause',
	'other',
] as const;

/** 语法成分类型 */
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** 语法分析中的单个成分 schema */
const sentenceComponentSchema = z.object({
	text: z.string().describe('单词或短语'),
	type: z.enum(COMPONENT_TYPES).describe('成分类型'),
}).strict();

/** 从句信息 schema */
const clauseInfoSchema = z.object({
	text: z.string().describe('从句完整文本'),
	level: z.number().int().min(1).describe('从句层级，1 为主从句'),
	type: z.string().describe('从句类型'),
}).strict();

/** 语法分析结果 schema */
export const grammarSchema = z.object({
	sentence: z.string().describe('原句'),
	components: z.array(sentenceComponentSchema).describe('按句子出现顺序排列的成分列表'),
	clauses: z.array(clauseInfoSchema).describe('从句列表，按嵌套层级从 1 开始递增'),
	tense: z.string().describe('时态'),
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
