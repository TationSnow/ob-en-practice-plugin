import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Modal } from 'obsidian';
import { openModelManager } from '../src/ui/model-modal';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EnPracticeSettings } from '../src/settings';
import type { ModelProfile } from '../src/settings/models';
import {
	getNoticeMessages,
	getSettingInstances,
	resetRecordedMocks,
	type StubElementLike,
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

/** 构造设置 */
function createSettings(
	profiles: ModelProfile[] = [createProfile()],
	activeModelId = 'profile-1',
): EnPracticeSettings {
	return { ...DEFAULT_SETTINGS, models: profiles, activeModelId };
}

/** 构造插件桩 */
function createPlugin(settings: EnPracticeSettings) {
	return {
		app: {},
		settings,
		saveData: vi.fn(async () => {}),
		saveSettings: vi.fn(async () => {}),
		notifyActiveModelChanged: vi.fn(),
	};
}

/** 打开弹窗并返回内容桩与插件桩 */
function openModal(settings = createSettings()) {
	const plugin = createPlugin(settings);
	const modal = openModelManager(
		plugin as never,
		() => {},
	) as unknown as Modal & { contentEl: StubElementLike };
	return { modal, plugin, contentEl: modal.contentEl };
}

/** 等待异步持久化流程完成 */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 统计容器中 Setting 行标记数量（DOM 层面检测重复渲染） */
function countSettingRows(root: StubElementLike): number {
	return root.queryAll((el) => el.tag === 'setting-row').length;
}

/** 打开弹窗并进入指定档位的编辑表单 */
function openEditForm(profileName: string) {
	const { plugin, contentEl } = openModal();
	findButtons(contentEl, `编辑：${profileName}`)[0]?.trigger('click');
	return { plugin, contentEl };
}

/** 按类别查找全部行内图标按钮（以 aria-label 定位） */
function findButtons(root: StubElementLike, labelPrefix: string) {
	return root.queryAll(
		(el) =>
			el.tag === 'button' &&
			(el.attrs['aria-label'] ?? '').startsWith(labelPrefix),
	);
}

beforeEach(() => {
	resetRecordedMocks();
});

describe('ModelManagerModal 列表视图', () => {
	it('渲染档位名称、模型与地址摘要，激活档位带“当前”徽章', () => {
		const { contentEl } = openModal(
			createSettings([
				createProfile(),
				createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
			]),
		);

		const rows = contentEl.queryAll((el) =>
			el.classes.has('en-model-row'),
		);
		expect(rows).toHaveLength(2);

		const firstName = rows[0]?.queryAll((el) =>
			el.classes.has('en-model-row-name'),
		)[0];
		// 名称文字在行内的 span 子元素上
		expect(
			firstName?.children.find((child) => child.tag === 'span')?.text,
		).toBe('本地 LM Studio');
		// 激活档位带“当前”徽章
		expect(
			firstName?.children.some(
				(child) => child.classes.has('en-tag') && child.text === '当前',
			),
		).toBe(true);

		const meta = rows[0]?.queryAll((el) =>
			el.classes.has('en-model-row-meta'),
		)[0];
		expect(meta?.text).toBe('qwen3.8-9b · http://127.0.0.1:1234/v1');

		// 非激活档位没有“当前”徽章，但有“设为当前”按钮
		const secondName = rows[1]?.queryAll((el) =>
			el.classes.has('en-model-row-name'),
		)[0];
		expect(
			secondName?.children.some(
				(child) => child.classes.has('en-tag') && child.text === '当前',
			),
		).toBe(false);
		expect(findButtons(contentEl, '设为当前：DeepSeek 云端')).toHaveLength(1);
	});

	it('空档位列表渲染占位提示', () => {
		const { contentEl } = openModal(createSettings([], ''));
		const empty = contentEl.queryAll((el) =>
			el.classes.has('en-model-empty'),
		);
		expect(empty).toHaveLength(1);
		expect(empty[0]?.text).toContain('暂无模型接入口');
	});

	it('点击“设为当前”后切换激活档位、保存并提示', async () => {
		const settings = createSettings([
			createProfile(),
			createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
		]);
		const { plugin, contentEl } = openModal(settings);

		const button = findButtons(contentEl, '设为当前：DeepSeek 云端')[0];
		button?.trigger('click');
		await flush();

		expect(settings.activeModelId).toBe('profile-2');
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
		expect(getNoticeMessages().join('\n')).toContain(
			'已切换至 DeepSeek 云端',
		);
	});

	it('删除激活档位后自动切换到剩余首个档位', async () => {
		const settings = createSettings([
			createProfile(),
			createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
		]);
		const { contentEl } = openModal(settings);

		findButtons(contentEl, '删除：本地 LM Studio')[0]?.trigger('click');
		await flush();

		expect(settings.models.map((profile) => profile.id)).toEqual([
			'profile-2',
		]);
		expect(settings.activeModelId).toBe('profile-2');
	});

	it('最后一个档位不可删除，保护已录入信息', async () => {
		const settings = createSettings();
		const { contentEl } = openModal(settings);

		findButtons(contentEl, '删除：本地 LM Studio')[0]?.trigger('click');
		await flush();

		expect(settings.models).toHaveLength(1);
		expect(getNoticeMessages().join('\n')).toContain(
			'至少保留一个模型接入口',
		);
	});
});

describe('ModelManagerModal 表单视图', () => {
	/** 通过“新增”入口进入表单视图 */
	async function openForm() {
		const settings = createSettings();
		const { plugin, contentEl } = openModal(settings);
		const addRow = getSettingInstances().find(
			(instance) => instance.name === '新增模型接入口',
		);
		await addRow?.components.buttons[0]?.click?.();
		return { settings, plugin, contentEl };
	}

	it('进入新增表单后包含基础字段与结构化输出模式选项', async () => {
		await openForm();

		const names = getSettingInstances().map((instance) => instance.name);
		expect(names).toContain('名称');
		expect(names).toContain('API 地址');
		expect(names).toContain('API 密钥');
		expect(names).toContain('模型名称');
		expect(names).toContain('结构化输出模式');
		expect(names).toContain('代理覆盖');
		expect(names).toContain('最长 token 覆盖');

		const modeRow = getSettingInstances().find(
			(instance) => instance.name === '结构化输出模式',
		);
		const dropdown = modeRow?.components.dropdowns[0];
		expect(Object.keys(dropdown?.options ?? {})).toEqual([
			'auto',
			'json_object',
			'json_schema',
			'none',
		]);
	});

	it('填写必填项并保存后写入新档位', async () => {
		const { settings, contentEl } = await openForm();
		const instances = () => getSettingInstances();

		const type = (rowName: string, value: string): void => {
			const row = instances().find((instance) => instance.name === rowName);
			row?.components.texts[0]?.change?.(value);
		};
		type('名称', '云端备用');
		type('API 地址', 'https://api.example.com/v1');
		type('模型名称', 'gpt-4o-mini');

		const saveRow = instances().find(
			(instance) => instance.name === '新增接入口',
		);
		const saveButton = saveRow?.components.buttons.find(
			(button) => button.text === '保存',
		);
		await saveButton?.click?.();
		await flush();

		expect(settings.models).toHaveLength(2);
		expect(settings.models[1]?.name).toBe('云端备用');
		expect(settings.models[1]?.structuredOutput).toBe('auto');
		// 保存后回到列表视图
		expect(
			contentEl.queryAll((el) => el.classes.has('en-model-row')),
		).toHaveLength(2);
	});

	it('必填项缺失时保存被拒绝并提示', async () => {
		const { settings } = await openForm();

		const saveRow = getSettingInstances().find(
			(instance) => instance.name === '新增接入口',
		);
		await saveRow?.components.buttons
			.find((button) => button.text === '保存')
			?.click?.();

		expect(settings.models).toHaveLength(1);
		expect(getNoticeMessages().join('\n')).toContain('名称不能为空');
	});

	it('启用代理覆盖后展示代理地址输入行', async () => {
		await openForm();

		const proxyRow = getSettingInstances().find(
			(instance) => instance.name === '代理覆盖',
		);
		await proxyRow?.components.dropdowns[0]?.change?.('on');

		expect(
			getSettingInstances().some(
				(instance) => instance.name === '代理地址',
			),
		).toBe(true);
	});
});

describe('激活档位变化通知面板（BUG 回归：徽章不同步）', () => {
	it('弹窗中设为当前后，通知插件同步面板徽章', async () => {
		const settings = createSettings([
			createProfile(),
			createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
		]);
		const { plugin, contentEl } = openModal(settings);

		findButtons(contentEl, '设为当前：DeepSeek 云端')[0]?.trigger('click');
		await flush();

		expect(settings.activeModelId).toBe('profile-2');
		expect(plugin.notifyActiveModelChanged).toHaveBeenCalledTimes(1);
	});

	it('删除激活档位（自动切换到剩余首个）后通知插件同步面板徽章', async () => {
		const settings = createSettings([
			createProfile(),
			createProfile({ id: 'profile-2', name: 'DeepSeek 云端' }),
		]);
		const { plugin, contentEl } = openModal(settings);

		findButtons(contentEl, '删除：本地 LM Studio')[0]?.trigger('click');
		await flush();

		expect(settings.activeModelId).toBe('profile-2');
		expect(plugin.notifyActiveModelChanged).toHaveBeenCalledTimes(1);
	});

	it('保存新增档位后通知插件同步面板徽章', async () => {
		const settings = createSettings();
		const { plugin } = openModal(settings);

		const addRow = getSettingInstances().find(
			(instance) => instance.name === '新增模型接入口',
		);
		await addRow?.components.buttons[0]?.click?.();

		const type = (rowName: string, value: string): void => {
			getSettingInstances()
				.find((instance) => instance.name === rowName)
				?.components.texts[0]?.change?.(value);
		};
		type('名称', '云端备用');
		type('API 地址', 'https://api.example.com/v1');
		type('模型名称', 'gpt-4o-mini');

		const saveRow = getSettingInstances().find(
			(instance) => instance.name === '新增接入口',
		);
		await saveRow?.components.buttons
			.find((button) => button.text === '保存')
			?.click?.();
		await flush();

		expect(settings.models).toHaveLength(2);
		expect(plugin.notifyActiveModelChanged).toHaveBeenCalledTimes(1);
	});
});

describe('API 密钥显隐与表单重建（BUG 回归：重复配置项）', () => {
	it('点击小眼睛就地切换输入框类型与图标，不产生重复配置项', () => {
		const { contentEl } = openEditForm('本地 LM Studio');
		const rowsBefore = countSettingRows(contentEl);
		const keyRow = getSettingInstances().find(
			(instance) => instance.name === 'API 密钥',
		);
		const inputEl = keyRow?.components.texts[0]?.inputEl;
		const eyeButton = keyRow?.components.extraButtons[0];
		expect(inputEl?.attrs['type']).toBe('password');

		eyeButton?.click?.();

		// 不重建表单：渲染行数与“API 密钥”行实例数均不变
		expect(countSettingRows(contentEl)).toBe(rowsBefore);
		expect(
			getSettingInstances().filter(
				(instance) => instance.name === 'API 密钥',
			),
		).toHaveLength(1);
		expect(inputEl?.attrs['type']).toBe('text');
		expect(eyeButton?.icon).toBe('eye-off');

		eyeButton?.click?.();
		expect(inputEl?.attrs['type']).toBe('password');
		expect(eyeButton?.icon).toBe('eye');
	});

	it('代理覆盖切换为启用时重建为单份表单，仅新增一条代理地址配置', async () => {
		const { contentEl } = openEditForm('本地 LM Studio');
		const rowsBefore = countSettingRows(contentEl);
		const instanceSnapshot = getSettingInstances().length;

		const proxyRow = getSettingInstances().find(
			(instance) => instance.name === '代理覆盖',
		);
		await proxyRow?.components.dropdowns[0]?.change?.('on');

		// 重建后的表单只渲染一份：整体行数仅多出一条代理地址行
		expect(countSettingRows(contentEl)).toBe(rowsBefore + 1);
		// 本次重建新建的 Setting 实例中，名称与代理地址各只有一条
		const rebuilt = getSettingInstances().slice(instanceSnapshot);
		expect(
			rebuilt.filter((instance) => instance.name === '名称'),
		).toHaveLength(1);
		expect(
			rebuilt.filter((instance) => instance.name === '代理地址'),
		).toHaveLength(1);
	});
});
