import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarResult } from '../types';
import { createModel } from './index';
import { normalizeGrammarResult } from './grammar-normalize';
import { validateGrammarResult } from './grammar-validator';
import { GRAMMAR_SYSTEM_PROMPT } from './prompts';
import { grammarSchema } from './schemas';
import {
	invokeStructured,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 语法分析提示词模板，模块级复用避免每次调用重新编译 */
const GRAMMAR_PROMPT = ChatPromptTemplate.fromMessages([
	new SystemMessage(GRAMMAR_SYSTEM_PROMPT),
	['human', '{sentence}'],
]);

/**
 * 对输入句子进行语法分析
 * @param sentence 用户输入的英语句子
 * @param settings 插件设置
 * @returns 语法分析结果
 */
export async function analyzeGrammar(
	sentence: string,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<GrammarResult> {
	const model = createModel(settings);
	const result = await invokeStructured({
		model,
		prompt: GRAMMAR_PROMPT,
		schema: grammarSchema,
		outputName: 'grammarResult',
		variables: { sentence },
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
		// 校验成分与分句是否为原句中的连续片段，不满足时自动重试
		additionalValidation: (result) =>
			validateGrammarResult(result, sentence),
		// 重试时把具体校验问题回传给模型，帮助模型针对性修正
		validationRetryHint: (issues) =>
			`上次输出未通过语法分析校验，请修正以下问题：${issues.join('；')}。` +
			'所有 components[].text 和 clauses[].text 必须逐字来自原句，' +
			'不得改写、省略中间内容或调换语序。',
	});
	// 时态重复等“可修复冗余”在结果返回前归一化，避免 UI 展示重复标签
	return normalizeGrammarResult(result);
}
