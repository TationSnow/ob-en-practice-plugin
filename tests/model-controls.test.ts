import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createModelQuickSelect,
	formatModelBadgeText,
} from '../src/ui/model-controls';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EnPracticeSettings } from '../src/settings';
import type { ModelProfile } from '../src/settings/models';
import {
	getNoticeMessages,
	resetRecordedMocks,
	StubElement,
} from './setup';

/** 构造一个本地档位 */
function createProfile(
	overrides: Partial<ModelProfile> = {},
): ModelProfile {
	return {
		id: 'profile-1',
		name: '本地 LM Studio',
		protocol: 'openai-compatible',
		baseUrl: 'http://127.0.0.1:1234/v1',
		apiKey: '',
		modelName: 'qwen3.8-9b',
		structuredOutput: 'auto',
		...overrides,
	};
}

/** 构造设置（默认含两个档位，激活第一个） */
function createSettings(
	profiles?: ModelProfile[],
	activeModelId = 'profile-1',
): EnPracticeSettings {
	return {
		...DEFAULT_SETTINGS,
		models:
			profiles ??
			[
				createProfile(),
				createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
			],
		activeModelId,
	};
}

/** 构造插件桩（含保存与通知侦听） */
function createPlugin(settings: EnPracticeSettings) {
	return {
		app: {},
		settings,
		saveData: vi.fn(async () => {}),
		notifyActiveModelChanged: vi.fn(),
	};
}

/** 等待异步持久化流程完成 */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	resetRecordedMocks();
});

describe('formatModelBadgeText', () => {
	it('有激活档位时显示“已连接 · 档位名”', () => {
		expect(formatModelBadgeText(createSettings())).toBe(
			'已连接 · 本地 LM Studio',
		);
	});

	it('无任何档位时仅显示“已连接”', () => {
		expect(formatModelBadgeText(createSettings([], ''))).toBe('已连接');
	});

	it('激活标识为空时回退显示首个档位（与实际请求使用的档位一致）', () => {
		expect(formatModelBadgeText(createSettings(undefined, ''))).toBe(
			'已连接 · 本地 LM Studio',
		);
	});
});

describe('createModelQuickSelect', () => {
	it('渲染全部档位选项并选中激活项，附带管理按钮', () => {
		const container = new StubElement();
		const plugin = createPlugin(createSettings());

		createModelQuickSelect(
			container as unknown as HTMLElement,
			plugin as never,
		);

		const select = container.children.find((el) => el.tag === 'select');
		const optionTexts = (select?.children ?? [])
			.filter((el) => el.tag === 'option')
			.map((el) => el.text);
		expect(optionTexts).toEqual(['本地 LM Studio', 'DeepSeek 云端']);
		expect(select?.value).toBe('profile-1');

		const manageButtons = container.children.filter(
			(el) => el.tag === 'button',
		);
		expect(manageButtons).toHaveLength(1);
		expect(manageButtons[0]?.attrs['aria-label']).toBe('管理模型接入口');
	});

	it('切换选项后保存设置并通知插件同步面板（不整页刷新）', async () => {
		const container = new StubElement();
		const plugin = createPlugin(createSettings());
		createModelQuickSelect(
			container as unknown as HTMLElement,
			plugin as never,
		);
		const select = container.children.find((el) => el.tag === 'select');

		select?.trigger('change');
		// 未变更选中项时不应触发保存
		expect(plugin.saveData).not.toHaveBeenCalled();

		if (select) select.value = 'profile-2';
		select?.trigger('change');
		await flush();

		expect(plugin.settings.activeModelId).toBe('profile-2');
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
		// 通知插件同步面板徽章，而不是依赖整页重渲染
		expect(plugin.notifyActiveModelChanged).toHaveBeenCalledTimes(1);
		expect(getNoticeMessages().join('\n')).toContain(
			'已切换至 DeepSeek 云端',
		);
	});

	it('选中项不存在时不触发保存与通知', async () => {
		const container = new StubElement();
		const plugin = createPlugin(createSettings());
		createModelQuickSelect(
			container as unknown as HTMLElement,
			plugin as never,
		);
		const select = container.children.find((el) => el.tag === 'select');

		if (select) select.value = 'missing';
		select?.trigger('change');
		await flush();

		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(plugin.notifyActiveModelChanged).not.toHaveBeenCalled();
	});

	it('refresh 重建选项并保持当前选择', () => {
		const container = new StubElement();
		const plugin = createPlugin(createSettings());
		const control = createModelQuickSelect(
			container as unknown as HTMLElement,
			plugin as never,
		);
		const select = container.children.find((el) => el.tag === 'select');

		// 模拟弹窗中新增档位后回调刷新
		plugin.settings.models = [
			...plugin.settings.models,
			createProfile({ id: 'profile-3', name: '云端备用' }),
		];
		control.refresh();

		const optionTexts = (select?.children ?? [])
			.filter((el) => el.tag === 'option')
			.map((el) => el.text);
		expect(optionTexts).toHaveLength(3);
		// 原选中项仍存在，保持选中
		expect(select?.value).toBe('profile-1');
	});
});
