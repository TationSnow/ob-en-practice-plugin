import type { ComponentType, GrammarResult, SentenceComponent } from '../types';
import {
	buildRenderItems,
	findPredicateVerbRange,
	sortRenderItems,
	type RenderItem,
} from '../utils/grammar-highlight';
import { findComponentSpan, splitSentences } from '../utils/sentence';
import {
	createIconButton,
} from './controls';
import {
	createResultCard,
	createResultSection,
	createTag,
} from './sections';
import {
	attachWordTokenEvents,
	hideWordPopover,
} from './word-popover';
import { speakEnglish } from '../speech/tts';

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
	// 重新渲染时关闭遗留的悬浮词卡
	hideWordPopover();
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

/** 英文单词词元（保留撇号缩写，如 don't） */
const WORD_TOKEN_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

/**
 * 把文本拆分为词元渲染：每个英文单词包裹为可交互的词元 span
 * （悬浮/点击展示释义卡片），标点与空白原样保留。
 * 重建后的文本内容与原句完全一致。
 * @param container 父容器
 * @param text 文本片段
 */
function appendWordTokens(container: HTMLElement, text: string): void {
	let cursor = 0;
	for (const match of text.matchAll(WORD_TOKEN_PATTERN)) {
		const start = match.index ?? 0;
		if (start > cursor) {
			appendRawSegment(container, text.slice(cursor, start));
		}
		const word = match[0];
		const token = container.createSpan();
		token.addClass('en-word-token');
		token.setAttr('data-word', word.toLowerCase());
		token.setText(word);
		attachWordTokenEvents(token, word);
		cursor = start + word.length;
	}
	if (cursor < text.length) {
		appendRawSegment(container, text.slice(cursor));
	}
}

/** 追加非单词片段（空白、标点），不参与悬浮交互 */
function appendRawSegment(container: HTMLElement, text: string): void {
	if (!text) return;
	const span = container.createSpan();
	span.setText(text);
}

/** 渲染基础文本片段，带可选的颜色 class；文本按词元拆分以支持悬浮词卡 */
function renderBaseText(
	container: HTMLElement,
	text: string,
	baseClass: string | null,
): void {
	if (!text) return;
	const span = container.createSpan();
	if (baseClass) {
		span.addClass(baseClass);
	}
	// 词元子 span 继承外层成分着色
	appendWordTokens(span, text);
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
			// 谓语动词核心词直接上紫色，不再递归解析；同样拆词支持悬浮
			const verbSpan = container.createSpan();
			verbSpan.addClass(COMPONENT_CSS_CLASS.predicate);
			appendWordTokens(verbSpan, text.slice(item.start, item.end));
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
 * 渲染语法分析结果卡片（语法分析页与翻译写作页共用）。
 * @param container 结果列表容器
 * @param result 分析结果
 * @param originalSentence 用户输入的原句
 * @param index 当前句子序号（从 1 开始）
 * @param total 本次分析的句子总数
 */
export function renderGrammarResult(
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

	// 中文翻译：先理解句意，再阅读结构分析
	const translationSection = createResultSection(card, '中文翻译');
	translationSection
		.createEl('p', { text: result.translation })
		.addClass('en-translation-text');

	// 带成分与从句标注的句子展示；标题旁喇叭朗读整句
	const sentenceSection = createResultSection(
		card,
		'句子成分标注',
		{
			headingExtra: (heading) => {
				createIconButton(
					heading,
					'volume-2',
					'播放句子语音',
					() => {
						speakEnglish(originalSentence || result.sentence);
					},
					{ compact: true },
				);
			},
		},
	);
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
