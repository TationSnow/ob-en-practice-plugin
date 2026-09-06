import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGrammarAnalysis } from '../src/ui/grammar-analysis-runner';
import { AiError } from '../src/types';
import { createStatusLine } from '../src/ui/status';
import type { GrammarGraphResult } from '../src/ai/grammar-graph';
import type EnPracticePlugin from '../src/main';
import {
	getNoticeMessages,
	resetRecordedMocks,
	StubElement,
	type StubElementLike,
} from './setup';

// 语法分析 AI 调用替换为桩实现（LangGraph 编排不属于本测试范围）
const { analyzeGrammarRoutedMock } = vi.hoisted(() => ({
	analyzeGrammarRoutedMock: vi.fn(),
}));
vi.mock('../src/ai/grammar-graph', () => ({
	analyzeGrammarRouted: analyzeGrammarRoutedMock,
}));

/** 分析成功（无问题 → 分析路由）的返回结果 */
const ANALYSIS_RESULT: GrammarGraphResult = {
	route: 'analysis',
	analysis: {
		sentence: 'One.',
		components: [{ text: 'One', type: 'subject' }],
		clauses: [
			{ text: 'One.', level: 0, type: '主句', function: '全句主干' },
		],
		tense: ['一般过去时'],
		voice: '主动语态',
		mood: '陈述语气',
		sentenceType: '简单句',
		structureSummary: '主谓结构',
		translation: '一。',
	},
};

/** 构造插件桩 */
function createPlugin(): EnPracticePlugin {
	return { settings: { debugMode: false } } as unknown as EnPracticePlugin;
}

/** 创建分析宿主（真实状态条控制器 + 桩 DOM），返回查找助手 */
function createHost() {
	const statusContainer = new StubElement();
	// 使用真实 createStatusLine 构造控制器（DOM 桩承载渲染）
	const status = createStatusLine(statusContainer as unknown as HTMLElement);
	const resultList = new StubElement();
	const statusRoot = statusContainer.queryAll((el) =>
		el.classes.has('en-status-line'),
	)[0];
	const statusText = statusContainer.queryAll((el) =>
		el.classes.has('en-status-text'),
	)[0];
	return {
		status,
		statusContainer,
		statusRoot: statusRoot as StubElementLike,
		statusText: statusText as StubElementLike,
		resultList: resultList,
	};
}

/** 断言用：把桩元素转换为宿主期望的 HTMLElement 形状 */
function asElement(stub: StubElementLike): HTMLElement {
	return stub as unknown as HTMLElement;
}

beforeEach(() => {
	resetRecordedMocks();
	analyzeGrammarRoutedMock.mockReset();
	analyzeGrammarRoutedMock.mockResolvedValue(ANALYSIS_RESULT);
});

describe('runGrammarAnalysis（共用语法分析流程）', () => {
	it('空白输入提示且不发起请求', async () => {
		const host = createHost();
		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: '   ',
			status: host.status,
			resultList: asElement(host.resultList),
		});

		expect(analyzeGrammarRoutedMock).not.toHaveBeenCalled();
		expect(getNoticeMessages()).toContain('请输入要分析的英语句子');
	});

	it('单句分析成功：渲染结果卡片并回调完整输入', async () => {
		const host = createHost();
		const onSuccess = vi.fn();
		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: 'One.',
			status: host.status,
			resultList: asElement(host.resultList),
			onSuccess,
		});

		expect(analyzeGrammarRoutedMock).toHaveBeenCalledTimes(1);
		expect(analyzeGrammarRoutedMock).toHaveBeenCalledWith(
			'One.',
			expect.objectContaining({ debugMode: false }),
			expect.objectContaining({ debug: false }),
		);
		// 渲染出结果卡片
		expect(
			host.resultList.queryAll((el) => el.classes.has('en-result-card')),
		).toHaveLength(1);
		// 状态条为成功文案
		expect(host.statusText?.text).toBe('分析完成，共 1 句');
		expect(host.statusRoot?.classes.has('is-success')).toBe(true);
		expect(onSuccess).toHaveBeenCalledWith('One.');
	});

	it('多句输入逐句分析并渲染多张卡片', async () => {
		const host = createHost();
		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: 'One. Two.',
			status: host.status,
			resultList: asElement(host.resultList),
		});

		expect(analyzeGrammarRoutedMock).toHaveBeenCalledTimes(2);
		expect(
			host.resultList.queryAll((el) => el.classes.has('en-result-card')),
		).toHaveLength(2);
		expect(host.statusText?.text).toBe('分析完成，共 2 句');
	});

	it('改进路由渲染改进卡片', async () => {
		const host = createHost();
		analyzeGrammarRoutedMock.mockResolvedValue({
			route: 'improvement',
			improvement: {
				sentence: 'I has went.',
				issues: [
					{
						text: 'has went',
						type: '时态错误',
						explanation: '过去分词误用',
						suggestion: 'went → gone',
					},
				],
				patterns: [],
				suggestions: ['注意 have + 过去分词'],
				improvedSentence: 'I have gone.',
				translation: '我已经走了。',
			},
		});

		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: 'I has went.',
			status: host.status,
			resultList: asElement(host.resultList),
		});

		// 改进结果卡片由 improvement-render 渲染（含复制块）
		expect(
			host.resultList.queryAll((el) => el.classes.has('en-result-card')),
		).toHaveLength(1);
		expect(host.statusText?.text).toBe('分析完成，共 1 句');
	});

	it('解析失败转为面向用户的简短文案并触发 onError', async () => {
		const host = createHost();
		const onError = vi.fn();
		analyzeGrammarRoutedMock.mockRejectedValue(
			new AiError('PARSE_ERROR', 'raw json'),
		);

		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: 'One.',
			status: host.status,
			resultList: asElement(host.resultList),
			onError,
		});

		expect(host.statusText?.text).toBe(
			'分析失败：模型输出格式校验失败，请重试或换用更强的模型',
		);
		expect(host.statusRoot?.classes.has('is-error')).toBe(true);
		expect(getNoticeMessages().join('\n')).toContain('分析失败');
		expect(onError).toHaveBeenCalled();
	});

	it('普通错误透传错误消息', async () => {
		const host = createHost();
		analyzeGrammarRoutedMock.mockRejectedValue(new Error('网络中断'));

		await runGrammarAnalysis({
			plugin: createPlugin(),
			input: 'One.',
			status: host.status,
			resultList: asElement(host.resultList),
		});

		expect(host.statusText?.text).toBe('分析失败：网络中断');
	});
});
