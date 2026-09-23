import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { Difficulty, TranslationQuestion, TranslationEvaluation } from '../types';
import type { VocabularyWordHint } from '../vocabulary/book';
import { createRandomSeed } from '../utils/writing-options';
import {
	EVALUATE_SYSTEM_PROMPT,
	GENERATE_SYSTEM_PROMPT,
} from './prompts';
import {
	translationEvaluationSchema,
	translationQuestionSchema,
} from './schemas';
import {
	runStructuredTask,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 生成翻译题目的提示词模板，模块级复用避免每次调用重新编译 */
const GENERATE_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
	new SystemMessage(GENERATE_SYSTEM_PROMPT),
	[
		'human',
		// 字段必须标注角色：参考句仅作语法参考（否则模型会把参考句当待翻译内容），主题是内容硬约束（否则主题被模型忽略），
		// 生词本目标单词是词汇硬约束（否则模型忽略指定单词）
		'难度级别：{difficulty}\n参考英语表达（仅参考其语法结构，严禁翻译其内容）：{reference}\n主题（语句内容必须围绕该主题）：{theme}\n生词本目标单词（未提供时为“（无）”）：{vocabulary}\n请生成一道翻译练习题。\n随机数种子：{seed}',
	],
]);

/** 评估翻译的提示词模板，模块级复用避免每次调用重新编译 */
const EVALUATE_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
	new SystemMessage(EVALUATE_SYSTEM_PROMPT),
	[
		'human',
		'中文原文：{chinese}\n用户翻译：{userTranslation}\n参考表达：{reference}\n难度级别：{difficulty}\n请评估用户翻译的质量，使用中文回复用户。',
	],
]);

/** 翻译题目生成的可选参数 */
export interface QuestionGenerationOptions {
	/** 题目主题；不传或为空表示不指定主题 */
	theme?: string | null;
	/** 随机数种子；不传时自动生成随机种子 */
	seed?: string;
	/** 生词本目标单词（单词 + 中文含义）；提供时题目必须围绕这些单词出题 */
	vocabulary?: VocabularyWordHint[];
}

/**
 * 渲染生词本目标单词的提示词变量：每行“- 单词：含义”。
 * 未提供时渲染（无）占位符（与主题/参考句的缺省语义一致）。
 * @param vocabulary 生词本目标单词
 */
function formatVocabularyVariable(
	vocabulary: VocabularyWordHint[] | undefined,
): string {
	if (!vocabulary || vocabulary.length === 0) {
		return '（无）';
	}
	return vocabulary
		.map((item) => `- ${item.word}：${item.meaning}`)
		.join('\n');
}

/**
 * 生成翻译练习题
 * @param reference 参考英语表达（可选）
 * @param difficulty 难度级别
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @param generation 主题、随机种子与生词本目标单词参数
 * @returns 生成的题目
 */
export async function generateQuestion(
	reference: string,
	difficulty: Difficulty,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
	generation?: QuestionGenerationOptions,
): Promise<TranslationQuestion> {
	const theme = generation?.theme?.trim() || '（无）';
	const seed = generation?.seed?.trim() || createRandomSeed();
	return runStructuredTask(settings, options, {
		outputName: 'translationQuestion',
		prompt: GENERATE_PROMPT_TEMPLATE,
		schema: translationQuestionSchema,
		variables: {
			difficulty,
			reference: reference || '（无）',
			theme,
			vocabulary: formatVocabularyVariable(generation?.vocabulary),
			seed,
		},
	});
}

/**
 * 评估用户翻译
 * @param chinese 中文原文
 * @param userTranslation 用户翻译
 * @param reference 参考英语表达（可选）
 * @param difficulty 难度级别
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @returns 评估结果
 */
export async function evaluateTranslation(
	chinese: string,
	userTranslation: string,
	reference: string,
	difficulty: Difficulty,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<TranslationEvaluation> {
	return runStructuredTask(settings, options, {
		outputName: 'translationEvaluation',
		prompt: EVALUATE_PROMPT_TEMPLATE,
		schema: translationEvaluationSchema,
		variables: {
			chinese,
			userTranslation,
			reference: reference || '（无）',
			difficulty,
		},
	});
}
