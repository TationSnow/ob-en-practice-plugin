import { ItemView, setIcon, type SettingTab, type WorkspaceLeaf } from 'obsidian';
import type EnPracticePlugin from '../main';
import { isConfigValid } from '../types';
import {
	createIconButton,
	createTabBar,
	type TabBarControl,
} from '../ui/controls';
import {
	createModelQuickSelect,
	type ModelQuickSelectControl,
} from '../ui/model-controls';
import { createEmptyState } from '../ui/sections';
import { renderGrammarAnalysis } from '../ui/grammar-tab';
import { renderWritingPractice } from '../ui/writing-tab';
import { renderDebugPanel } from '../ui/debug-panel';
import { getActiveSelection } from '../utils/editor';

export const VIEW_TYPE = 'en-practice-view';

/** 面板内可切换的工作区页签 */
type PracticeTab = 'grammar' | 'writing' | 'debug';

/** 页签固定顺序，供切换时定位 tabindex */
const TAB_ORDER: PracticeTab[] = ['grammar', 'writing', 'debug'];

export class EnglishPracticeView extends ItemView {
	plugin: EnPracticePlugin;

	private cleanupFns: Array<() => void> = [];
	private tabBar: TabBarControl | null = null;
	/** 面板头部的模型快速切换控件（激活档位变化时就地刷新选项） */
	private modelQuickSelect: ModelQuickSelectControl | null = null;
	/** 当前是否渲染着功能模块（区别于未配置占位符），供配置状态同步判断 */
	private showingModules = false;

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
			this.showingModules = false;
			this.modelQuickSelect = null;
			return;
		}

		this.renderModules(contentEl);
		this.showingModules = true;
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

	/**
	 * 同步激活模型档位变化到面板（由插件 notifyActiveModelChanged 调用）。
	 * - 配置从不完整变为完整（如新增首个档位）时整页重渲染，展开功能模块；
	 * - 其余情况仅就地刷新模型快速切换下拉（保持选项与激活档位一致），
	 *   不重渲染、不清空已输入内容。
	 */
	syncActiveModel(): void {
		if (!this.showingModules && isConfigValid(this.plugin.settings)) {
			this.render();
			return;
		}
		this.modelQuickSelect?.refresh();
	}

	/** 渲染功能模块 */
	private renderModules(container: HTMLElement): void {
		// 面板内共享事件总线，用于语法分析与翻译写作联动
		const events = new EventTarget();

		// 顶部品牌栏与模型快速切换
		const header = container.createDiv('en-panel-header');
		const brand = header.createDiv('en-panel-brand');
		const brandIcon = brand.createSpan('en-panel-icon');
		setIcon(brandIcon, 'languages');
		brand.createSpan('en-panel-title').setText('英语练习');
		// 模型快速切换：切换后由插件通知机制刷新选项，不清空已输入内容
		this.modelQuickSelect = createModelQuickSelect(header, this.plugin);
		createIconButton(header, 'settings', '打开插件设置', () => {
			this.openSettings();
		});

		// 页签栏：语法分析 / 翻译写作，调试模式开启时追加调试页签
		const tabs: { id: PracticeTab; label: string }[] = [
			{ id: 'grammar', label: '语法分析' },
			{ id: 'writing', label: '翻译写作' },
		];
		if (this.plugin.settings.debugMode) {
			tabs.push({ id: 'debug', label: '调试' });
		}
		this.tabBar = createTabBar(
			container,
			tabs,
			0,
			(index) => {
				const tab = tabs[index];
				if (tab) this.setActiveTab(tab.id);
			},
		);

		const grammarPanel = container.createDiv('en-tab-panel');
		grammarPanel.id = 'en-tab-panel-grammar';
		const writingPanel = container.createDiv('en-tab-panel');
		writingPanel.id = 'en-tab-panel-writing';
		writingPanel.addClass('is-hidden');
		const debugPanel = container.createDiv('en-tab-panel');
		debugPanel.id = 'en-tab-panel-debug';
		debugPanel.addClass('is-hidden');

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
		const cleanupDebug = this.plugin.settings.debugMode
			? renderDebugPanel(debugPanel, { embedded: true })
			: () => {};
		this.cleanupFns = [cleanupGrammar, cleanupWriting, cleanupDebug];
	}

	/** 切换当前工作区页签 */
	private setActiveTab(tab: PracticeTab): void {
		const tabIndex = TAB_ORDER.indexOf(tab);
		if (tabIndex >= 0) {
			this.tabBar?.setActive(tabIndex);
		}
		const grammarPanel = this.contentEl.querySelector(
			'#en-tab-panel-grammar',
		);
		const writingPanel = this.contentEl.querySelector(
			'#en-tab-panel-writing',
		);
		const debugPanel = this.contentEl.querySelector(
			'#en-tab-panel-debug',
		);
		grammarPanel?.toggleClass('is-hidden', tab !== 'grammar');
		writingPanel?.toggleClass('is-hidden', tab !== 'writing');
		debugPanel?.toggleClass('is-hidden', tab !== 'debug');
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
