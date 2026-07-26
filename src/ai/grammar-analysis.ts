import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { GrammarResult } from '../types';
import { createModel } from './index';

/** 语法分析的系统提示语 */
const SYSTEM_PROMPT = `你是一个专业的英语语法分析助手。
分析用户输入的英语句子，返回严格的 JSON 格式，不要包含任何其他内容。

{
  "sentence": "原句",
  "components": [
    { "text": "单词或短语", "type": "subject|predicate|object|attribute|adverbial|complement|clause|other" }
  ],
  "clauses": [
    { "text": "从句完整文本", "level": 1, "type": "从句类型" }
  ],
  "tense": "时态",
  "voice": "语态",
  "mood": "语气",
  "sentenceType": "句型",
  "structureSummary": "结构概括"
}

成分类型说明：
- subject: 主语
- predicate: 谓语
- object: 宾语
- attribute: 定语
- adverbial: 状语
- complement: 补语
- clause: 从句整体
- other: 其他

注意：
1. components 数组需要按句子中出现的顺序排列
2. 从句类型如 "状语从句"、"定语从句"、"宾语从句"、"主语从句"、"表语从句"、"同位语从句"
3. 如果有多重嵌套从句，level 从 1 开始递增`;

/**
 * 对输入句子进行语法分析
 * @param sentence 用户输入的英语句子
 * @param settings 插件设置
 * @returns 语法分析结果
 */
export async function analyzeGrammar(
	sentence: string,
	settings: EnPracticeSettings,
): Promise<GrammarResult> {
	const model = createModel(settings);
	const prompt = ChatPromptTemplate.fromMessages([
		new SystemMessage(SYSTEM_PROMPT),
		['human', '{sentence}'],
	]);
	const parser = new JsonOutputParser<GrammarResult>();
	const chain = prompt.pipe(model).pipe(parser);
	return await chain.invoke({ sentence });
}
