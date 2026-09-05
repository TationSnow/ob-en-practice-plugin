import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	EnPracticeSettings,
	EnPracticeSettingTab,
} from './settings';
import { applyLegacyModelMigration } from './settings/models';
import {
	EnglishPracticeView,
	VIEW_TYPE,
} from './views/english-practice-view';
import { trackDomSelection } from './utils/editor';

export default class EnPracticePlugin extends Plugin {
	settings!: EnPracticeSettings;
	settingTab!: EnPracticeSettingTab;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 注册右侧面板视图
		this.registerView(
			VIEW_TYPE,
			(leaf) => new EnglishPracticeView(leaf, this),
		);

		// 注册命令：打开英语练习面板
		this.addCommand({
			id: 'open-english-practice',
			name: '打开英语练习面板',
			callback: () => {
				this.activateView().catch(() => {});
			},
		});

		// 注册设置页
		this.settingTab = new EnPracticeSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// 缓存正文 DOM 选区：点击插件按钮会清空选区，必须随变化提前缓存，
		// 供“导入当前选区”在 PDF 等非 Markdown 视图下回退使用
		// （已知限制：popout 窗口中的 PDF 选区不在监听范围内）
		this.registerDomEvent(activeDocument, 'selectionchange', () => {
			trackDomSelection(activeDocument);
		});

		// 布局就绪后激活面板
		this.app.workspace.onLayoutReady(() => {
			this.activateView().catch(() => {});
		});
	}

	/**
	 * 激活或创建右侧面板
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		// 如果面板已存在，直接显示
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0 && existing[0]) {
			await workspace.revealLeaf(existing[0]);
			return;
		}

		// 在右侧创建新面板
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
			await workspace.revealLeaf(leaf);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<EnPracticeSettings>,
		);
		// 旧版单模型配置迁移为模型档位（含剥离历史遗留无效键、修正激活标识）；
		// 有变更时立即写回，保证迁移幂等且 data.json 与内存状态一致
		if (applyLegacyModelMigration(this.settings)) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshView();
	}

	/**
	 * 刷新所有英语练习面板
	 */
	refreshView(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof EnglishPracticeView) {
				view.render();
			}
		});
	}

	/**
	 * 通知所有面板同步激活模型档位的变化
	 * （来源：设置弹窗中的设为当前/新增/删除、面板快速切换）。
	 * 刷新粒度由面板自行决定：仅更新连接徽章；
	 * 配置从无到有时（如新增首个档位）才整页重渲染展开功能模块，
	 * 避免切换模型清空用户已输入的内容。
	 */
	notifyActiveModelChanged(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof EnglishPracticeView) {
				view.syncActiveModel();
			}
		});
	}
}
