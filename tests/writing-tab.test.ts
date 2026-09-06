import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWritingPractice } from '../src/ui/writing-tab';
import type { GrammarGraphResult } from '../src/ai/grammar-graph';
import type { EnPracticeSettings } from '../src/settings';
import {
	getNoticeMessages,
	resetRecordedMocks,
	StubElement,
} from './setup';

// AI 调用全部替换为桩实现（出题/评估/语法分析三个入口）
const { generateQuestionMock, evaluateTranslationMock, analyzeGrammarRoutedMock } =
	vi.hoisted(() => ({
		generateQuestionMock: vi.fn(),
		evaluateTranslationMock: vi.fn(),
		analyzeGrammarRoutedMock: vi.fn(),
	}));
vi.mock('../src/ai/translation-writing', () => ({
	generateQuestion: generateQuestionMock,
	evaluateTranslation: evaluateTranslationMock,
}));
vi.mock('../src/ai/grammar-graph', () => ({
	analyzeGrammarRouted: analyzeGrammarRoutedMock,
}));

/** 出题桩返回值 */
const QUESTION = {
	chinese: '猫坐在垫子上。',
	hint: '注意一般现在时',
	targetGrammar: '一般现在时',
};

/** 评估桩返回值 */
const EVALUATION = {
	score: 90,
	strengths: ['优点'],
	weaknesses: ['不足'],
	suggestions: '改进建议',
	improvedVersion: '优化版本',
};

/** 语法分析桩返回值（分析路由） */
const GRAMMAR_RESULT: GrammarGraphResult = {
	route: 'analysis',
	analysis: {
		sentence: 'The cat sat on the mat.',
		components: [{ text: 'The cat', type: 'subject' }],
		clauses: [
			{
				text: 'The cat sat on the mat.',
				level: 0,
				type: '主句',
				function: '全句主干',
			},
		],
		tense: ['一般过去时'],
		voice: '主动语态',
		mood: '陈述语气',
		sentenceType: '简单句',
		structureSummary: '主谓结构',
		translation: '猫坐在垫子上。',
	},
};

/** 构造最小设置 */
function createSettings(): EnPracticeSettings {
	return {
		...({
			models: [],
			activeModelId: '',
			debugMode: false,
			streamingEnabled: false,
			maxTokens: 4096,
			proxyEnabled: false,
			proxyUrl: '',
			writingThemes: [],
		} as EnPracticeSettings),
	};
}

/** 创建插件桩 */
function createPlugin() {
	return { app: {}, settings: createSettings() } as never;
}

/** 渲染写作页并返回查找助手 */
function openWritingTab() {
	const container = new StubElement();
	renderWritingPractice(
		container as unknown as HTMLElement,
		createPlugin(),
		new EventTarget(),
	);
	const findButton = (label: string) =>
		container
			.queryAll(
				(el) =>
					el.tag === 'button' &&
					(el.attrs['aria-label'] ?? '') === label,
			)
			.at(-1);
	const findTextarea = (label: string) =>
		container.queryAll(
			(el) => el.tag === 'textarea' && el.attrs['aria-label'] === label,
		)[0];
	// 结果区：id 以普通属性形式存在于桩上
	const findResultArea = () =>
		container.queryAll((el) => el.attrs['data-testid'] === undefined && (el as unknown as { id?: string }).id === 'en-writing-evaluation')[0];
	const hasText = (text: string) =>
		container.queryAll((el) => el.text === text).length > 0;
	return { container, findButton, findTextarea, findResultArea, hasText };
}

/** 等待异步流程完成 */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	resetRecordedMocks();
	generateQuestionMock.mockReset();
	evaluateTranslationMock.mockReset();
	analyzeGrammarRoutedMock.mockReset();
	generateQuestionMock.mockResolvedValue(QUESTION);
	evaluateTranslationMock.mockResolvedValue(EVALUATION);
	analyzeGrammarRoutedMock.mockResolvedValue(GRAMMAR_RESULT);
});

describe('renderWritingPractice（翻译写作页集成）', () => {
	it('重新生成题目时关闭上一次的评估结果（BUG 回归）', async () => {
		const tab = openWritingTab();

		// 第一轮：生成 → 评估
		tab.findButton('生成题目')?.trigger('click');
		await flush();
		const userInput = tab.findTextarea('你的翻译');
		if (!userInput) throw new Error('未找到翻译输入框');
		userInput.value = 'The cat sat on the mat.';
		tab.findButton('评估翻译')?.trigger('click');
		await flush();
		expect(tab.hasText('评估结果')).toBe(true);

		// 第二轮：重新生成 → 评估结果面板应被关闭
		tab.findButton('生成题目')?.trigger('click');
		await flush();
		expect(tab.hasText('评估结果')).toBe(false);
		const resultArea = tab.findResultArea();
		expect(resultArea?.classes.has('is-hidden')).toBe(true);
	});

	it('生成成功后不再展示「题目已生成」提示', async () => {
		const tab = openWritingTab();
		tab.findButton('生成题目')?.trigger('click');
		await flush();

		expect(tab.hasText('题目已生成')).toBe(false);
		// 状态条文本被清空
		const statusTexts = tab.container.queryAll((el) =>
			el.classes.has('en-status-text'),
		);
		expect(statusTexts.every((el) => el.text === '')).toBe(true);
	});

	it('生成失败时仍保留错误提示', async () => {
		const tab = openWritingTab();
		generateQuestionMock.mockRejectedValue(new Error('接口超时'));
		tab.findButton('生成题目')?.trigger('click');
		await flush();

		expect(tab.hasText('生成失败：接口超时')).toBe(true);
	});

	it('「语法分析」按钮复用共用流程分析用户翻译（BUG 回归：无此按钮）', async () => {
		const tab = openWritingTab();
		tab.findButton('生成题目')?.trigger('click');
		await flush();
		const userInput = tab.findTextarea('你的翻译');
		if (!userInput) throw new Error('未找到翻译输入框');
		userInput.value = 'The cat sat on the mat.';

		tab.findButton('语法分析')?.trigger('click');
		await flush();

		// 复用语法分析模块：走 routed 分析入口
		expect(analyzeGrammarRoutedMock).toHaveBeenCalledWith(
			'The cat sat on the mat.',
			expect.objectContaining({ debugMode: false }),
			expect.objectContaining({ debug: false }),
		);
		// 结果卡片渲染在共享结果区
		expect(tab.hasText('中文翻译')).toBe(true);
		const resultArea = tab.findResultArea();
		expect(resultArea?.classes.has('is-hidden')).toBe(false);
	});

	it('翻译输入为空时语法分析给出提示且不发起请求', async () => {
		const tab = openWritingTab();
		tab.findButton('生成题目')?.trigger('click');
		await flush();
		const userInput = tab.findTextarea('你的翻译');
		if (!userInput) throw new Error('未找到翻译输入框');
		userInput.value = '   ';

		tab.findButton('语法分析')?.trigger('click');

		expect(analyzeGrammarRoutedMock).not.toHaveBeenCalled();
		expect(getNoticeMessages()).toContain('请输入你的翻译');
	});

	it('评估与语法分析互斥展示：后执行者替换前者', async () => {
		const tab = openWritingTab();
		tab.findButton('生成题目')?.trigger('click');
		await flush();
		const userInput = tab.findTextarea('你的翻译');
		if (!userInput) throw new Error('未找到翻译输入框');
		userInput.value = 'The cat sat on the mat.';

		// 先语法分析，后评估 → 只剩评估结果
		tab.findButton('语法分析')?.trigger('click');
		await flush();
		tab.findButton('评估翻译')?.trigger('click');
		await flush();
		expect(tab.hasText('评估结果')).toBe(true);
		expect(tab.hasText('中文翻译')).toBe(false);

		// 再语法分析 → 只剩语法结果
		tab.findButton('语法分析')?.trigger('click');
		await flush();
		expect(tab.hasText('中文翻译')).toBe(true);
		expect(tab.hasText('评估结果')).toBe(false);
	});
});
