import {
	App,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
} from 'obsidian';
import type EnPracticePlugin from './main';

/** 插件设置项 */
export interface EnPracticeSettings {
	/** OpenAI 兼容 API 的密钥（可选） */
	apiKey: string;
	/** OpenAI 兼容 API 的请求地址（必填），如 https://api.openai.com/v1 */
	baseUrl: string;
	/** 模型名称（必填），如 gpt-4o-mini */
	modelName: string;
	/** 模型输出解析失败时的最大自动重试次数（0-3） */
	retryCount: number;
	/** 调试模式：开启后显示 AI 请求调试面板 */
	debugMode: boolean;
	/** 是否启用流式输出 */
	streamingEnabled: boolean;
	/** 是否启用模型思考模式（DeepSeek 等推理模型） */
	thinkingEnabled: boolean;
	/** 单次请求生成内容的最大 token 数 */
	maxTokens: number;
	/** 是否启用 HTTP 代理（如 Clash 等本地代理） */
	proxyEnabled: boolean;
	/** HTTP 代理地址，如 http://127.0.0.1:7897 */
	proxyUrl: string;
}

export const DEFAULT_SETTINGS: EnPracticeSettings = {
	apiKey: '',
	baseUrl: '',
	modelName: '',
	retryCount: 1,
	debugMode: false,
	streamingEnabled: true,
	thinkingEnabled: false,
	maxTokens: 4096,
	proxyEnabled: false,
	proxyUrl: 'http://127.0.0.1:7897',
};

export class EnPracticeSettingTab extends PluginSettingTab {
	plugin: EnPracticePlugin;

	constructor(app: App, plugin: EnPracticePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 声明式设置定义：供 Obsidian 1.13+ 的设置搜索与渲染使用。
	 * 保留 display() 作为旧版本 Obsidian 的回退渲染。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'API 配置',
				items: [
					{
						name: 'API 密钥',
						desc: 'OpenAI 兼容 API 的密钥（必填，部分不需要 key 的服务随便填写即可）',
						control: {
							type: 'text',
							key: 'apiKey',
							placeholder: 'sk-...',
						},
					},
					{
						name: 'API 地址',
						desc: 'OpenAI 兼容格式的请求链接（必填），如 https://api.openai.com/v1',
						control: {
							type: 'text',
							key: 'baseUrl',
							placeholder: 'https://api.openai.com/v1',
						},
					},
					{
						name: '模型名称',
						desc: '使用的模型名称（必填），如 gpt-4o-mini',
						control: {
							type: 'text',
							key: 'modelName',
							placeholder: 'gpt-4o-mini',
						},
					},
					{
						name: '启用代理',
						desc: '通过本地 HTTP 代理访问海外 API（如 Clash Verge 混合端口 7897），桌面端生效。',
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
						},
					},
				],
			},
			{
				type: 'group',
				heading: '请求行为',
				items: [
					{
						name: '启用思考模式',
						desc: '开启后向 deepseek 等推理模型请求思考模式；思考模式不支持函数调用，且会消耗更多 token。',
						control: {
							type: 'toggle',
							key: 'thinkingEnabled',
						},
					},
					{
						name: '最长 token',
						desc: '单次请求生成内容的最大 token 数（256-32768），思考模式下建议调大。',
						control: {
							type: 'number',
							key: 'maxTokens',
							min: 256,
							max: 32768,
							step: 256,
							placeholder: '4096',
							defaultValue: 4096,
						},
					},
					{
						name: '解析重试次数',
						desc: '模型输出解析失败时的最大自动重试次数（0-3），默认 1。',
						control: {
							type: 'number',
							key: 'retryCount',
							min: 0,
							max: 3,
							step: 1,
							placeholder: '1',
							defaultValue: 1,
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
						desc: '开启后在翻译写作下方显示 AI 请求调试面板与请求日志。',
						control: {
							type: 'toggle',
							key: 'debugMode',
						},
					},
				],
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('API 配置').setHeading();

		new Setting(containerEl)
			.setName('API 密钥')
			.setDesc('OpenAI 兼容 API 的密钥（必填，部分不需要 key 的服务随便填写即可）')
			.addText((text) =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('API 地址')
			.setDesc('OpenAI 兼容格式的请求链接（必填），如 https://api.openai.com/v1')
			.addText((text) =>
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('模型名称')
			.setDesc('使用的模型名称（必填），如 gpt-4o-mini')
			.addText((text) =>
				text
					.setPlaceholder('gpt-4o-mini')
					.setValue(this.plugin.settings.modelName)
					.onChange(async (value) => {
						this.plugin.settings.modelName = value;
						await this.plugin.saveSettings();
					}),
			);

		const proxyUrlSetting = new Setting(containerEl)
			.setName('代理地址')
			.setDesc('代理地址，格式为 http://127.0.0.1:7897。')
			.addText((text) =>
				text
					.setPlaceholder('http://127.0.0.1:7897')
					.setValue(this.plugin.settings.proxyUrl)
					.onChange(async (value) => {
						this.plugin.settings.proxyUrl = value;
						await this.plugin.saveSettings();
					}),
			);
		const proxyUrlInput = proxyUrlSetting.controlEl.querySelector('input');

		new Setting(containerEl)
			.setName('启用代理')
			.setDesc('通过本地 HTTP 代理访问海外 API（如 Clash Verge 混合端口 7897），桌面端生效。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.proxyEnabled)
					.onChange(async (value) => {
						this.plugin.settings.proxyEnabled = value;
						await this.plugin.saveSettings();
						proxyUrlSetting.settingEl.toggleClass('is-disabled', !value);
						if (proxyUrlInput) {
							proxyUrlInput.disabled = !value;
						}
					}),
			);

		if (!this.plugin.settings.proxyEnabled) {
			proxyUrlSetting.settingEl.addClass('is-disabled');
			if (proxyUrlInput) {
				proxyUrlInput.disabled = true;
			}
		}

		new Setting(containerEl).setName('请求行为').setHeading();

		new Setting(containerEl)
			.setName('启用思考模式')
			.setDesc('开启后向 deepseek 等推理模型请求思考模式；思考模式不支持函数调用，且会消耗更多 token。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.thinkingEnabled)
					.onChange(async (value) => {
						this.plugin.settings.thinkingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('最长 token')
			.setDesc('单次请求生成内容的最大 token 数（256-32768），思考模式下建议调大。')
			.addText((text) => {
				text.inputEl.setAttr('type', 'number');
				text.inputEl.setAttr('min', '256');
				text.inputEl.setAttr('max', '32768');
				text.inputEl.setAttr('step', '256');
				text.setPlaceholder('4096');
				text.setValue(String(this.plugin.settings.maxTokens));
				text.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isNaN(parsed)) {
						return;
					}
					this.plugin.settings.maxTokens = Math.min(
						32768,
						Math.max(256, Math.floor(parsed)),
					);
					text.setValue(String(this.plugin.settings.maxTokens));
					await this.plugin.saveSettings();
				});
				return text;
			});

		new Setting(containerEl)
			.setName('解析重试次数')
			.setDesc('模型输出解析失败时的最大自动重试次数（0-3），默认 1。')
			.addText((text) => {
				text.inputEl.setAttr('type', 'number');
				text.inputEl.setAttr('min', '0');
				text.inputEl.setAttr('max', '3');
				text.inputEl.setAttr('step', '1');
				text
					.setPlaceholder('1')
					.setValue(String(this.plugin.settings.retryCount))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isNaN(parsed)) {
							return;
						}
						this.plugin.settings.retryCount = Math.min(
							3,
							Math.max(0, Math.floor(parsed)),
						);
						text.setValue(String(this.plugin.settings.retryCount));
						await this.plugin.saveSettings();
					});
				return text;
			});

		new Setting(containerEl)
			.setName('启用流式输出')
			.setDesc('关闭后改为非流式请求，便于排查流式相关问题。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.streamingEnabled)
					.onChange(async (value) => {
						this.plugin.settings.streamingEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('调试').setHeading();

		new Setting(containerEl)
			.setName('调试模式')
			.setDesc('开启后在翻译写作下方显示 AI 请求调试面板与请求日志。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
