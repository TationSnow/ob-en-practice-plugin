import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, EnPracticeSettingTab } from '../src/settings';
import type { EnPracticeSettings } from '../src/settings';
import {
	getSettingInstances,
	resetRecordedMocks,
	type DropdownComponentLike,
} from './setup';

// 弹窗打开逻辑不在本文件测试范围内，替换为桩避免真实 Modal 依赖
vi.mock('../src/ui/model-modal', () => ({
	openModelManager: vi.fn(),
}));

/** 构造含两个档位的设置 */
function createSettings(
	overrides: Partial<EnPracticeSettings> = {},
): EnPracticeSettings {
	return {
		...DEFAULT_SETTINGS,
		models: [
			{
				id: 'profile-1',
				name: '本地 LM Studio',
				protocol: 'openai-compatible',
				baseUrl: 'http://127.0.0.1:1234/v1',
				apiKey: '',
				modelName: 'qwen3.8-9b',
				structuredOutput: 'auto',
			},
			{
				id: 'profile-2',
				name: 'DeepSeek 云端',
				protocol: 'openai-compatible',
				baseUrl: 'https://api.deepseek.com/v1',
				apiKey: 'sk-test',
				modelName: 'deepseek-chat',
				structuredOutput: 'auto',
			},
		],
		activeModelId: 'profile-1',
		...overrides,
	};
}

/** 构造设置页（插件桩含 saveSettings 侦听） */
function createTab(settings: EnPracticeSettings) {
	const plugin = {
		app: {},
		settings,
		saveSettings: vi.fn(async () => {}),
		saveData: vi.fn(async () => {}),
	};
	const tab = new EnPracticeSettingTab(
		plugin.app as never,
		plugin as never,
	);
	return { tab, plugin };
}

/** 把声明式定义松散化，便于断言 */
function flattenDefinitions(tab: EnPracticeSettingTab) {
	return tab.getSettingDefinitions() as unknown as Array<{
		type: string;
		heading?: string;
		items?: Array<Record<string, unknown>>;
	}>;
}

beforeEach(() => {
	resetRecordedMocks();
});

describe('EnPracticeSettingTab.getSettingDefinitions', () => {
	it('首组为“模型接入口”：当前模型下拉的选项为 id→名称，并附管理入口', () => {
		const { tab } = createTab(createSettings());
		const groups = flattenDefinitions(tab);

		expect(groups[0]?.heading).toBe('模型接入口');
		const items = groups[0]?.items ?? [];
		const dropdownItem = items.find(
			(item) =>
				(item.control as { type?: string } | undefined)?.type === 'dropdown',
		);
		const control = dropdownItem?.control as
			| { key: string; options: Record<string, string> }
			| undefined;
		expect(control?.key).toBe('activeModelId');
		expect(control?.options).toEqual({
			'profile-1': '本地 LM Studio',
			'profile-2': 'DeepSeek 云端',
		});
		const actionItem = items.find((item) => typeof item.action === 'function');
		expect(actionItem?.name).toBe('管理模型接入口');
	});

	it('旧版扁平字段不再出现在设置定义中', () => {
		const { tab } = createTab(createSettings());
		const groups = flattenDefinitions(tab);
		const keys = groups.flatMap((group) =>
			(group.items ?? []).map(
				(item) => (item.control as { key?: string } | undefined)?.key,
			),
		);
		expect(keys).not.toContain('baseUrl');
		expect(keys).not.toContain('modelName');
		expect(keys).not.toContain('apiKey');
		expect(keys).toContain('proxyEnabled');
		expect(keys).toContain('proxyUrl');
	});

	it('代理分组与请求行为、调试分组保持完整', () => {
		const { tab } = createTab(createSettings());
		const headings = flattenDefinitions(tab).map((group) => group.heading);
		expect(headings).toEqual([
			'模型接入口',
			'网络代理',
			'请求行为',
			'调试',
		]);
	});
});

describe('EnPracticeSettingTab 旧版渲染', () => {
	it('display() 渲染当前模型下拉与管理按钮', () => {
		const { tab } = createTab(createSettings());
		// 旧版回退渲染的刻意调用；经结构化转型避免直接引用已废弃的方法符号
		(tab as unknown as { display(): void }).display();

		const instances = getSettingInstances();
		const dropdownRow = instances.find(
			(instance) => instance.components.dropdowns.length > 0,
		);
		expect(dropdownRow?.name).toBe('当前模型');
		const dropdown = dropdownRow?.components.dropdowns[0];
		expect(Object.keys(dropdown?.options ?? {})).toEqual([
			'profile-1',
			'profile-2',
		]);
		expect(dropdown?.value).toBe('profile-1');

		const actionRow = instances.find(
			(instance) => instance.name === '管理模型接入口',
		);
		expect(actionRow?.components.buttons[0]?.text).toBe('管理…');
	});

	it('切换当前模型下拉会更新激活档位并保存设置', async () => {
		const settings = createSettings();
		const { tab, plugin } = createTab(settings);
		// 旧版回退渲染的刻意调用；经结构化转型避免直接引用已废弃的方法符号
		(tab as unknown as { display(): void }).display();

		const instances = getSettingInstances();
		const dropdownRow = instances.find(
			(instance) => instance.components.dropdowns.length > 0,
		);
		const dropdown = dropdownRow?.components
			.dropdowns[0] as DropdownComponentLike;
		await dropdown.change?.('profile-2');

		expect(settings.activeModelId).toBe('profile-2');
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it('管理按钮触发打开模型管理弹窗', async () => {
		const { openModelManager } = await import('../src/ui/model-modal');
		const { tab } = createTab(createSettings());
		// 旧版回退渲染的刻意调用；经结构化转型避免直接引用已废弃的方法符号
		(tab as unknown as { display(): void }).display();

		const actionRow = getSettingInstances().find(
			(instance) => instance.name === '管理模型接入口',
		);
		await actionRow?.components.buttons[0]?.click?.();
		expect(openModelManager).toHaveBeenCalledTimes(1);
	});
});

describe('DEFAULT_SETTINGS', () => {
	it('默认包含空的档位列表与未选择激活项', () => {
		expect(DEFAULT_SETTINGS.models).toEqual([]);
		expect(DEFAULT_SETTINGS.activeModelId).toBe('');
	});
});
