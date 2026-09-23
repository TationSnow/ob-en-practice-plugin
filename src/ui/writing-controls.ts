import type EnPracticePlugin from '../main';
import {
	normalizeThemeName,
	RANDOM_THEME,
} from '../utils/writing-options';
import { createIconButton } from './controls';
import { openThemeManager } from './theme-modal';

/** 主题候选 datalist 的元素 id（输入框通过 list 属性关联） */
const THEME_DATALIST_ID = 'en-writing-theme-options';

/** 主题下拉控件控制器 */
export interface ThemeSelectControl {
	getValue(): string;
	setValue(value: string): void;
	/** 重建候选列表（主题增删改后调用）；手动输入的当前值保留 */
	refresh(): void;
}

/**
 * 创建主题组合输入框：文本输入 + datalist 候选。
 * 兼顾下拉选择与手动输入：候选为自定义主题（datalist 联想），
 * 用户也可直接键入任意主题（不强制在候选内）。
 * “随机”不出现在候选中、也不作为默认文本填入输入框——datalist 会按
 * 输入框已有文本过滤候选，若默认填入“随机”，点开下拉只剩一个选项；
 * 随机的语义改由“留空”表达（placeholder 提示），取值时空白归一为随机。
 * @param container 父容器
 * @param plugin 插件实例
 * @param initialValue 初始值
 * @param onChange 输入值变化回调（空白归一为“随机”后回传）
 * @returns 主题输入控件控制器
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

	// 组合输入框：list 关联 datalist，聚焦/输入时弹出候选下拉
	const input = row.createEl('input', {
		attr: {
			type: 'text',
			id: 'en-writing-theme',
			list: THEME_DATALIST_ID,
			'aria-label': '题目主题',
			placeholder: '选择或输入主题，留空随机',
		},
	});
	input.addClass('en-text-input');

	const datalist = row.createEl('datalist', {
		attr: { id: THEME_DATALIST_ID },
	});

	let currentValue = initialValue;

	const refresh = (): void => {
		const themes = plugin.settings.writingThemes;
		datalist.empty();
		for (const theme of themes) {
			datalist.createEl('option', { text: theme }).setAttr('value', theme);
		}
		// 重建候选不影响输入框：手动输入的主题不在候选中也原样保留；
		// 随机语义以留空表达，输入框不显示“随机”文本
		input.value = currentValue === RANDOM_THEME ? '' : currentValue;
	};

	input.addEventListener('input', () => {
		currentValue = normalizeThemeName(input.value);
		// 回调值与 getValue 语义一致：空白归一为“随机”
		onChange?.(currentValue || RANDOM_THEME);
	});

	createIconButton(row, 'settings-2', '管理主题', () => {
		openThemeManager(plugin, refresh);
	});

	refresh();
	return {
		getValue: () => normalizeThemeName(currentValue) || RANDOM_THEME,
		setValue: (value: string) => {
			currentValue = value;
			input.value = value === RANDOM_THEME ? '' : value;
		},
		refresh,
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
