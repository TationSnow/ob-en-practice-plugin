import { setIcon, type IconName } from 'obsidian';

/** 动作按钮的可选配置 */
export interface ActionButtonOptions {
	/** 按钮左侧图标 */
	icon?: IconName;
	/** 视觉优先级 */
	variant?: 'primary' | 'secondary' | 'ghost';
	/** 额外 CSS 类名 */
	className?: string;
}

/**
 * 创建一个带加载状态的按钮。
 * 加载期间保留原文字与宽度，避免布局跳动，并防止重复提交。
 * @param container 父容器
 * @param text 按钮文字
 * @param onClick 点击回调
 * @param options 可选配置
 * @returns 按钮元素
 */
export function createActionButton(
	container: HTMLElement,
	text: string,
	onClick: () => Promise<void>,
	options: ActionButtonOptions = {},
): HTMLButtonElement {
	const button = container.createEl('button', {
		attr: {
			type: 'button',
			'aria-label': text,
			'data-tooltip-position': 'top',
		},
	});
	button.addClass('en-action-button');
	if (options.variant) {
		button.addClass(`en-action-button--${options.variant}`);
	}
	if (options.className) {
		button.addClass(options.className);
	}
	if (options.icon) {
		const icon = button.createSpan({ cls: 'en-button-icon' });
		setIcon(icon, options.icon);
	}
	button.createSpan({ cls: 'en-button-label', text });

	button.addEventListener('click', () => {
		if (button.getAttribute('disabled') !== null) return;
		button.addClass('is-loading');
		button.setAttr('disabled', '');
		button.setAttr('aria-busy', 'true');
		void onClick().finally(() => {
			button.removeClass('is-loading');
			button.removeAttribute('disabled');
			button.removeAttribute('aria-busy');
		});
	});

	return button;
}

/** 图标按钮的可选配置 */
export interface IconButtonOptions {
	/** 紧凑变体：约 20px 内联尺寸、无边框透明背景，用于标题行内（如播放按钮） */
	compact?: boolean;
}

/**
 * 创建一个图标按钮，仅用于工具栏中的高频操作。
 * @param container 父容器
 * @param icon 图标名称
 * @param ariaLabel 无障碍名称与 tooltip
 * @param onClick 点击回调
 * @param options 可选配置（compact 紧凑变体）
 * @returns 按钮元素
 */
export function createIconButton(
	container: HTMLElement,
	icon: IconName,
	ariaLabel: string,
	onClick: () => void,
	options: IconButtonOptions = {},
): HTMLButtonElement {
	const button = container.createEl('button', {
		attr: {
			type: 'button',
			'aria-label': ariaLabel,
			'data-tooltip-position': 'top',
		},
	});
	button.addClass('en-icon-button');
	if (options.compact) {
		button.addClass('en-icon-button--compact');
	}
	setIcon(button, icon);
	button.addEventListener('click', () => onClick());
	return button;
}

/** 分段控件选项 */
export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
}

/** 分段控件控制器 */
export interface SegmentedControl<T extends string> {
	getValue(): T;
	setValue(value: T): void;
}

/**
 * 创建可键盘操作的分段控件。
 * @param container 父容器
 * @param options 控件配置
 * @returns 分段控件控制器
 */
export function createSegmentedControl<T extends string>(
	container: HTMLElement,
	options: {
		ariaLabel: string;
		value: T;
		options: SegmentedOption<T>[];
		onChange: (value: T) => void;
	},
): SegmentedControl<T> {
	const root = container.createDiv('en-segmented');
	root.setAttr('role', 'radiogroup');
	root.setAttr('aria-label', options.ariaLabel);

	const buttons: HTMLButtonElement[] = [];
	let currentValue = options.value;
	const setValue = (value: T): void => {
		currentValue = value;
		for (let index = 0; index < options.options.length; index += 1) {
			const option = options.options[index];
			const button = buttons[index];
			if (!option || !button) continue;
			const active = option.value === value;
			button.toggleClass('is-active', active);
			button.setAttr('aria-checked', String(active));
		}
		options.onChange(value);
	};

	options.options.forEach((option, index) => {
		const active = option.value === options.value;
		const button = root.createEl('button', {
			attr: {
				type: 'button',
				role: 'radio',
				'aria-checked': String(active),
			},
		});
		button.addClass('en-segment');
		if (active) button.addClass('is-active');
		button.setText(option.label);
		button.addEventListener('click', () => setValue(option.value));
		button.addEventListener('keydown', (event) => {
			const currentIndex = buttons.indexOf(button);
			let nextIndex: number | null = null;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				nextIndex = (currentIndex + 1) % buttons.length;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
			} else if (event.key === 'Home') {
				nextIndex = 0;
			} else if (event.key === 'End') {
				nextIndex = buttons.length - 1;
			}
			if (nextIndex === null) return;
			event.preventDefault();
			const nextOption = options.options[nextIndex];
			if (nextOption) setValue(nextOption.value);
			buttons[nextIndex]?.focus();
		});
		buttons.push(button);
	});

	return {
		getValue: () => currentValue,
		setValue,
	};
}

/** 页签控制器 */
export interface TabBarControl {
	getActive(): number;
	setActive(index: number): void;
}

/** 页签定义 */
export interface TabDefinition {
	id: string;
	label: string;
}

/**
 * 创建支持方向键切换的页签栏。
 * @param container 父容器
 * @param tabs 页签列表
 * @param initialIndex 初始激活页签
 * @param onChange 激活页签变化回调
 * @returns 页签控制器
 */
export function createTabBar(
	container: HTMLElement,
	tabs: TabDefinition[],
	initialIndex: number,
	onChange: (index: number) => void,
): TabBarControl {
	const root = container.createDiv('en-tab-bar');
	root.setAttr('role', 'tablist');

	const buttons: HTMLButtonElement[] = [];
	let activeIndex = initialIndex;

	const setActive = (index: number): void => {
		if (index === activeIndex) return;
		activeIndex = index;
		for (let i = 0; i < buttons.length; i += 1) {
			const button = buttons[i];
			if (!button) continue;
			const active = i === index;
			button.toggleClass('is-active', active);
			button.setAttr('aria-selected', String(active));
			button.setAttr('tabindex', active ? '0' : '-1');
		}
		onChange(index);
	};

	tabs.forEach((tab, index) => {
		const active = index === initialIndex;
		const button = root.createEl('button', {
			attr: {
				type: 'button',
				role: 'tab',
				'aria-selected': String(active),
				'aria-controls': `en-tab-panel-${tab.id}`,
				tabindex: active ? '0' : '-1',
			},
		});
		button.addClass('en-tab-button');
		if (active) button.addClass('is-active');
		button.setText(tab.label);
		button.addEventListener('click', () => {
			button.focus();
			setActive(index);
		});
		button.addEventListener('keydown', (event) => {
			let nextIndex: number | null = null;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				nextIndex = (index + 1) % buttons.length;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				nextIndex = (index - 1 + buttons.length) % buttons.length;
			} else if (event.key === 'Home') {
				nextIndex = 0;
			} else if (event.key === 'End') {
				nextIndex = buttons.length - 1;
			}
			if (nextIndex === null) return;
			event.preventDefault();
			buttons[nextIndex]?.focus();
			setActive(nextIndex);
		});
		buttons.push(button);
	});

	return {
		getActive: () => activeIndex,
		setActive,
	};
}
