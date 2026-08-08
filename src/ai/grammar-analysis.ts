import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarResult } from '../types';
import { createModel } from './index';
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
	return invokeStructured({
		model,
		prompt: GRAMMAR_PROMPT,
		schema: grammarSchema,
		outputName: 'grammarResult',
		variables: { sentence },
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
	});
}
