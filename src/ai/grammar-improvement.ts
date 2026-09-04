import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarImprovementResult } from '../types';
import { GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT } from './prompts';
import { grammarImprovementSchema } from './schemas';
import {
	runStructuredTask,
	type StructuredOutputCallOptions,
} from './structured-output';

/** 语法改进提示词模板，模块级复用避免每次调用重新编译 */
const IMPROVEMENT_PROMPT = ChatPromptTemplate.fromMessages([
	new SystemMessage(GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT),
	['human', '{sentence}'],
]);

/** 改进建议输出体积可预期，收紧上限防止失控生成（曾出现 140KB 的重复输出） */
const IMPROVEMENT_MAX_TOKENS = 4096;

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
	return runStructuredTask(settings, options, {
		outputName: 'grammarImprovement',
		prompt: IMPROVEMENT_PROMPT,
		schema: grammarImprovementSchema,
		variables: { sentence },
		maxTokens: IMPROVEMENT_MAX_TOKENS,
	});
}
