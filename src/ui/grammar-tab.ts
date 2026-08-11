import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import type { GrammarResult } from '../types';
import { analyzeGrammar } from '../ai/grammar-analysis';
import { splitSentences, stripGrammarAnnotations } from '../utils/sentence';
import {
	createActionButton,
	createIconButton,
} from './controls';
import {
	createResultCard,
	createResultSection,
	createTag,
} from './sections';
import { createStatusLine } from './status';
import {
	COMPONENT_LABELS,
	renderHighlightedSentence,
} from './grammar-render';
import { dispatchGrammarReference } from './panel-events';

/** 语法分析页与外部协作所需的回调 */
export interface GrammarAnalysisCallbacks {
	/** 语法分析结果用于翻译写作时切换页签 */
	onUseForWriting: (sentence: string) => void;
	/** 从当前笔记获取选中文本 */
	getSelection?: () => string | null;
}

/**
 * 渲染语法分析模块。
 * @param container 父容器
 * @param plugin 插件实例
 * @param events 面板内共享的事件总线，用于和翻译写作模块联动
 * @param callbacks 页签切换与选区导入回调
 * @returns 清理函数
 */
export function renderGrammarAnalysis(
	container: HTMLElement,
	plugin: EnPracticePlugin,
	events: EventTarget,
	callbacks: GrammarAnalysisCallbacks,
): () => void {
	// 输入区与工具栏
	const composer = container.createDiv('en-composer');

	const textarea = composer.createEl('textarea', {
		attr: {
			'aria-label': '输入英语句子',
			placeholder: '粘贴或输入英语句子...',
			rows: '4',
		},
	});
	textarea.addClass('en-text-input');

	const toolbar = composer.createDiv('en-toolbar');
	createIconButton(toolbar, 'import', '导入当前选区', () => {
		const selection = callbacks.getSelection?.() ?? null;
		if (!selection) {
			new Notice('当前笔记没有选中文本');
			return;
		}
		textarea.value = selection;
		textarea.focus();
	});
	createIconButton(toolbar, 'trash-2', '清空输入', () => {
		textarea.value = '';
		analyzedInput = '';
		useForWritingButton.addClass('is-hidden');
		status.clear();
		status.hide();
		resultList.empty();
		resultList.addClass('is-hidden');
	});
	toolbar.createDiv('en-toolbar-spacer');

	const status = createStatusLine(composer);
	const resultList = container.createDiv('en-result-list');
	resultList.addClass('is-hidden');

	// 最近一次成功分析的完整输入，供“用于翻译写作”按钮使用
	let analyzedInput = '';

	/** 对输入内容按句分析，逐句渲染结果卡片 */
	async function runAnalysis(): Promise<void> {
		// 清理上次渲染留下的括号标注，避免模型把标注符号当成原句
		const input = stripGrammarAnnotations(textarea.value.trim());
		if (!input) {
			new Notice('请输入要分析的英语句子');
			return;
		}
		const sentences = splitSentences(input);
		if (sentences.length === 0) {
			new Notice('未识别到有效的英语句子');
			return;
		}

		status.clear();
		status.setState('loading');
		status.setText(`正在分析第 1/${sentences.length} 句…`);
		status.show();
		analyzedInput = '';
		useForWritingButton.addClass('is-hidden');
		resultList.empty();
		resultList.removeClass('is-hidden');

		try {
			for (let index = 0; index < sentences.length; index += 1) {
				const sentence = sentences[index];
				if (!sentence) continue;
				status.setText(`正在分析第 ${index + 1}/${sentences.length} 句…`);
				const result = await analyzeGrammar(sentence, plugin.settings, {
					debug: plugin.settings.debugMode,
				});
				renderGrammarResult(
					resultList,
					result,
					sentence,
					index + 1,
					sentences.length,
				);
			}
			status.setState('success');
			status.setText(`分析完成，共 ${sentences.length} 句`);
			analyzedInput = input;
			useForWritingButton.removeClass('is-hidden');
		} catch (err) {
			status.setState('error');
			const message = err instanceof Error ? err.message : '未知错误';
			status.setText(`分析失败：${message}`);
			new Notice(`分析失败：${message}`);
			useForWritingButton.addClass('is-hidden');
		}
	}

	// 分析完成后，将整段输入作为参考英语用于翻译写作
	const useForWritingButton = createActionButton(
		toolbar,
		'用于翻译写作',
		async () => {
			if (!analyzedInput) {
				new Notice('请先完成语法分析');
				return;
			}
			dispatchGrammarReference(events, analyzedInput);
			callbacks.onUseForWriting(analyzedInput);
			new Notice('已将分析内容填入参考英语表达');
		},
		{ icon: 'arrow-right', variant: 'secondary' },
	);
	useForWritingButton.addClass('is-hidden');


	createActionButton(toolbar, '分析', runAnalysis, {
		icon: 'wand-2',
		variant: 'primary',
	});
	return () => {};
}

/**
 * 渲染语法分析结果卡片。
 * @param container 结果列表容器
 * @param result 分析结果
 * @param originalSentence 用户输入的原句
 * @param index 当前句子序号（从 1 开始）
 * @param total 本次分析的句子总数
 */
function renderGrammarResult(
	container: HTMLElement,
	result: GrammarResult,
	originalSentence: string,
	index: number,
	total: number,
): void {
	const card = createResultCard(
		container,
		total > 1 ? `第 ${index} 句` : undefined,
	);

	// 顶部标签快速展示时态、语态与句型
	const tagRow = card.createDiv('en-tag-row');
	for (const tense of result.tense) {
		createTag(tagRow, tense, 'accent');
	}
	createTag(tagRow, result.voice, 'neutral');
	createTag(tagRow, result.sentenceType, 'success');

	// 带成分与从句标注的句子展示
	const sentenceSection = createResultSection(card, '句子成分标注');
	renderHighlightedSentence(
		sentenceSection,
		originalSentence || result.sentence,
		result.components,
		result.clauses,
	);

	// 分句结构：按层级缩进展示主句与从句
	const clauseSection = createResultSection(card, '分句结构');
	const clauseList = clauseSection.createEl('ol', { attr: { role: 'list' } });
	clauseList.addClass('en-clause-list');
	for (const clause of result.clauses) {
		const item = clauseList.createEl('li');
		item.addClass(`en-clause-depth-${Math.min(clause.level, 4)}`);
		item.createSpan('en-clause-type').setText(clause.type);
		item.createSpan('en-clause-text').setText(clause.text);
		if (clause.function) {
			item.createSpan('en-clause-function').setText(
				`（${clause.function}）`,
			);
		}
	}

	// 成分明细：展示完整片段、类型与内部结构说明
	const detailSection = createResultSection(card, '成分明细');
	const componentTable = detailSection.createEl('table');
	componentTable.addClass('en-info-table');
	for (const component of result.components) {
		const tr = componentTable.createEl('tr');
		tr.createEl('td', { text: component.text });
		tr.createEl('td', {
			text: COMPONENT_LABELS[component.type],
		}).addClass('en-component-type');
		tr.createEl('td', {
			text: component.details ?? '—',
		}).addClass('en-component-details');
	}

	// 语法信息总览
	const infoSection = createResultSection(card, '语法信息');
	const table = infoSection.createEl('table');
	table.addClass('en-info-table');

	const rows: [string, string][] = [
		['时态', result.tense.join('、')],
		['语态', result.voice],
		['语气', result.mood],
		['句型', result.sentenceType],
		['结构概括', result.structureSummary],
	];

	for (const [label, value] of rows) {
		const tr = table.createEl('tr');
		tr.createEl('td', { text: label }).addClass('en-info-label');
		tr.createEl('td', { text: value });
	}
}
