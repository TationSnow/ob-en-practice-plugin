import { Modal, Notice, Setting, type TextComponent } from 'obsidian';
import type EnPracticePlugin from '../main';
import {
	addTheme,
	hasTheme,
	normalizeThemeName,
	removeTheme,
	renameTheme,
} from '../utils/writing-options';
import { createIconButton } from './controls';

/**
 * 打开主题管理弹窗。
 * @param plugin 插件实例
 * @param onChange 主题列表变化后的回调（用于刷新写作页下拉）
 */
export function openThemeManager(
	plugin: EnPracticePlugin,
	onChange: () => void,
): void {
	new ThemeManagerModal(plugin, onChange).open();
}

/** 主题管理弹窗：支持主题的增、删、改、查 */
class ThemeManagerModal extends Modal {
	private plugin: EnPracticePlugin;
	private onChange: () => void;

	constructor(plugin: EnPracticePlugin, onChange: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.onChange = onChange;
	}

	onOpen(): void {
		this.titleEl.setText('管理主题');
		this.render();
	}

	/** 渲染主题列表与添加表单 */
	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const list = contentEl.createDiv('en-theme-list');
		const themes = this.plugin.settings.writingThemes;
		if (themes.length === 0) {
			list
				.createEl('p', { text: '暂无自定义主题，可在下方添加。' })
				.addClass('en-theme-empty');
		} else {
			for (const theme of themes) {
				this.renderThemeRow(list, theme);
			}
		}

		let themeInput: TextComponent;
		new Setting(contentEl)
			.setName('添加主题')
			.setDesc('添加后可在翻译写作页的主题下拉中选择。')
			.addText((text) => {
				themeInput = text;
				text.setPlaceholder('输入主题名称，如 环保');
			})
			.addButton((button) =>
				button.setButtonText('添加').setCta().onClick(async () => {
					const name = normalizeThemeName(themeInput.getValue());
					if (!name) {
						new Notice('请输入主题名称');
						return;
					}
					if (hasTheme(this.plugin.settings.writingThemes, name)) {
						new Notice('主题已存在');
						return;
					}
					this.plugin.settings.writingThemes = addTheme(
						this.plugin.settings.writingThemes,
						name,
					);
					await this.saveThemes();
					this.render();
				}),
			);
	}

	/** 渲染单个主题的编辑行 */
	private renderThemeRow(list: HTMLElement, theme: string): void {
		const row = list.createDiv('en-theme-row');
		const input = row.createEl('input', {
			attr: {
				type: 'text',
				value: theme,
				'aria-label': `主题 ${theme}`,
			},
		});
		createIconButton(row, 'check', '保存修改', () => {
			void this.renameTheme(theme, input.value);
		});
		createIconButton(row, 'trash-2', '删除主题', () => {
			void this.deleteTheme(theme);
		});
	}

	/** 重命名主题并持久化 */
	private async renameTheme(
		oldName: string,
		newValue: string,
	): Promise<void> {
		const name = normalizeThemeName(newValue);
		if (!name) {
			new Notice('主题名称不能为空');
			return;
		}
		if (name === oldName) {
			return;
		}
		const others = this.plugin.settings.writingThemes.filter(
			(item) => item !== oldName,
		);
		if (hasTheme(others, name)) {
			new Notice('主题已存在');
			return;
		}
		this.plugin.settings.writingThemes = renameTheme(
			this.plugin.settings.writingThemes,
			oldName,
			name,
		);
		await this.saveThemes();
		this.render();
	}

	/** 删除主题并持久化 */
	private async deleteTheme(theme: string): Promise<void> {
		this.plugin.settings.writingThemes = removeTheme(
			this.plugin.settings.writingThemes,
			theme,
		);
		await this.saveThemes();
		this.render();
	}

	/** 直接保存插件数据并通知写作页刷新下拉，避免整页重渲染 */
	private async saveThemes(): Promise<void> {
		await this.plugin.saveData(this.plugin.settings);
		this.onChange();
	}
}
