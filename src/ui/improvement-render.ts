import type { GrammarImprovementResult } from '../types';
import { createCopyableText } from './copy-block';
import { createResultCard, createResultSection, createTag } from './sections';

/**
 * 渲染语法改进结果卡片。
 * @param container 结果列表容器
 * @param result 改进结果
 * @param originalSentence 用户输入的原句
 * @param index 当前句子序号（从 1 开始）
 * @param total 本次分析的句子总数
 */
export function renderImprovementResult(
	container: HTMLElement,
	result: GrammarImprovementResult,
	originalSentence: string,
	index: number,
	total: number,
): void {
	const card = createResultCard(
		container,
		total > 1 ? `第 ${index} 句` : undefined,
	);
	card.addClass('en-improvement-card');

	const tagRow = card.createDiv('en-tag-row');
	createTag(tagRow, '语法改进', 'warning');

	const sentenceSection = createResultSection(card, '原始句子');
	sentenceSection
		.createEl('p', { text: originalSentence || result.sentence })
		.addClass('en-improvement-sentence');

	// 中文翻译：翻译原始句子，帮助理解原句含义
	const translationSection = createResultSection(card, '中文翻译');
	translationSection
		.createEl('p', { text: result.translation })
		.addClass('en-translation-text');

	const issuesSection = createResultSection(card, '语法错误');
	for (const issue of result.issues) {
		const item = issuesSection.createDiv('en-improvement-issue');
		const head = item.createDiv('en-improvement-issue-head');
		createTag(head, issue.type, 'warning');
		head.createSpan('en-improvement-issue-text').setText(issue.text);
		item.createDiv('en-improvement-issue-explanation').setText(
			issue.explanation,
		);
		item.createDiv('en-improvement-issue-suggestion').setText(
			`建议：${issue.suggestion}`,
		);
	}

	const patternsSection = createResultSection(card, '句式识别');
	for (const pattern of result.patterns) {
		const item = patternsSection.createDiv('en-improvement-pattern');
		createTag(item, pattern.pattern, 'accent');
		item.createDiv('en-improvement-pattern-usage').setText(
			pattern.usage,
		);
		if (pattern.example) {
			item.createDiv('en-improvement-pattern-example').setText(
				`例：${pattern.example}`,
			);
		}
	}

	const suggestionsSection = createResultSection(card, '改进建议');
	const suggestionsList = suggestionsSection.createEl('ul');
	for (const suggestion of result.suggestions) {
		suggestionsList.createEl('li', { text: suggestion });
	}

	createCopyableText(card, '改进后的句子', result.improvedSentence);
}
