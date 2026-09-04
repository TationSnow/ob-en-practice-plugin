import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarImprovementResult } from '../types';
import { createModel } from './index';
import { GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT } from './prompts';
import { grammarImprovementSchema } from './schemas';
import {
	invokeStructured,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 语法改进提示词模板，模块级复用避免每次调用重新编译 */
const IMPROVEMENT_PROMPT = ChatPromptTemplate.fromMessages([
	new SystemMessage(GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT),
	['human', '{sentence}'],
]);

/**
 * 对存在语法问题的句子给出改进建议。
 * @param sentence 用户输入的英语句子
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @returns 语法改进结果
 */
export async function improveGrammar(
	sentence: string,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<GrammarImprovementResult> {
	const model = createModel(settings);
	return invokeStructured({
		model,
		prompt: IMPROVEMENT_PROMPT,
		schema: grammarImprovementSchema,
		outputName: 'grammarImprovement',
		variables: { sentence },
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
	});
}
