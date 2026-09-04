import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarRouterResult } from '../types';
import { createModel } from './index';
import { GRAMMAR_ROUTER_SYSTEM_PROMPT } from './prompts';
import { grammarRouterSchema } from './schemas';
import {
	invokeStructured,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 语法路由判定提示词模板，模块级复用避免每次调用重新编译 */
const ROUTER_PROMPT = ChatPromptTemplate.fromMessages([
	new SystemMessage(GRAMMAR_ROUTER_SYSTEM_PROMPT),
	['human', '{sentence}'],
]);

/**
 * 判断句子是否存在语法问题，供语法分析图做分流。
 * @param sentence 用户输入的英语句子
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @returns 路由判定结果
 */
export async function classifyGrammar(
	sentence: string,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<GrammarRouterResult> {
	const model = createModel(settings);
	return invokeStructured({
		model,
		prompt: ROUTER_PROMPT,
		schema: grammarRouterSchema,
		outputName: 'grammarRouter',
		variables: { sentence },
		maxRetries: settings.retryCount,
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		thinkingEnabled: settings.thinkingEnabled,
	});
}
