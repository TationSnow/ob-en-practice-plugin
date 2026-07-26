import type { ComponentType } from '../types';

/** 成分类型对应的 CSS 类名 */
export const COMPONENT_CSS_CLASS: Record<ComponentType, string> = {
	subject: 'en-grammar-subject',
	predicate: 'en-grammar-predicate',
	object: 'en-grammar-object',
	attribute: 'en-grammar-attribute',
	adverbial: 'en-grammar-adverbial',
	complement: 'en-grammar-complement',
	clause: 'en-grammar-clause',
	other: 'en-grammar-other',
};

/** 成分类型对应的中文名称 */
export const COMPONENT_LABELS: Record<ComponentType, string> = {
	subject: '主语',
	predicate: '谓语',
	object: '宾语',
	attribute: '定语',
	adverbial: '状语',
	complement: '补语',
	clause: '从句',
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
 * @param components 成分数组
 * @param clauses 从句信息
 */
export function renderHighlightedSentence(
	container: HTMLElement,
	components: { text: string; type: ComponentType }[],
	clauses: { text: string; level: number }[],
): void {
	container.empty();

	for (const comp of components) {
		const span = container.createSpan();
		span.addClass(COMPONENT_CSS_CLASS[comp.type]);
		span.setText(comp.text);

		// 如果该成分是某个从句的一部分，添加角标
		const relatedClause = clauses.find((c) => comp.text.includes(c.text));
		if (relatedClause && relatedClause.level > 0) {
			const sup = span.createEl('sup');
			sup.setText(String(relatedClause.level));
		}

		container.append(' ');
	}
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
