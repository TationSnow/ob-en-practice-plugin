/** 状态条可用的状态 */
export type StatusState = 'idle' | 'loading' | 'success' | 'error';

/** 状态条控制器 */
export interface StatusLineControl {
	clear(): void;
	hide(): void;
	setState(state: StatusState): void;
	setText(text: string): void;
	show(): void;
}

/**
 * 创建统一的加载/成功/错误状态条。
 * 使用 aria-live 向屏幕阅读器播报动态变化。
 * @param container 父容器
 * @returns 状态条控制器
 */
export function createStatusLine(container: HTMLElement): StatusLineControl {
	const root = container.createDiv('en-status-line');
	root.setAttr('role', 'status');
	root.setAttr('aria-live', 'polite');
	root.setAttr('aria-atomic', 'true');
	root.addClass('is-hidden');

	root.createSpan('en-status-spinner');
	const text = root.createSpan('en-status-text');

	const setState = (state: StatusState): void => {
		for (const candidate of ['idle', 'loading', 'success', 'error'] as const) {
			root.toggleClass(`is-${candidate}`, candidate === state);
		}
	};

	return {
		clear: () => {
			text.empty();
			setState('idle');
		},
		hide: () => {
			root.addClass('is-hidden');
		},
		setState,
		setText: (value: string) => {
			text.setText(value);
		},
		show: () => {
			root.removeClass('is-hidden');
		},
	};
}
