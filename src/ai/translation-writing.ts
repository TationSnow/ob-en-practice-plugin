import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { Difficulty, TranslationQuestion, TranslationEvaluation } from '../types';
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
		'难度：{difficulty}\n参考英语表达：{reference}\n主题：{theme}\n请生成一道翻译练习题。\n随机数种子：{seed}',
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
}

/**
 * 生成翻译练习题
 * @param reference 参考英语表达（可选）
 * @param difficulty 难度级别
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @param generation 主题与随机种子参数
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
