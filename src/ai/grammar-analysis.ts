import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarResult } from '../types';
import { normalizeGrammarResult } from './grammar-normalize';
import {
	repairGrammarResult,
	validateGrammarResult,
} from './grammar-validator';
import { GRAMMAR_SYSTEM_PROMPT } from './prompts';
import { grammarSchema } from './schemas';
import {
	runStructuredTask,
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
 * @param options 流式/调试选项
 * @returns 语法分析结果
 */
export async function analyzeGrammar(
	sentence: string,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<GrammarResult> {
	const result = await runStructuredTask(settings, options, {
		outputName: 'grammarResult',
		prompt: GRAMMAR_PROMPT,
		schema: grammarSchema,
		variables: { sentence },
		additionalValidation: (parsed) => {
			// 先自动修复句尾标点等可修复差异，再做业务校验，
			// 避免“模型补句号”这类无害差异触发整体失败
			repairGrammarResult(parsed, sentence);
			return validateGrammarResult(parsed, sentence);
		},
	});
	// 时态重复等“可修复冗余”在结果返回前归一化，避免 UI 展示重复标签
	return normalizeGrammarResult(result);
}
