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
}

export const DEFAULT_SETTINGS: EnPracticeSettings = {
	apiKey: '',
	baseUrl: '',
	modelName: '',
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
	}
}
