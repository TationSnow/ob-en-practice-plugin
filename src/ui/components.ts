import type { ComponentType, SentenceComponent } from '../types';
import {
	buildRenderItems,
	findPredicateVerbRange,
	sortRenderItems,
	type RenderItem,
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
	components: SentenceComponent[],
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
	components: SentenceComponent[],
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

		renderPlainWithClauses(
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
	renderPlainWithClauses(container, sentenceText.slice(cursor), clauses);
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

/** 渲染基础文本片段，带可选的颜色 class */
function renderBaseText(
	container: HTMLElement,
	text: string,
	baseClass: string | null,
): void {
	if (!text) return;
	if (baseClass) {
		const span = container.createSpan();
		span.addClass(baseClass);
		span.setText(text);
		return;
	}
	appendPlainText(container, text);
}

/**
 * 递归渲染文本：外层用 baseClass 着色，子成分用自身类型颜色覆盖，
 * 从句用红色括号包裹并保留层级角标。
 * @param container 父容器
 * @param text 当前渲染文本
 * @param start 渲染起点
 * @param end 渲染终点
 * @param baseClass 当前层级的颜色 class
 * @param items 当前层级的渲染区间
 * @param clauses 从句信息
 */
function renderItems(
	container: HTMLElement,
	text: string,
	start: number,
	end: number,
	baseClass: string | null,
	items: RenderItem[],
	clauses: { text: string; level: number }[],
): void {
	const inside = items.filter(
		(item) => item.start >= start && item.end <= end,
	);
	let cursor = start;
	for (const item of inside) {
		if (item.start < cursor) continue;
		renderBaseText(container, text.slice(cursor, item.start), baseClass);

		if (item.kind === 'clause') {
			appendClauseBracket(container, '(');
			renderItems(
				container,
				text,
				item.start,
				item.end,
				baseClass,
				inside.filter((candidate) => candidate !== item),
				clauses,
			);
			appendClauseBracket(container, ')');
			appendClauseLevel(container, item.level);
		} else if (item.kind === 'verb') {
			// 谓语动词核心词直接上紫色，不再递归解析
			const verbSpan = container.createSpan();
			verbSpan.addClass(COMPONENT_CSS_CLASS.predicate);
			verbSpan.setText(text.slice(item.start, item.end));
		} else if (item.component) {
			const childRendering = resolveComponentRendering(
				item.component,
				text,
				clauses,
			);
			// 子成分自身就是从句时，从句已在父层包裹，避免进入子成分后重复加括号
			const childItems = childRendering.items.filter(
				(childItem) =>
					!(
						childItem.kind === 'clause' &&
						childItem.start === item.start &&
						childItem.end === item.end
					),
			);
			renderItems(
				container,
				text,
				item.start,
				item.end,
				childRendering.baseClass,
				childItems,
				clauses,
			);
		}
		cursor = item.end;
	}
	renderBaseText(container, text.slice(cursor, end), baseClass);
}

/**
 * 计算成分渲染使用的底色与渲染区间。
 * 谓语成分只给动词核心词上紫色，其余助动词/情态动词/状语保持白色。
 * @param component 成分信息
 * @param text 当前渲染文本
 * @param clauses 从句信息
 * @returns 底色 class 与排序后的渲染区间
 */
function resolveComponentRendering(
	component: SentenceComponent,
	text: string,
	clauses: { text: string; level: number }[],
): { baseClass: string | null; items: RenderItem[] } {
	const items = buildRenderItems(text, component.children ?? [], clauses);
	let baseClass = COMPONENT_CSS_CLASS[component.type];

	if (component.type === 'predicate') {
		const verbRange = findPredicateVerbRange(text, component.details);
		if (verbRange) {
			baseClass = COMPONENT_CSS_CLASS.other;
			items.push({
				kind: 'verb',
				start: verbRange.start,
				end: verbRange.end,
				level: 0,
				component: null,
			});
			sortRenderItems(items);
		}
	}

	return { baseClass, items };
}

/** 渲染纯文本片段（无成分颜色），保留从句红色括号 */
function renderPlainWithClauses(
	container: HTMLElement,
	text: string,
	clauses: { text: string; level: number }[],
): void {
	renderItems(
		container,
		text,
		0,
		text.length,
		null,
		buildRenderItems(text, [], clauses),
		clauses,
	);
}

/**
 * 渲染单个成分：谓语动词只给核心词上紫色，
 * 其余部分按成分类型着色，并处理从句括号与嵌套子成分。
 * @param container 父容器
 * @param text 成分的完整文本
 * @param component 成分信息（可能含嵌套 children）
 * @param clauses 从句信息
 */
function renderComponentNested(
	container: HTMLElement,
	text: string,
	component: SentenceComponent,
	clauses: { text: string; level: number }[],
): void {
	const rendering = resolveComponentRendering(component, text, clauses);
	renderItems(
		container,
		text,
		0,
		text.length,
		rendering.baseClass,
		rendering.items,
		clauses,
	);
}

/** 追加带成分样式、从句红色括号与嵌套子成分颜色的文本 */
function appendComponentSpan(
	container: HTMLElement,
	text: string,
	component: SentenceComponent,
	clauses: { text: string; level: number }[],
): void {
	renderComponentNested(container, text, component, clauses);
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
