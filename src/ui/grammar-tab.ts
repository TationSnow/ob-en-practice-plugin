import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import type { GrammarResult } from '../types';
import { analyzeGrammar } from '../ai/grammar-analysis';
import {
	createCollapsibleSection,
	createActionButton,
	createResultSection,
	renderHighlightedSentence,
} from './components';

/** 语法分析结果区域的 CSS 选择器 */
const RESULT_SELECTOR = '#en-grammar-result';

/**
 * 渲染语法分析模块
 * @param container 父容器
 * @param plugin 插件实例
 */
export function renderGrammarAnalysis(
	container: HTMLElement,
	plugin: EnPracticePlugin,
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
	createActionButton(btnContainer, '一键分析', async () => {
		const sentence = textarea.value.trim();
		if (!sentence) {
			new Notice('请输入要分析的英语句子');
			return;
		}
		try {
			const result = await analyzeGrammar(
				sentence,
				plugin.settings,
			);
			renderGrammarResult(section, result);
		} catch (err) {
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
 */
function renderGrammarResult(
	container: HTMLElement,
	result: GrammarResult,
): void {
	const resultArea = container.querySelector(RESULT_SELECTOR) as HTMLElement;
	resultArea.empty();
	resultArea.removeClass('en-hidden');

	// 带标注的句子展示
	const sentenceSection = createResultSection(
		resultArea,
		'句子成分标注',
	);
	renderHighlightedSentence(
		sentenceSection,
		result.components,
		result.clauses,
	);

	// 从句信息
	if (result.clauses.length > 0) {
		const clauseSection = createResultSection(
			resultArea,
			'从句分析',
		);
		const list = clauseSection.createEl('ul');
		for (const clause of result.clauses) {
			const item = list.createEl('li');
			item.setText(
				`[层级 ${clause.level}] ${clause.type}：${clause.text}`,
			);
		}
	}

	// 成分信息表
	const infoSection = createResultSection(resultArea, '成分信息');
	const table = infoSection.createEl('table');
	table.addClass('en-info-table');

	const rows: [string, string][] = [
		['时态', result.tense],
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
