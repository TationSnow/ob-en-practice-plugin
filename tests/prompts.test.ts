import { describe, it, expect } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import {
	EVALUATE_SYSTEM_PROMPT,
	GENERATE_SYSTEM_PROMPT,
	GRAMMAR_SYSTEM_PROMPT,
} from '../src/ai/prompts';
import { isConfigValid } from '../src/types';

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
		expect(sysMsg).toContain('predicate');
		expect(sysMsg).toContain('attributive');
		expect(sysMsg).toContain('主句');
		expect(sysMsg).toContain('function');
		expect(sysMsg).toContain('tense');
		expect(sysMsg).toContain('JSON');
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
