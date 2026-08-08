import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { Difficulty, TranslationQuestion, TranslationEvaluation } from '../types';
import { createModel } from './index';
import {
	EVALUATE_SYSTEM_PROMPT,
	GENERATE_SYSTEM_PROMPT,
} from './prompts';
import {
	translationEvaluationSchema,
	translationQuestionSchema,
} from './schemas';
import {
	invokeStructured,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 生成翻译题目的提示词模板，模块级复用避免每次调用重新编译 */
const GENERATE_PROMPT_TEMPLATE = ChatPromptTemplate.fromMessages([
	new SystemMessage(GENERATE_SYSTEM_PROMPT),
	[
		'human',
		'难度：{difficulty}\n参考英语表达：{reference}\n请生成一道翻译练习题。',
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

/**
 * 生成翻译练习题
 * @param reference 参考英语表达（可选）
 * @param difficulty 难度级别
 * @param settings 插件设置
 * @returns 生成的题目
 */
export async function generateQuestion(
	reference: string,
	difficulty: Difficulty,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<TranslationQuestion> {
	const model = createModel(settings);
	return invokeStructured({
		model,
		prompt: GENERATE_PROMPT_TEMPLATE,
		schema: translationQuestionSchema,
		outputName: 'translationQuestion',
		variables: { difficulty, reference: reference || '（无）' },
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
	});
}

/**
 * 评估用户翻译
 * @param chinese 中文原文
 * @param userTranslation 用户翻译
 * @param reference 参考英语表达（可选）
 * @param difficulty 难度级别
 * @param settings 插件设置
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
	const model = createModel(settings);
	return invokeStructured({
		model,
		prompt: EVALUATE_PROMPT_TEMPLATE,
		schema: translationEvaluationSchema,
		outputName: 'translationEvaluation',
		variables: {
			chinese,
			userTranslation,
			reference: reference || '（无）',
			difficulty,
		},
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
	});
}
