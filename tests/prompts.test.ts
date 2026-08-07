import { describe, it, expect } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import { isConfigValid } from '../src/types';

const GRAMMAR_SYSTEM_PROMPT = `你是一个专业的英语语法分析助手。
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

const GENERATE_SYSTEM_PROMPT = `你是一个英语学习试题生成助手。
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

如果提供了参考英语表达，生成的句子应尽量用到该参考表达的语法结构。`;

const EVALUATE_SYSTEM_PROMPT = `你是一个英语翻译评估助手。
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

describe('ChatPromptTemplate 编译', () => {

	it('语法分析 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(GRAMMAR_SYSTEM_PROMPT),
			['human', '{sentence}'],
		]);
		const result = await prompt.invoke({ sentence: 'The cat sat on the mat.' });
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
		// 系统消息应包含完整的 JSON 示例内容
		const sysMsg = result.messages[0]?.content as string;
		expect(sysMsg).toContain('主语');
		expect(sysMsg).toContain('谓语');
	});

	it('翻译生成 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(GENERATE_SYSTEM_PROMPT),
			['human', '难度：{difficulty}\n参考英语表达：{reference}\n请生成一道翻译练习题。'],
		]);
		const result = await prompt.invoke({
			difficulty: 'cet4',
			reference: '（无）',
		});
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
	});

	it('翻译评估 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(EVALUATE_SYSTEM_PROMPT),
			[
				'human',
				'中文原文：{chinese}\n用户翻译：{userTranslation}\n参考表达：{reference}\n难度级别：{difficulty}\n请评估用户翻译的质量，使用中文回复用户。',
			],
		]);
		const result = await prompt.invoke({
			chinese: '猫坐在垫子上。',
			userTranslation: 'The cat sat on the mat.',
			reference: '（无）',
			difficulty: 'cet4',
		});
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
	});

	it('isConfigValid 应正确判断配置完整性', () => {
		expect(isConfigValid({ baseUrl: '', modelName: '' })).toBe(false);
		expect(isConfigValid({ baseUrl: 'http://localhost:1234/v1', modelName: '' })).toBe(false);
		expect(isConfigValid({ baseUrl: '', modelName: 'gpt-4o' })).toBe(false);
		expect(isConfigValid({ baseUrl: 'http://localhost:1234/v1', modelName: 'gpt-4o' })).toBe(true);
	});
});
