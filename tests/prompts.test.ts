import { describe, it, expect } from 'vitest';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import {
	EVALUATE_SYSTEM_PROMPT,
	GENERATE_SYSTEM_PROMPT,
	GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT,
	GRAMMAR_ROUTER_SYSTEM_PROMPT,
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
		// 输出字段要求：sentence 原样返回 + 中文翻译
		expect(sysMsg).toContain('translation');
		expect(sysMsg).toContain('原样保留');
		// 字段值引用词语必须用中文引号，避免未转义引号破坏 JSON
		expect(sysMsg).toContain('未转义的英文双引号');
		// 示例必须与“包含从句的成分必须提供 children”规则自洽：
		// 主示例的主语成分（含定语从句）应带 children 拆解（“定语从句的主语”仅出现在修正后的示例中）
		expect(sysMsg).toContain('定语从句的主语');
		// 显式禁令：从句整块文本不得作为无 children 的单个成分
		expect(sysMsg).toContain('严禁');
		// children 必须是父成分文本的子串；不属于父成分文本范围的从句应作平级成分
		expect(sysMsg).toContain('不得强行嵌套');
		// 引导词等列表外成分必须使用 other，避免模型发明未定义类型破坏枚举
		expect(sysMsg).toContain('一律使用 other');
	});

	it('翻译生成 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(GENERATE_SYSTEM_PROMPT),
			[
				'human',
				'难度级别：{difficulty}\n参考英语表达（仅参考其语法结构，严禁翻译其内容）：{reference}\n主题（语句内容必须围绕该主题）：{theme}\n请生成一道翻译练习题。\n随机数种子：{seed}',
			],
		]);
		const result = await prompt.invoke({
			difficulty: 'cet4',
			reference: '（无）',
			theme: '环保',
			seed: 'seed-test-1',
		});
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
		const sysMsg = result.messages[0]?.content as string;
		// 参考英语表达的角色必须明确：仅作语法参考，绝不是待翻译内容
		expect(sysMsg).toContain('绝对不是要翻译的内容');
		expect(sysMsg).toContain('严禁把参考英语表达翻译成中文');
		// 禁止表面合规：改写句、近义句、仅替换个别词语同样违规
		expect(sysMsg).toContain('仅替换个别词语');
		// 主题是内容硬约束，防止再次出现主题被忽略的回归
		expect(sysMsg).toContain('必须取自该主题领域');
		// 参考句与主题同时提供时的组合规则：内容服从主题、结构借鉴参考表达
		expect(sysMsg).toContain('内容服从主题，语法结构借鉴参考表达');
		// 占位符语义必须说明清楚
		expect(sysMsg).toContain('表示未提供');
		// 必须包含 few-shot 出题示例，锚定“内容服从主题”的正确行为
		expect(sysMsg).toContain('出题示例');
		// 共享 JSON 引号规则保持拼接
		expect(sysMsg).toContain('未转义的英文双引号');
		const humanMsg = result.messages[1]?.content as string;
		expect(humanMsg).toContain(
			'参考英语表达（仅参考其语法结构，严禁翻译其内容）：（无）',
		);
		expect(humanMsg).toContain('主题（语句内容必须围绕该主题）：环保');
		expect(humanMsg.endsWith('随机数种子：seed-test-1')).toBe(true);
	});

	it('语法路由 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(GRAMMAR_ROUTER_SYSTEM_PROMPT),
			['human', '{sentence}'],
		]);
		const result = await prompt.invoke({
			sentence: 'I am interesting in reading.',
		});
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
		const sysMsg = result.messages[0]?.content as string;
		expect(sysMsg).toContain('hasGrammarIssues');
		// 指代模糊等表达层面问题不属于语法错误，避免语法正确的句子被送进改进分支
		expect(sysMsg).toContain('指代模糊');
		expect(sysMsg).toContain('未转义的英文双引号');
	});

	it('语法改进 prompt 应能正常编译并执行 invoke', async () => {
		const prompt = ChatPromptTemplate.fromMessages([
			new SystemMessage(GRAMMAR_IMPROVEMENT_SYSTEM_PROMPT),
			['human', '{sentence}'],
		]);
		const result = await prompt.invoke({
			sentence: 'I am interesting in reading.',
		});
		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);
		const sysMsg = result.messages[0]?.content as string;
		expect(sysMsg).toContain('improvedSentence');
		// 改进分支同样要求输出中文翻译
		expect(sysMsg).toContain('translation');
		expect(sysMsg).toContain('未转义的英文双引号');
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
