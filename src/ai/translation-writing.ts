import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { SystemMessage } from '@langchain/core/messages';
import type { EnPracticeSettings } from '../settings';
import type { Difficulty, TranslationQuestion, TranslationEvaluation } from '../types';
import { createModel } from './index';

/** 生成翻译题目的系统提示语 */
const GENERATE_PROMPT = `你是一个英语学习试题生成助手。
根据难度级别生成一句需要翻译的中文语句，返回严格的 JSON 格式。

{
  "chinese": "中文语句",
  "hint": "提示信息（包含目标语法点）",
  "targetGrammar": "目标语法点说明"
}

难度级别说明：
- cet4: 四级难度，使用基础词汇和简单句型
- cet6: 六级难度，使用较复杂词汇和句型
- postgraduate: 考研难度，使用高级词汇和复杂句式

注意：
- 如果提供了参考英语表达，生成的句子必须用到该参考表达的语法结构。
- 给出的中文语句不能和参考英语一样或者形似。
`;

/** 评估翻译的系统提示语 */
const EVALUATE_PROMPT = `你是一个英语翻译评估助手。
评估用户翻译的质量，给出改进建议。返回严格的 JSON 格式。

{
  "score": 0-100 的整数分数,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "suggestions": "具体的改进建议",
  "improvedVersion": "优化后的翻译版本"
}

评估维度：
1. 语法准确性
2. 词汇使用
3. 表达自然度
4. 与原文意思的一致性`;

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
): Promise<TranslationQuestion> {
	const model = createModel(settings);
	const prompt = ChatPromptTemplate.fromMessages([
		new SystemMessage(GENERATE_PROMPT),
		[
			'human',
			'难度：{difficulty}\n参考英语表达：{reference}\n请生成一道翻译练习题。',
		],
	]);
	const parser = new JsonOutputParser<TranslationQuestion>();
	const chain = prompt.pipe(model).pipe(parser);
	return await chain.invoke({ difficulty, reference: reference || '（无）' });
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
): Promise<TranslationEvaluation> {
	const model = createModel(settings);
	const prompt = ChatPromptTemplate.fromMessages([
		new SystemMessage(EVALUATE_PROMPT),
		[
			'human',
			'中文原文：{chinese}\n用户翻译：{userTranslation}\n参考表达：{reference}\n难度级别：{difficulty}\n请评估用户翻译的质量，使用中文回复用户。',
		],
	]);
	const parser = new JsonOutputParser<TranslationEvaluation>();
	const chain = prompt.pipe(model).pipe(parser);
	return await chain.invoke({
		chinese,
		userTranslation,
		reference: reference || '（无）',
		difficulty,
	});
}
