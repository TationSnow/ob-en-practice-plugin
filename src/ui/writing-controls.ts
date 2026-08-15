import type EnPracticePlugin from '../main';
import { RANDOM_THEME } from '../utils/writing-options';
import { createIconButton } from './controls';
import { openThemeManager } from './theme-modal';

/** 主题下拉控件控制器 */
export interface ThemeSelectControl {
	getValue(): string;
	setValue(value: string): void;
}

/**
 * 创建主题下拉与“管理主题”按钮。
 * 首项固定为“随机”，其余为插件设置中的自定义主题。
 * @param container 父容器
 * @param plugin 插件实例
 * @param initialValue 初始选中值
 * @param onChange 选中值变化回调
 * @returns 主题下拉控制器
 */
export function createThemeSelect(
	container: HTMLElement,
	plugin: EnPracticePlugin,
	initialValue = RANDOM_THEME,
	onChange?: (value: string) => void,
): ThemeSelectControl {
	const row = container.createDiv('en-field-row');
	const label = row.createEl('label', { text: '主题' });
	label.addClass('en-field-label');
	label.setAttr('for', 'en-writing-theme');

	const select = row.createEl('select', {
		attr: { id: 'en-writing-theme', 'aria-label': '题目主题' },
	});
	select.addClass('en-select-input');

	let currentValue = initialValue;

	const refresh = (): void => {
		const themes = plugin.settings.writingThemes;
		const options = [RANDOM_THEME, ...themes];
		const previous = currentValue;
		select.empty();
		for (const theme of options) {
			const option = select.createEl('option', { text: theme });
			option.value = theme;
		}
		if (options.includes(previous)) {
			select.value = previous;
			currentValue = previous;
		} else {
			select.value = RANDOM_THEME;
			currentValue = RANDOM_THEME;
		}
	};

	select.addEventListener('change', () => {
		currentValue = select.value;
		onChange?.(currentValue);
	});

	createIconButton(row, 'settings-2', '管理主题', () => {
		openThemeManager(plugin, refresh);
	});

	refresh();
	return {
		getValue: () => currentValue,
		setValue: (value: string) => {
			currentValue = value;
			select.value = value;
		},
	};
}

/**
 * 创建随机数种子输入框。
 * @param container 父容器
 * @returns 种子输入元素
 */
export function createSeedField(container: HTMLElement): HTMLInputElement {
	const row = container.createDiv('en-field-row');
	const label = row.createEl('label', { text: '随机数种子（可选）' });
	label.addClass('en-field-label');
	label.setAttr('for', 'en-writing-seed');

	const input = row.createEl('input', {
		attr: {
			type: 'text',
			id: 'en-writing-seed',
			'aria-label': '随机数种子（可选）',
			placeholder: '留空则每次随机生成',
		},
	});
	input.addClass('en-text-input');
	return input;
}
