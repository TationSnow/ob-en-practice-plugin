import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import type { GrammarResult } from '../types';
import { analyzeGrammar } from '../ai/grammar-analysis';
import { splitSentences, stripGrammarAnnotations } from '../utils/sentence';
import {
	createCollapsibleSection,
	createActionButton,
	createResultSection,
	COMPONENT_LABELS,
	renderHighlightedSentence,
} from './components';
import { dispatchGrammarReference } from './panel-events';

/**
 * 渲染语法分析模块
 * @param container 父容器
 * @param plugin 插件实例
 * @param events 面板内共享的事件总线，用于和翻译写作模块联动
 */
export function renderGrammarAnalysis(
	container: HTMLElement,
	plugin: EnPracticePlugin,
	events: EventTarget,
): void {
	const section = createCollapsibleSection(container, '语法分析');

	// 输入区域
	const textarea = section.createEl('textarea', {
		attr: {
			placeholder: '粘贴或输入英语句子...',
			rows: '3',
		},
	});
	textarea.addClass('en-text-input');

	// 按钮
	const btnContainer = section.createDiv('en-button-container');
	// 流式输出状态区
	const streamStatus = section.createEl('pre');
	streamStatus.addClass('en-stream-output');
	streamStatus.addClass('en-hidden');
	let streamStarted = false;

	createActionButton(btnContainer, '一键分析', async () => {
		// 清理上次渲染留下的括号标注，避免模型把标注符号当成原句
		const input = stripGrammarAnnotations(textarea.value.trim());
		if (!input) {
			new Notice('请输入要分析的英语句子');
			return;
		}
		// 多句输入按句切分后逐句分析，避免多个主句共用同一份分句结构
		const sentences = splitSentences(input);
		if (sentences.length === 0) {
			new Notice('未识别到有效的英语句子');
			return;
		}
		streamStatus.empty();
		streamStatus.removeClass('en-hidden');
		streamStarted = false;
		try {
			resultArea.empty();
			resultArea.removeClass('en-hidden');
			for (let index = 0; index < sentences.length; index += 1) {
				const sentence = sentences[index];
				if (!sentence) continue;
				streamStatus.setText(
					`正在分析第 ${index + 1}/${sentences.length} 句...`,
				);
				streamStarted = false;
				const result = await analyzeGrammar(
					sentence,
					plugin.settings,
					{
						onToken: (token) => {
							if (!streamStarted) {
								streamStatus.setText('');
								streamStarted = true;
							}
							streamStatus.appendText(token);
						},
						debug: plugin.settings.debugMode,
					},
				);
				renderGrammarResult(
					resultArea,
					result,
					sentence,
					events,
					index + 1,
					sentences.length,
				);
			}
			streamStatus.addClass('en-hidden');
		} catch (err) {
			streamStatus.setText(
				`请求失败：${err instanceof Error ? err.message : '未知错误'}`,
			);
			new Notice(
				`分析失败：${err instanceof Error ? err.message : '未知错误'}`,
			);
		}
	});

	// 结果展示区（初始隐藏）
	const resultArea = section.createDiv('en-result-area');
	resultArea.id = 'en-grammar-result';
	resultArea.addClass('en-hidden');
}

/**
 * 渲染语法分析结果
 * @param container 父容器
 * @param result 分析结果
 * @param originalSentence 用户输入的原句
 * @param events 面板内共享的事件总线
 * @param index 当前句子序号（从 1 开始）
 * @param total 本次分析的句子总数
 */
function renderGrammarResult(
	container: HTMLElement,
	result: GrammarResult,
	originalSentence: string,
	events: EventTarget,
	index: number,
	total: number,
): void {
	// 每个句子独立成卡片，多句输入时互不干扰
	const card = container.createDiv('en-grammar-result-card');
	if (total > 1) {
		const heading = card.createEl('h3', { text: `第 ${index} 句` });
		heading.addClass('en-result-card-heading');
	}

	// 带标注的句子展示
	const sentenceSection = createResultSection(
		card,
		'句子成分标注',
	);
	renderHighlightedSentence(
		sentenceSection,
		originalSentence || result.sentence,
		result.components,
		result.clauses,
	);

	// 分句结构：level 0 为主句，其余为从句
	const clauseSection = createResultSection(card, '分句结构');
	const list = clauseSection.createEl('ul');
	for (const clause of result.clauses) {
		const item = list.createEl('li');
		item.setText(
			`[层级 ${clause.level}] ${clause.type}：${clause.text}（功能：${clause.function}）`,
		);
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

	// 一键将分析句作为参考表达用于翻译写作
	const actionContainer = card.createDiv('en-button-container');
	createActionButton(actionContainer, '用于翻译写作', async () => {
		dispatchGrammarReference(events, originalSentence || result.sentence);
		new Notice('已将该句填入参考英语表达');
	});

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
