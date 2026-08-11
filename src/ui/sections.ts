import { setIcon, type IconName } from 'obsidian';

/** 可折叠区块控制器 */
export interface CollapsibleSection {
	content: HTMLElement;
	details: HTMLElement;
	setOpen(open: boolean): void;
}

/**
 * 创建一个可折叠区块。
 * @param container 父容器
 * @param title 区块标题
 * @param defaultOpen 是否默认展开
 * @returns 区块控制器
 */
export function createCollapsibleSection(
	container: HTMLElement,
	title: string,
	defaultOpen = true,
): CollapsibleSection {
	const details = container.createEl('details');
	details.addClass('en-collapsible');
	if (defaultOpen) {
		details.setAttr('open', '');
	}

	const summary = details.createEl('summary');
	summary.addClass('en-collapsible-summary');
	summary.setText(title);

	const content = details.createDiv('en-collapsible-content');

	return {
		content,
		details,
		setOpen: (open: boolean) => {
			if (open) {
				details.setAttr('open', '');
			} else {
				details.removeAttribute('open');
			}
		},
	};
}

/**
 * 创建一个结果展示区域（带标题的只读区块）。
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
 * 创建一个结果卡片。
 * @param container 父容器
 * @param title 卡片标题（可选）
 * @returns 卡片容器
 */
export function createResultCard(
	container: HTMLElement,
	title?: string,
): HTMLElement {
	const card = container.createDiv('en-result-card');
	if (title) {
		card.createEl('h3', { text: title }).addClass('en-result-card-title');
	}
	return card;
}

/**
 * 创建一个语义标签。
 * @param container 父容器
 * @param text 标签文字
 * @param tone 标签语气
 * @returns 标签元素
 */
export function createTag(
	container: HTMLElement,
	text: string,
	tone: 'neutral' | 'accent' | 'success' | 'warning' = 'neutral',
): HTMLElement {
	const tag = container.createSpan('en-tag');
	tag.addClass(`en-tag--${tone}`);
	tag.setText(text);
	return tag;
}

/**
 * 创建未配置/空状态占位。
 * @param container 父容器
 * @param icon 占位图标
 * @param message 提示文字
 * @param actionLabel 操作按钮文字
 * @param onAction 操作回调
 * @returns 占位容器
 */
export function createEmptyState(
	container: HTMLElement,
	icon: IconName,
	message: string,
	actionLabel: string,
	onAction: () => void,
): HTMLElement {
	container.empty();
	container.addClass('en-empty-state');

	const iconEl = container.createDiv('en-empty-state-icon');
	setIcon(iconEl, icon);

	container.createEl('p', { text: message });

	const button = container.createEl('button', {
		attr: {
			type: 'button',
			'aria-label': actionLabel,
			'data-tooltip-position': 'top',
		},
	});
	button.addClass('en-action-button');
	button.createSpan({ cls: 'en-button-label', text: actionLabel });
	button.addEventListener('click', () => onAction());

	return container;
}
