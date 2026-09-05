import { Modal, Notice, Setting } from 'obsidian';
import type EnPracticePlugin from '../main';
import {
	applyAddModelProfile,
	applyRemoveModelProfile,
	applySetActiveModelProfile,
	applyUpdateModelProfile,
	getActiveModelProfile,
	normalizeModelProfileDraft,
	STRUCTURED_OUTPUT_MODE_OPTIONS,
	type ModelProfile,
	type ModelProfileDraft,
	type StructuredOutputMode,
} from '../settings/models';
import { testModelConnection } from '../ai/connection-test';
import { createIconButton } from './controls';
import { createTag } from './sections';

/**
 * 打开模型接入口管理弹窗。
 * @param plugin 插件实例
 * @param onChange 档位列表变化后的回调（用于刷新设置页下拉/面板快速切换）
 * @returns 弹窗实例（便于测试与宿主持有）
 */
export function openModelManager(
	plugin: EnPracticePlugin,
	onChange: () => void,
): Modal {
	const modal = new ModelManagerModal(plugin, onChange);
	modal.open();
	return modal;
}

/** 代理覆盖下拉的三态取值（inherit = 跟随全局） */
type ProxyMode = 'inherit' | 'on' | 'off';

/** 代理覆盖三态的下拉文案 */
const PROXY_MODE_OPTIONS: Record<ProxyMode, string> = {
	inherit: '跟随全局设置',
	on: '启用代理',
	off: '直连（不走代理）',
};

/** 由档位的覆盖值反推代理三态 */
function proxyModeOf(draft: ModelProfileDraft): ProxyMode {
	if (draft.proxyEnabled === undefined) return 'inherit';
	return draft.proxyEnabled ? 'on' : 'off';
}

/**
 * 模型接入口管理弹窗：支持档位的增、删、改、设为当前、连接测试。
 * 持久化采用 saveData + onChange 回调（与主题管理弹窗一致），
 * 避免整页重渲染，由宿主决定刷新粒度。
 */
class ModelManagerModal extends Modal {
	private plugin: EnPracticePlugin;
	private onChange: () => void;

	/** 当前编辑的档位 id：null = 列表视图；'' = 新增；其他 = 编辑该档位 */
	private editingId: string | null = null;
	/** 表单草稿（随输入实时更新，保存/测试连接时消费） */
	private draft: ModelProfileDraft = ModelManagerModal.emptyDraft();
	/** API 密钥是否明文显示 */
	private keyVisible = false;

	constructor(plugin: EnPracticePlugin, onChange: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.onChange = onChange;
	}

	onOpen(): void {
		this.titleEl.setText('管理模型接入口');
		this.render();
	}

	/** 空白草稿（新增档位的初始值） */
	private static emptyDraft(): ModelProfileDraft {
		return {
			name: '',
			protocol: 'openai-compatible',
			baseUrl: '',
			apiKey: '',
			modelName: '',
			structuredOutput: 'auto',
		};
	}

	/** 渲染当前视图（列表或表单） */
	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (this.editingId === null) {
			this.renderList();
		} else {
			this.renderForm();
		}
	}

	/** 渲染档位列表与新增入口 */
	private renderList(): void {
		const { contentEl } = this;
		const list = contentEl.createDiv('en-model-list');
		const profiles = this.plugin.settings.models ?? [];

		if (profiles.length === 0) {
			list
				.createEl('p', { text: '暂无模型接入口，请在下方添加。' })
				.addClass('en-model-empty');
		}
		for (const profile of profiles) {
			this.renderProfileRow(list, profile);
		}

		new Setting(contentEl)
			.setName('新增模型接入口')
			.setDesc('添加云端模型或本地模型（如 LM Studio / Ollama）。')
			.addButton((button) =>
				button.setButtonText('新增').setCta().onClick(() => {
					this.editingId = '';
					this.draft = ModelManagerModal.emptyDraft();
					this.keyVisible = false;
					this.render();
				}),
			);
	}

	/** 渲染单个档位行：信息摘要 + 设为当前 / 编辑 / 删除 */
	private renderProfileRow(list: HTMLElement, profile: ModelProfile): void {
		const row = list.createDiv('en-model-row');
		const info = row.createDiv('en-model-row-info');
		const nameRow = info.createDiv('en-model-row-name');
		nameRow.createSpan({ text: profile.name });
		if (getActiveModelProfile(this.plugin.settings)?.id === profile.id) {
			createTag(nameRow, '当前', 'accent');
		}
		info
			.createDiv('en-model-row-meta')
			.setText(`${profile.modelName} · ${profile.baseUrl}`);

		const actions = row.createDiv('en-model-row-actions');
		if (getActiveModelProfile(this.plugin.settings)?.id !== profile.id) {
			createIconButton(actions, 'check', `设为当前：${profile.name}`, () => {
				void this.setActive(profile);
			});
		}
		createIconButton(actions, 'pencil', `编辑：${profile.name}`, () => {
			this.editingId = profile.id;
			this.draft = {
				name: profile.name,
				protocol: profile.protocol,
				baseUrl: profile.baseUrl,
				apiKey: profile.apiKey,
				modelName: profile.modelName,
				structuredOutput: profile.structuredOutput,
				proxyEnabled: profile.proxyEnabled,
				proxyUrl: profile.proxyUrl,
				maxTokens: profile.maxTokens,
			};
			this.keyVisible = false;
			this.render();
		});
		createIconButton(actions, 'trash-2', `删除：${profile.name}`, () => {
			void this.remove(profile);
		});
	}

	/** 渲染新增/编辑表单 */
	private renderForm(): void {
		const { contentEl } = this;
		// 就地重建表单（如切换代理覆盖后补显代理地址行）前必须清空容器，
		// 防止在旧表单下方追加出重复的配置项
		contentEl.empty();
		const isEditing = this.editingId !== '';

		new Setting(contentEl)
			.setName('名称')
			.setDesc('接入口的显示名，需唯一。')
			.addText((text) =>
				text
					.setPlaceholder('如 本地 LM Studio')
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					}),
			);

		// 当前版本仅支持 OpenAI 兼容协议；Anthropic 等协议为未来预留
		new Setting(contentEl)
			.setName('协议')
			.setDesc('openai-compatible（OpenAI 兼容协议），其他协议为未来预留。');

		new Setting(contentEl)
			.setName('API 地址')
			.setDesc('如 https://api.openai.com/v1 或 http://127.0.0.1:1234/v1')
			.addText((text) =>
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.draft.baseUrl)
					.onChange((value) => {
						this.draft.baseUrl = value;
					}),
			);

		// 密钥输入框引用：显隐切换时就地修改类型，不重建表单
		let apiKeyInputEl: HTMLElement | undefined;
		new Setting(contentEl)
			.setName('API 密钥')
			.setDesc('本地服务通常无需填写。')
			.addText((text) => {
				text.inputEl.setAttr('type', this.keyVisible ? 'text' : 'password');
				apiKeyInputEl = text.inputEl;
				text.setPlaceholder('sk-...')
					.setValue(this.draft.apiKey)
					.onChange((value) => {
						this.draft.apiKey = value;
					});
				return text;
			})
			.addExtraButton((button) =>
				button
					.setIcon(this.keyVisible ? 'eye-off' : 'eye')
					.setTooltip(this.keyVisible ? '隐藏密钥' : '显示密钥')
					.onClick(() => {
						this.keyVisible = !this.keyVisible;
						// 仅切换输入框类型与图标，不重建表单——
						// 重建会清空未落草稿的输入焦点并在旧表单下方产生重复配置项
						apiKeyInputEl?.setAttr(
							'type',
							this.keyVisible ? 'text' : 'password',
						);
						button.setIcon(this.keyVisible ? 'eye-off' : 'eye');
					}),
			);

		new Setting(contentEl)
			.setName('模型名称')
			.setDesc('如 gpt-4o-mini 或 qwen3.8-9b')
			.addText((text) =>
				text
					.setPlaceholder('gpt-4o-mini')
					.setValue(this.draft.modelName)
					.onChange((value) => {
						this.draft.modelName = value;
					}),
			);

		new Setting(contentEl)
			.setName('结构化输出模式')
			.setDesc(
				'auto 会在接口拒绝时自动降级并记住结论；本地模型通常可用 json_schema。',
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					STRUCTURED_OUTPUT_MODE_OPTIONS,
				)) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.draft.structuredOutput ?? 'auto')
					.onChange((value) => {
						this.draft.structuredOutput = value as StructuredOutputMode;
					});
				return dropdown;
			});

		new Setting(contentEl)
			.setName('代理覆盖')
			.setDesc('云端走代理、本地直连；切换接入口时无需再改动全局代理。')
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(PROXY_MODE_OPTIONS)) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(proxyModeOf(this.draft))
					.onChange((value) => {
						const mode = value as ProxyMode;
						this.draft.proxyEnabled =
							mode === 'inherit' ? undefined : mode === 'on';
						// 启用代理时展示代理地址输入行
						this.renderForm();
					});
				return dropdown;
			});

		if (this.draft.proxyEnabled === true) {
			new Setting(contentEl)
				.setName('代理地址')
				.setDesc('留空则使用全局代理地址。')
				.addText((text) =>
					text
						.setPlaceholder('http://127.0.0.1:7897')
						.setValue(this.draft.proxyUrl ?? '')
						.onChange((value) => {
							this.draft.proxyUrl = value;
						}),
				);
		}

		new Setting(contentEl)
			.setName('最长 token 覆盖')
			.setDesc(
				`留空则跟随全局（${this.plugin.settings.maxTokens}）。本地小模型可适当调低。`,
			)
			.addText((text) =>
				text
					.setPlaceholder('留空则跟随全局')
					.setValue(
						this.draft.maxTokens === undefined
							? ''
							: String(this.draft.maxTokens),
					)
					.onChange((value) => {
						if (value.trim() === '') {
							delete this.draft.maxTokens;
							return;
						}
						const parsed = Number.parseInt(value, 10);
						this.draft.maxTokens = Number.isNaN(parsed) ? undefined : parsed;
					}),
			);

		new Setting(contentEl).setName(isEditing ? '编辑接入口' : '新增接入口')
			.addButton((button) =>
				button.setButtonText('测试连接').onClick(() => {
					void this.testConnection();
				}),
			)
			.addButton((button) =>
				button.setButtonText('取消').onClick(() => {
					this.editingId = null;
					this.render();
				}),
			)
			.addButton((button) =>
				button.setButtonText('保存').setCta().onClick(() => {
					void this.save();
				}),
			);
	}

	/** 由当前草稿构造档位（用于连接测试；id 不参与请求字段） */
	private draftAsProfile(): ModelProfile {
		return {
			id: this.editingId || 'draft',
			...normalizeModelProfileDraft(this.draft),
		};
	}

	/** 测试当前草稿的连通性；auto 模式顺带完成结构化输出能力探测 */
	private async testConnection(): Promise<void> {
		const result = await testModelConnection(
			this.draftAsProfile(),
			this.plugin.settings,
		);
		if (result.ok) {
			new Notice(
				`连接成功（${result.latencyMs}ms，结构化输出：${result.detectedMode ?? '未知'}）`,
			);
			return;
		}
		new Notice(result.message);
	}

	/** 保存表单（新增或编辑），失败时以 Notice 提示首个问题 */
	private async save(): Promise<void> {
		if (this.editingId === '') {
			const issues = applyAddModelProfile(this.plugin.settings, this.draft);
			if (issues.length > 0) {
				new Notice(issues[0] ?? '校验失败');
				return;
			}
		} else if (this.editingId !== null) {
			const issues = applyUpdateModelProfile(
				this.plugin.settings,
				this.editingId,
				this.draft,
			);
			if (issues.length > 0) {
				new Notice(issues[0] ?? '校验失败');
				return;
			}
		}
		await this.persist();
		this.editingId = null;
		this.render();
	}

	/** 设为当前档位 */
	private async setActive(profile: ModelProfile): Promise<void> {
		const issues = applySetActiveModelProfile(this.plugin.settings, profile.id);
		if (issues.length > 0) {
			new Notice(issues[0] ?? '操作失败');
			return;
		}
		await this.persist();
		new Notice(`已切换至 ${profile.name}`);
		this.render();
	}

	/** 删除档位（最后一个档位受保护） */
	private async remove(profile: ModelProfile): Promise<void> {
		const issues = applyRemoveModelProfile(this.plugin.settings, profile.id);
		if (issues.length > 0) {
			new Notice(issues[0] ?? '操作失败');
			return;
		}
		await this.persist();
		this.render();
	}

	/**
	 * 持久化档位变更并通知宿主刷新。
	 * 直接保存插件数据而非 saveSettings()，避免面板整页重渲染；
	 * 由 onChange 回调决定设置页/面板下拉的刷新粒度，
	 * 并通过 notifyActiveModelChanged 让面板同步连接徽章
	 * （激活档位可能因设为当前/新增首个/删除激活档位而变化）。
	 */
	private async persist(): Promise<void> {
		await this.plugin.saveData(this.plugin.settings);
		this.onChange();
		this.plugin.notifyActiveModelChanged();
	}
}
