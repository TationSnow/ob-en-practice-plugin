import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import {
	getActiveModelProfile,
	type GlobalModelDefaults,
} from '../settings/models';
import { createIconButton } from './controls';
import { openModelManager } from './model-modal';

/** 模型快速切换控件的控制器 */
export interface ModelQuickSelectControl {
	/** 重建下拉选项并尽量保持当前选择（档位列表变化后调用） */
	refresh(): void;
}

/**
 * 计算面板连接徽章文案：显示当前激活档位名，未选择时仅显示“已连接”。
 * 供视图初始渲染与激活档位变化同步共用，保证两处格式一致。
 * @param settings 全局设置
 * @returns 徽章文案
 */
export function formatModelBadgeText(settings: GlobalModelDefaults): string {
	const active = getActiveModelProfile(settings);
	return active ? `已连接 · ${active.name}` : '已连接';
}

/**
 * 创建面板头部的模型快速切换下拉与“管理接入口”按钮。
 * 切换时直接保存插件数据（不走 saveSettings），不触发面板整页重渲染，
 * 避免清空用户已输入的内容；保存后通过 notifyActiveModelChanged
 * 通知插件同步连接徽章等面板状态。
 * @param container 父容器（面板头部）
 * @param plugin 插件实例
 * @returns 快速切换控件控制器
 */
export function createModelQuickSelect(
	container: HTMLElement,
	plugin: EnPracticePlugin,
): ModelQuickSelectControl {
	const select = container.createEl('select', {
		attr: { 'aria-label': '切换模型接入口' },
	});
	select.addClass('en-model-switch');

	const refresh = (): void => {
		const models = plugin.settings.models ?? [];
		const previous = select.value;
		select.empty();
		for (const profile of models) {
			const option = select.createEl('option', { text: profile.name });
			option.value = profile.id;
		}
		// 之前选中的档位仍存在时保持选中，否则跟随激活档位
		if (previous !== '' && models.some((profile) => profile.id === previous)) {
			select.value = previous;
		} else {
			select.value = getActiveModelProfile(plugin.settings)?.id ?? '';
		}
	};

	select.addEventListener('change', () => {
		const profile = (plugin.settings.models ?? []).find(
			(item) => item.id === select.value,
		);
		// 幂等守卫：选中项不存在，或与当前实际生效的档位一致时，
		// 不保存、不通知，避免重复的持久化与面板同步
		const effectiveActiveId =
			getActiveModelProfile(plugin.settings)?.id ?? '';
		if (!profile || profile.id === effectiveActiveId) {
			return;
		}
		plugin.settings.activeModelId = profile.id;
		void plugin.saveData(plugin.settings).then(() => {
			// 通知插件同步面板状态（连接徽章等），与设置弹窗内的切换行为保持一致
			plugin.notifyActiveModelChanged();
			new Notice(`已切换至 ${profile.name}`);
		});
	});

	createIconButton(container, 'settings-2', '管理模型接入口', () => {
		openModelManager(plugin, refresh);
	});

	refresh();
	return { refresh };
}
