import { ItemView, setIcon, type SettingTab, type WorkspaceLeaf } from 'obsidian';
import type EnPracticePlugin from '../main';
import { isConfigValid } from '../types';
import {
	createIconButton,
	createTabBar,
	type TabBarControl,
} from '../ui/controls';
import { createEmptyState } from '../ui/sections';
import { renderGrammarAnalysis } from '../ui/grammar-tab';
import { renderWritingPractice } from '../ui/writing-tab';
import { getActiveSelection } from '../utils/editor';

export const VIEW_TYPE = 'en-practice-view';

/** 面板内可切换的工作区页签 */
type PracticeTab = 'grammar' | 'writing';

export class EnglishPracticeView extends ItemView {
	plugin: EnPracticePlugin;

	private cleanupFns: Array<() => void> = [];
	private tabBar: TabBarControl | null = null;

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

	async onClose(): Promise<void> {
		this.runCleanup();
	}

	/**
	 * 渲染面板内容。
	 * 根据配置状态决定显示占位符还是功能模块。
	 */
	render(): void {
		this.runCleanup();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('en-practice-view');

		if (!isConfigValid(this.plugin.settings)) {
			this.renderPlaceholder(contentEl);
			return;
		}

		this.renderModules(contentEl);
	}

	/** 执行所有模块清理函数，避免重渲染或关闭时泄漏订阅 */
	private runCleanup(): void {
		for (const cleanup of this.cleanupFns) {
			cleanup();
		}
		this.cleanupFns = [];
	}

	/** 渲染未配置时的占位提示 */
	private renderPlaceholder(container: HTMLElement): void {
		createEmptyState(
			container,
			'settings',
			'请先配置 API 地址和模型名称以使用英语练习功能。',
			'前往设置',
			() => this.openSettings(),
		);
	}

	/** 渲染功能模块 */
	private renderModules(container: HTMLElement): void {
		// 面板内共享事件总线，用于语法分析与翻译写作联动
		const events = new EventTarget();

		// 顶部品牌栏与配置状态
		const header = container.createDiv('en-panel-header');
		const brand = header.createDiv('en-panel-brand');
		const brandIcon = brand.createSpan('en-panel-icon');
		setIcon(brandIcon, 'languages');
		brand.createSpan('en-panel-title').setText('英语练习');
		const statusBadge = header.createSpan('en-status-badge');
		statusBadge.setText('已连接');
		statusBadge.addClass('is-ready');
		createIconButton(header, 'settings', '打开插件设置', () => {
			this.openSettings();
		});

		// 双页签：语法分析 / 翻译写作
		this.tabBar = createTabBar(
			container,
			[
				{ id: 'grammar', label: '语法分析' },
				{ id: 'writing', label: '翻译写作' },
			],
			0,
			(index) => this.setActiveTab(index === 0 ? 'grammar' : 'writing'),
		);

		const grammarPanel = container.createDiv('en-tab-panel');
		grammarPanel.id = 'en-tab-panel-grammar';
		const writingPanel = container.createDiv('en-tab-panel');
		writingPanel.id = 'en-tab-panel-writing';
		writingPanel.addClass('is-hidden');

		const cleanupGrammar = renderGrammarAnalysis(
			grammarPanel,
			this.plugin,
			events,
			{
				getSelection: () => getActiveSelection(this.plugin.app),
				onUseForWriting: () => this.setActiveTab('writing'),
			},
		);
		const cleanupWriting = renderWritingPractice(
			writingPanel,
			this.plugin,
			events,
		);
		this.cleanupFns = [cleanupGrammar, cleanupWriting];
	}

	/** 切换当前工作区页签 */
	private setActiveTab(tab: PracticeTab): void {
		this.tabBar?.setActive(tab === 'grammar' ? 0 : 1);
		const grammarPanel = this.contentEl.querySelector(
			'#en-tab-panel-grammar',
		);
		const writingPanel = this.contentEl.querySelector(
			'#en-tab-panel-writing',
		);
		grammarPanel?.toggleClass('is-hidden', tab !== 'grammar');
		writingPanel?.toggleClass('is-hidden', tab !== 'writing');
	}

	/** 打开插件设置页 */
	private openSettings(): void {
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
	}
}
