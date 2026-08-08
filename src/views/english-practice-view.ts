import { ItemView, WorkspaceLeaf, SettingTab } from 'obsidian';
import type EnPracticePlugin from '../main';
import { isConfigValid } from '../types';
import { createPlaceholder } from '../ui/components';
import { renderGrammarAnalysis } from '../ui/grammar-tab';
import { renderWritingPractice } from '../ui/writing-tab';

export const VIEW_TYPE = 'en-practice-view';

export class EnglishPracticeView extends ItemView {
	plugin: EnPracticePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: EnPracticePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return '英语练习';
	}

	getIcon(): string {
		return 'languages';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	/**
	 * 渲染面板内容
	 * 根据配置状态决定显示占位符还是功能模块
	 */
	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('en-practice-view');

		if (!isConfigValid(this.plugin.settings)) {
			this.renderPlaceholder(contentEl);
			return;
		}

		this.renderModules(contentEl);
	}

	/**
	 * 渲染未配置时的占位提示
	 */
	private renderPlaceholder(container: HTMLElement): void {
		createPlaceholder(
			container,
			'请先配置 API 地址和模型名称以使用英语练习功能。',
			() => {
				// 访问 Obsidian 内部 API 打开设置并跳转到当前插件页
				const internalApp = this.plugin.app as unknown as {
					setting: {
						open: () => void;
						openTab: (tab: SettingTab) => void;
					};
				};
				internalApp.setting.open();
				const settingTab = this.plugin.settingTab;
				if (settingTab) {
					internalApp.setting.openTab(settingTab);
				}
			},
		);
	}

	/**
	 * 渲染功能模块
	 */
	private renderModules(container: HTMLElement): void {
		// 面板内共享事件总线，用于语法分析与翻译写作联动
		const events = new EventTarget();

		// 语法分析模块
		renderGrammarAnalysis(container, this.plugin, events);

		// 翻译写作模块
		renderWritingPractice(container, this.plugin, events);
	}
}
