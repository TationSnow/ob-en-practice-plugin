import { App, PluginSettingTab, Setting } from 'obsidian';
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
};

export class EnPracticeSettingTab extends PluginSettingTab {
	plugin: EnPracticePlugin;

	constructor(app: App, plugin: EnPracticePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API 密钥')
			.setDesc('OpenAI 兼容 API 的密钥（必填，部分不需要KEY的服务随便填写即可）')
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

		new Setting(containerEl)
			.setName('调试模式')
			.setDesc('开启后在翻译写作下方显示 AI 请求调试面板与流式输出日志。')
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
