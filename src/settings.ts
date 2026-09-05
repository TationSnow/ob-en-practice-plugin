import {
	App,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
} from 'obsidian';
import type EnPracticePlugin from './main';
import type { ModelProfile } from './settings/models';
import { openModelManager } from './ui/model-modal';

/** 插件设置项 */
export interface EnPracticeSettings {
	/** 模型接入口列表（增删改查见设置页“管理模型接入口”） */
	models: ModelProfile[];
	/** 当前激活的模型接入口 id；为空表示未选择 */
	activeModelId: string;
	/** @deprecated 旧版单模型配置字段，仅在升级迁移与无档位回退时读取 */
	apiKey?: string;
	/** @deprecated 旧版单模型配置字段，仅在升级迁移与无档位回退时读取 */
	baseUrl?: string;
	/** @deprecated 旧版单模型配置字段，仅在升级迁移与无档位回退时读取 */
	modelName?: string;
	/** 调试模式：开启后显示 AI 请求调试面板 */
	debugMode: boolean;
	/** 是否启用流式输出 */
	streamingEnabled: boolean;
	/** 单次请求生成内容的最大 token 数 */
	maxTokens: number;
	/** 是否启用 HTTP 代理（如 Clash 等本地代理）；模型档位可覆盖 */
	proxyEnabled: boolean;
	/** HTTP 代理地址，如 http://127.0.0.1:7897；模型档位可覆盖 */
	proxyUrl: string;
	/** 翻译写作的自定义主题列表，首项“随机”为固定内置选项 */
	writingThemes: string[];
}

export const DEFAULT_SETTINGS: EnPracticeSettings = {
	models: [],
	activeModelId: '',
	debugMode: false,
	streamingEnabled: true,
	maxTokens: 4096,
	proxyEnabled: false,
	proxyUrl: 'http://127.0.0.1:7897',
	writingThemes: [],
};

/**
 * 插件设置页。
 * getSettingDefinitions() 是设置项的唯一事实来源：
 * - Obsidian 1.13+ 由框架按声明式定义渲染并纳入设置搜索，
 *   通过本类的 getControlValue/setControlValue 读写插件设置；
 * - 旧版本由 display() 按同一份定义手工渲染，避免设置项双份维护。
 */
export class EnPracticeSettingTab extends PluginSettingTab {
	plugin: EnPracticePlugin;

	/** 旧版渲染中需要随设置变化刷新禁用状态的控件（如代理地址依赖启用代理开关） */
	private readonly disabledUpdaters: (() => void)[] = [];

	constructor(app: App, plugin: EnPracticePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 声明式设置定义，供 Obsidian 1.13+ 渲染与设置搜索使用。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		// 下拉选项：档位 id → 显示名；方法每次渲染都会被调用，
		// 因此增删改档位后无需缓存失效处理
		const options = Object.fromEntries(
			this.plugin.settings.models.map((profile) => [profile.id, profile.name]),
		);
		return [
			{
				type: 'group',
				heading: '模型接入口',
				items: [
					{
						name: '当前模型',
						desc: '选择用于 AI 请求的模型接入口，支持云端与本地模型。',
						control: {
							type: 'dropdown',
							key: 'activeModelId',
							options,
						},
					},
					{
						name: '管理模型接入口',
						desc: '添加、编辑或删除模型接入口，可为每个后端单独配置代理与输出上限。',
						action: () => {
							openModelManager(this.plugin, () =>
								this.refreshModelEntries(),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: '网络代理',
				items: [
					{
						name: '启用代理',
						desc: '通过本地 HTTP 代理访问海外 API（如 Clash Verge 混合端口 7897），桌面端生效；可在模型接入口中按档位覆盖。',
						control: {
							type: 'toggle',
							key: 'proxyEnabled',
						},
					},
					{
						name: '代理地址',
						desc: '代理地址，格式为 http://127.0.0.1:7897。',
						control: {
							type: 'text',
							key: 'proxyUrl',
							placeholder: 'http://127.0.0.1:7897',
							// 代理地址仅在启用代理后可编辑
							disabled: () => !this.plugin.settings.proxyEnabled,
						},
					},
				],
			},
			{
				type: 'group',
				heading: '请求行为',
				items: [
					{
						name: '最长 token',
						desc: '单次请求生成内容的最大 token 数（256-51200）。',
						control: {
							type: 'number',
							key: 'maxTokens',
							min: 256,
							max: 51200,
							step: 256,
							placeholder: '4096',
							defaultValue: 4096,
						},
					},
					{
						name: '启用流式输出',
						desc: '关闭后改为非流式请求，便于排查流式相关问题。',
						control: {
							type: 'toggle',
							key: 'streamingEnabled',
						},
					},
				],
			},
			{
				type: 'group',
				heading: '调试',
				items: [
					{
						name: '调试模式',
						desc: '开启后在面板页签栏中显示调试页签与 AI 请求日志。',
						control: {
							type: 'toggle',
							key: 'debugMode',
						},
					},
				],
			},
		];
	}

	/**
	 * 模型档位增删改后刷新设置页中的“当前模型”下拉。
	 * 1.13+ 声明式框架调用官方 update() 重新求值定义；
	 * 旧版本回退到整页重绘。
	 */
	refreshModelEntries(): void {
		const declarative = this as unknown as { update?: () => void };
		if (typeof declarative.update === 'function') {
			declarative.update();
			return;
		}
		// 旧版回退渲染；经结构化转型调用，避免直接引用父类已标注废弃的方法符号
		(this as unknown as { display(): void }).display();
	}

	/**
	 * 读取控件对应的设置值（1.13+ 声明式框架的官方读写钩子）。
	 * @param key 设置键
	 * @returns 当前设置值
	 */
	getControlValue(key: string): unknown {
		const record = this.plugin.settings as unknown as Record<string, unknown>;
		return record[key];
	}

	/**
	 * 写入控件对应的设置值并保存（1.13+ 声明式框架的官方读写钩子）。
	 * @param key 设置键
	 * @param value 新值
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const record = this.plugin.settings as unknown as Record<string, unknown>;
		record[key] = value;
		await this.plugin.saveSettings();
		this.refreshControlState();
	}

	/**
	 * 旧版 Obsidian（<1.13）的回退渲染：遍历声明式定义逐组绘制，
	 * 与 1.13+ 的声明式渲染保持同一份设置项来源。
	 * 父类已在 1.13 将 display 标注为废弃，此处是面向旧版本的刻意保留；
	 * 1.13+ 环境下框架改用 getSettingDefinitions()，本方法不会被调用。
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.disabledUpdaters.length = 0;

		for (const group of this.getSettingDefinitions()) {
			if (!('items' in group) || !group.items) {
				continue;
			}
			const heading = 'heading' in group ? group.heading : undefined;
			if (!heading) {
				continue;
			}
			new Setting(containerEl).setName(heading).setHeading();
			for (const item of group.items) {
				this.renderDefinitionItem(containerEl, item);
			}
		}
		this.refreshControlState();
	}

	/**
	 * 把单条设置定义渲染为 Setting 行（旧版回退渲染用）。
	 * 通过 “control”/“action” 属性探测过滤掉分组/页面节点，仅渲染可交互项。
	 * @param containerEl 容器
	 * @param item 设置定义项
	 */
	private renderDefinitionItem(
		containerEl: HTMLElement,
		item: SettingDefinitionItem,
	): void {
		// 动作行（如“管理模型接入口”）：整行说明 + 操作按钮
		if ('action' in item && typeof item.action === 'function') {
			new Setting(containerEl)
				.setName(item.name)
				.setDesc(item.desc ?? '')
				.addButton((button) =>
					button.setButtonText('管理…').onClick(() => {
						item.action(containerEl, -1);
					}),
				);
			return;
		}
		if (!('control' in item) || !item.control) {
			return;
		}
		const control = item.control;
		const setting = new Setting(containerEl)
			.setName(item.name)
			.setDesc(item.desc ?? '');

		if (control.type === 'text') {
			setting.addText((text) =>
				text
					.setPlaceholder(control.placeholder ?? '')
					.setValue(String(this.readControlValue(control.key, '')))
					.onChange(async (value) => {
						await this.setControlValue(control.key, value);
					}),
			);
		} else if (control.type === 'toggle') {
			setting.addToggle((toggle) =>
				toggle
					.setValue(Boolean(this.readControlValue(control.key, false)))
					.onChange(async (value) => {
						await this.setControlValue(control.key, value);
					}),
			);
		} else if (control.type === 'dropdown') {
			this.renderDropdownControl(setting, control);
		} else if (control.type === 'number') {
			this.renderNumberControl(setting, control);
		}

		// 控件可声明禁用条件（如代理地址依赖启用代理开关），渲染时求值并登记刷新器
		const disabledOption = control.disabled;
		if (disabledOption !== undefined) {
			const applyDisabled = (): void => {
				const disabled =
					typeof disabledOption === 'function'
						? disabledOption()
						: disabledOption;
				setting.setDisabled(disabled);
			};
			this.disabledUpdaters.push(applyDisabled);
		}
	}

	/**
	 * 渲染下拉控件（如“当前模型”接入口选择）。
	 * @param setting 所在 Setting 行
	 * @param control 下拉控件定义
	 */
	private renderDropdownControl(
		setting: Setting,
		control: { key: string; options: Record<string, string> },
	): void {
		setting.addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(control.options)) {
				dropdown.addOption(value, label);
			}
			dropdown.setValue(String(this.readControlValue(control.key, '')));
			dropdown.onChange(async (value) => {
				await this.setControlValue(control.key, value);
			});
			return dropdown;
		});
	}

	/**
	 * 渲染数字控件：用数字输入框配合 min/max 钳制，
	 * 非法输入不落库，越界输入自动收敛到合法区间。
	 * @param setting 所在 Setting 行
	 * @param control 数字控件定义
	 */
	private renderNumberControl(
		setting: Setting,
		control: {
			key: string;
			placeholder?: string;
			min?: number;
			max?: number;
			step?: number | 'any';
			defaultValue?: number;
		},
	): void {
		setting.addText((text) => {
			text.inputEl.setAttr('type', 'number');
			if (control.min !== undefined) {
				text.inputEl.setAttr('min', String(control.min));
			}
			if (control.max !== undefined) {
				text.inputEl.setAttr('max', String(control.max));
			}
			if (control.step !== undefined) {
				text.inputEl.setAttr('step', String(control.step));
			}
			text.setPlaceholder(control.placeholder ?? '');
			text.setValue(
				String(this.readControlValue(control.key, control.defaultValue ?? 0)),
			);
			text.onChange(async (value) => {
				const parsed = Number.parseInt(value, 10);
				if (Number.isNaN(parsed)) {
					return;
				}
				let clamped = parsed;
				if (control.min !== undefined) {
					clamped = Math.max(control.min, clamped);
				}
				if (control.max !== undefined) {
					clamped = Math.min(control.max, clamped);
				}
				text.setValue(String(clamped));
				await this.setControlValue(control.key, clamped);
			});
			return text;
		});
	}

	/**
	 * 读取控件对应的设置值，值缺失时回退到指定默认值（旧版渲染用）。
	 * @param key 设置键
	 * @param fallback 值缺失时的回退
	 * @returns 当前设置值
	 */
	private readControlValue(key: string, fallback: unknown): unknown {
		const value = this.getControlValue(key);
		return value === undefined || value === null ? fallback : value;
	}

	/**
	 * 刷新依赖型控件的禁用状态。
	 * 旧版渲染走登记的刷新器；1.13+ 声明式框架调用官方 refreshDomState()。
	 */
	private refreshControlState(): void {
		for (const updater of this.disabledUpdaters) {
			updater();
		}
		// refreshDomState 仅存在于 Obsidian 1.13+（minAppVersion 为 1.7.2），
		// 运行时探测后调用，旧版本自动跳过
		const declarative = this as unknown as {
			refreshDomState?: () => void;
		};
		declarative.refreshDomState?.();
	}
}
