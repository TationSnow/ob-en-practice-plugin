import type { ComponentType } from '../types';
import {
	findClauseRanges,
	findPredicateVerbRange,
} from '../utils/grammar-highlight';
import { findComponentSpan, splitSentences } from '../utils/sentence';

/** 成分类型对应的 CSS 类名 */
export const COMPONENT_CSS_CLASS: Record<ComponentType, string> = {
	subject: 'en-grammar-subject',
	predicate: 'en-grammar-predicate',
	object: 'en-grammar-object',
	complement: 'en-grammar-complement',
	adverbial: 'en-grammar-adverbial',
	attributive: 'en-grammar-attributive',
	other: 'en-grammar-other',
};

/** 成分类型对应的中文名称 */
export const COMPONENT_LABELS: Record<ComponentType, string> = {
	subject: '主语',
	predicate: '谓语',
	object: '宾语',
	complement: '补语',
	adverbial: '状语',
	attributive: '定语',
	other: '其他',
};

/**
 * 创建一个可折叠区块
 * @param container 父容器
 * @param title 区块标题
 * @param defaultOpen 是否默认展开
 * @returns 区块的内部容器
 */
export function createCollapsibleSection(
	container: HTMLElement,
	title: string,
	defaultOpen = true,
): HTMLElement {
	const details = container.createEl('details');
	details.addClass('en-collapsible');
	if (defaultOpen) {
		details.setAttr('open', '');
	}

	const summary = details.createEl('summary');
	summary.addClass('en-collapsible-summary');
	summary.setText(title);

	const content = details.createDiv('en-collapsible-content');

	return content;
}

/**
 * 创建一个带加载状态的按钮
 * @param container 父容器
 * @param text 按钮文本
 * @param onClick 点击回调
 * @returns 按钮元素
 */
export function createActionButton(
	container: HTMLElement,
	text: string,
	onClick: () => Promise<void>,
): HTMLButtonElement {
	const button = container.createEl('button', {
		attr: { 'aria-label': text, 'data-tooltip-position': 'top' },
	});
	button.setText(text);
	button.addClass('en-action-button');

	button.addEventListener('click', () => {
		button.setText('处理中...');
		button.setAttr('disabled', '');
		void onClick().finally(() => {
			button.setText(text);
			button.removeAttribute('disabled');
		});
	});

	return button;
}

/**
 * 创建一个结果展示区域（带标题的只读区块）
 * @param container 父容器
 * @param title 标题
 * @returns 内容容器
 */
export function createResultSection(
	container: HTMLElement,
	title: string,
): HTMLElement {
	const section = container.createDiv('en-result-section');
	section.createEl('h4', { text: title });
	const content = section.createDiv('en-result-content');
	return content;
}

/**
 * 渲染带颜色标注的句子
 * @param container 父容器
 * @param sentence 原句文本（含标点）
 * @param components 成分数组
 * @param clauses 从句信息
 */
export function renderHighlightedSentence(
	container: HTMLElement,
	sentence: string,
	components: { text: string; type: ComponentType; details?: string }[],
	clauses: { text: string; level: number }[],
): void {
	container.empty();

	// 成分数组按原句顺序全局消费，避免成分跨句时重复或错位
	let componentIndex = 0;
	for (const sentenceText of splitSentences(sentence)) {
		const paragraph = container.createDiv('en-sentence-paragraph');
		componentIndex = renderSentenceSegment(
			paragraph,
			sentenceText,
			components,
			clauses,
			componentIndex,
		);
	}
}

/**
 * 渲染单个句子段落：以原句为底稿，把能匹配到的成分高亮，其余文本（标点等）原样保留。
 * @param container 段落容器
 * @param sentenceText 单句文本
 * @param components 全部成分
 * @param clauses 从句信息
 * @param startComponentIndex 本段开始消费的成分下标
 * @returns 本段结束后下一个未消费的成分下标
 */
function renderSentenceSegment(
	container: HTMLElement,
	sentenceText: string,
	components: { text: string; type: ComponentType; details?: string }[],
	clauses: { text: string; level: number }[],
	startComponentIndex: number,
): number {
	let componentIndex = startComponentIndex;
	let cursor = 0;

	while (componentIndex < components.length) {
		const component = components[componentIndex];
		if (!component) break;
		const match = findComponentSpan(sentenceText, component.text, cursor);
		if (!match) break;

		renderTextWithClauses(
			container,
			sentenceText.slice(cursor, match.start),
			clauses,
		);
		appendComponentSpan(
			container,
			sentenceText.slice(match.start, match.end),
			component,
			clauses,
		);
		cursor = match.end;
		componentIndex += 1;
	}

	// 句尾标点等未落入任何成分的文本原样保留
	renderTextWithClauses(container, sentenceText.slice(cursor), clauses);
	return componentIndex;
}

/** 追加普通文本（标点、空白等非成分内容） */
function appendPlainText(container: HTMLElement, text: string): void {
	if (!text) return;
	const span = container.createSpan();
	span.setText(text);
}

/** 追加红色从句括号 */
function appendClauseBracket(container: HTMLElement, bracket: string): void {
	const span = container.createSpan();
	span.addClass('en-clause-bracket');
	span.setText(bracket);
}

/** 追加从句层级角标 */
function appendClauseLevel(container: HTMLElement, level: number): void {
	if (level <= 0) return;
	const sup = container.createEl('sup');
	sup.addClass('en-clause-level');
	sup.setText(String(level));
}

/**
 * 渲染文本，并用红色括号包裹其中的从句。
 * 支持嵌套从句：按区间栈处理开合括号，保证层级正确。
 * @param container 父容器
 * @param text 需要渲染的文本
 * @param clauses 从句信息
 */
function renderTextWithClauses(
	container: HTMLElement,
	text: string,
	clauses: { text: string; level: number }[],
): void {
	const ranges = findClauseRanges(text, clauses);
	if (ranges.length === 0) {
		appendPlainText(container, text);
		return;
	}

	const sorted = [...ranges].sort(
		(a, b) => a.start - b.start || b.end - a.end,
	);
	const stack: number[] = [];
	let cursor = 0;

	for (let i = 0; i < sorted.length; i += 1) {
		const range = sorted[i];
		if (!range) continue;

		// 关闭所有在当前从句开始前已经结束的括号
		while (stack.length > 0) {
			const top = sorted[stack[stack.length - 1] ?? 0];
			if (!top || top.end > range.start) break;
			appendPlainText(container, text.slice(cursor, top.end));
			appendClauseBracket(container, ')');
			appendClauseLevel(container, top.level);
			cursor = top.end;
			stack.pop();
		}

		// 已经输出的区间内的从句（重叠等异常情况）跳过
		if (range.start < cursor) continue;
		appendPlainText(container, text.slice(cursor, range.start));
		appendClauseBracket(container, '(');
		cursor = range.start;
		stack.push(i);
	}

	// 关闭所有剩余括号
	while (stack.length > 0) {
		const top = sorted[stack[stack.length - 1] ?? 0];
		if (!top) break;
		appendPlainText(container, text.slice(cursor, top.end));
		appendClauseBracket(container, ')');
		appendClauseLevel(container, top.level);
		cursor = top.end;
		stack.pop();
	}

	appendPlainText(container, text.slice(cursor));
}

/**
 * 渲染谓语成分：只给谓语动词核心词上紫色，
 * 助动词、情态动词和句中状语等保持白色，避免整串谓语全部紫色。
 * @param container 父容器
 * @param text 谓语成分的完整文本
 * @param details 成分说明（可含“谓语动词：”标记）
 * @param clauses 从句信息
 */
function renderPredicateGroup(
	container: HTMLElement,
	text: string,
	details: string | undefined,
	clauses: { text: string; level: number }[],
): void {
	const verbRange = findPredicateVerbRange(text, details);

	if (!verbRange) {
		const span = container.createSpan();
		span.addClass(COMPONENT_CSS_CLASS.predicate);
		renderTextWithClauses(span, text, clauses);
		return;
	}

	// 动词前的助动词、情态动词、状语等按普通文本展示
	if (verbRange.start > 0) {
		const prefix = container.createSpan();
		prefix.addClass(COMPONENT_CSS_CLASS.other);
		renderTextWithClauses(prefix, text.slice(0, verbRange.start), clauses);
	}

	// 谓语动词本体使用紫色
	const verbSpan = container.createSpan();
	verbSpan.addClass(COMPONENT_CSS_CLASS.predicate);
	verbSpan.setText(text.slice(verbRange.start, verbRange.end));

	// 动词后的状语、否定词等按普通文本展示
	if (verbRange.end < text.length) {
		const suffix = container.createSpan();
		suffix.addClass(COMPONENT_CSS_CLASS.other);
		renderTextWithClauses(suffix, text.slice(verbRange.end), clauses);
	}
}

/** 追加带成分样式、从句红色括号与层级角标的文本 */
function appendComponentSpan(
	container: HTMLElement,
	text: string,
	component: { text: string; type: ComponentType; details?: string },
	clauses: { text: string; level: number }[],
): void {
	// 谓语动词单独处理：只给动词核心上紫色
	if (component.type === 'predicate') {
		renderPredicateGroup(container, text, component.details, clauses);
		return;
	}

	const span = container.createSpan();
	span.addClass(COMPONENT_CSS_CLASS[component.type]);
	renderTextWithClauses(span, text, clauses);
}

/**
 * 创建占位提示区域（未配置时显示）
 * @param container 父容器
 * @param message 提示消息
 * @param onGoToSettings 点击"前往设置"的回调
 */
export function createPlaceholder(
	container: HTMLElement,
	message: string,
	onGoToSettings: () => void,
): void {
	container.empty();
	container.addClass('en-placeholder');

	const icon = container.createDiv('en-placeholder-icon');
	icon.setText('');

	const msg = container.createEl('p');
	msg.setText(message);

	const btn = container.createEl('button', {
		attr: {
			'aria-label': '前往设置',
			'data-tooltip-position': 'top',
		},
	});
	btn.setText('前往设置');
	btn.addClass('en-action-button');
	btn.addEventListener('click', () => onGoToSettings());
}
