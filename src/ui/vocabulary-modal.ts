/**
 * 生词本管理弹窗与顶栏入口按钮。
 *
 * - 入口：面板头部「生词本」按钮，位于模型下拉右侧、管理模型接入口左侧
 *   （挂载点由 english-practice-view 通过 model-controls 的插槽回调提供）；
 * - 弹窗：搜索过滤 + 词条列表（最新收录在前）+ 行内编辑 + 删除 + 底部添加表单，
 *   满足生词本的增删改查；
 * - 数据：全部变更走全局装配的 VocabularyBookService（持久化、Notice 提示
 *   与变更广播由服务统一负责），弹窗只在变更成功后重渲染列表；
 * - 快照：添加单词时查询本地词典，精确命中则连同音标/释义一并收录，
 *   未收录的生词仍可仅存单词（用户可在备注中补充自定义含义）。
 */
import { Modal, Notice, Setting } from 'obsidian';
import type EnPracticePlugin from '../main';
import { searchDictionary } from '../dictionary/dictionary-data';
import { filterVocabularyEntries } from '../vocabulary/book';
import { getVocabularyService } from '../vocabulary/service';
import type { VocabularyEntry } from '../vocabulary/types';
import { createIconButton } from './controls';

/** 释义摘要的截断长度（过长的多组释义折叠展示） */
const MEANING_MAX_LENGTH = 40;

/**
 * 打开生词本管理弹窗。
 * @param plugin 插件实例（提供应用上下文）
 * @returns 弹窗实例（测试可据断言标题与内容）
 */
export function openVocabularyManager(plugin: EnPracticePlugin): Modal {
	const modal = new VocabularyManagerModal(plugin.app);
	modal.open();
	return modal;
}

/**
 * 创建面板头部的「生词本」入口按钮。
 * @param container 父容器（面板头部）
 * @param plugin 插件实例
 * @returns 按钮元素
 */
export function createVocabularyBookButton(
	container: HTMLElement,
	plugin: EnPracticePlugin,
): HTMLButtonElement {
	return createIconButton(container, 'book-marked', '打开生词本', () => {
		openVocabularyManager(plugin);
	});
}

/** 生词本管理弹窗：词条的增删改查 */
class VocabularyManagerModal extends Modal {
	/** 当前搜索词（空串表示不过滤） */
	private searchText = '';

	onOpen(): void {
		this.titleEl.setText('生词本');
		this.render();
	}

	/** 渲染搜索框、词条列表与添加表单 */
	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		this.renderSearchBar(contentEl);
		this.renderList(contentEl);
		this.renderAddForm(contentEl);
	}

	/** 渲染搜索框（输入即过滤，同时展示词条总数） */
	private renderSearchBar(container: HTMLElement): void {
		const service = getVocabularyService();
		const bar = container.createDiv('en-vocab-search-bar');
		const input = bar.createEl('input', {
			attr: {
				type: 'text',
				'aria-label': '搜索生词',
				placeholder: '搜索单词、备注或释义…',
			},
		});
		input.addClass('en-text-input');
		input.addClass('en-vocab-search');
		input.value = this.searchText;
		input.addEventListener('input', () => {
			this.searchText = input.value;
			// 只重渲染列表区，保留搜索框焦点
			this.rerenderList();
		});
		bar
			.createSpan('en-vocab-count')
			.setText(`共 ${service.list().length} 词`);
	}

	/** 列表区容器（搜索输入时局部重建） */
	private listContainer: HTMLElement | null = null;

	/** 重渲染列表区（不动搜索框与添加表单） */
	private rerenderList(): void {
		this.listContainer?.empty();
		if (this.listContainer) {
			this.renderEntries(this.listContainer);
		}
	}

	/** 渲染词条列表区（含空状态） */
	private renderList(container: HTMLElement): void {
		this.listContainer = container.createDiv('en-vocab-list');
		this.renderEntries(this.listContainer);
	}

	/** 渲染（过滤后的）词条行或空状态 */
	private renderEntries(list: HTMLElement): void {
		const service = getVocabularyService();
		const entries = filterVocabularyEntries(service.list(), this.searchText);
		if (entries.length === 0) {
			list.createEl('p', {
				text: this.searchText
					? '没有匹配的生词，换个关键词试试。'
					: '暂无生词。写作查词、语法分析的词卡或下方均可添加。',
			}).addClass('en-vocab-empty');
			return;
		}
		for (const entry of entries) {
			this.renderEntryRow(list, entry);
		}
	}

	/** 渲染单个词条行：展示态（信息 + 编辑/删除）或编辑态（输入框 + 保存/取消） */
	private renderEntryRow(list: HTMLElement, entry: VocabularyEntry): void {
		const row = list.createDiv('en-vocab-row');
		row.setAttr('data-entry-id', entry.id);

		const info = row.createDiv('en-vocab-info');
		const head = info.createDiv('en-vocab-head');
		head.createSpan('en-vocab-word').setText(entry.word);
		if (entry.phonetic) {
			head.createSpan('en-vocab-phonetic').setText(`/${entry.phonetic}/`);
		}
		head.createSpan('en-vocab-date').setText(formatEntryDate(entry.addedAt));

		const meaning = resolveMeaningText(entry);
		if (meaning) {
			info.createDiv('en-vocab-meaning').setText(meaning);
		}

		const actions = row.createDiv('en-vocab-actions');
		createIconButton(actions, 'pencil', `编辑：${entry.word}`, () => {
			this.renderEditRow(row, entry);
		});
		createIconButton(actions, 'trash-2', `删除：${entry.word}`, () => {
			void this.deleteEntry(entry);
		});
	}

	/**
	 * 把词条行切换为编辑态：单词与备注输入框 + 保存/取消。
	 * 就地重建该行，其余行不受影响。
	 */
	private renderEditRow(row: HTMLElement, entry: VocabularyEntry): void {
		row.empty();
		const fields = row.createDiv('en-vocab-edit-fields');
		const wordInput = fields.createEl('input', {
			attr: {
				type: 'text',
				'aria-label': '编辑单词',
				value: entry.word,
			},
		});
		wordInput.addClass('en-text-input');
		const noteInput = fields.createEl('input', {
			attr: {
				type: 'text',
				'aria-label': '编辑备注',
				value: entry.note ?? '',
				placeholder: '备注 / 自定义含义（可选）',
			},
		});
		noteInput.addClass('en-text-input');

		const actions = row.createDiv('en-vocab-actions');
		// 保存/取消按钮的 aria-label 携带原单词，便于同屏多行编辑时定位
		createIconButton(actions, 'check', `保存：${entry.word}`, () => {
			void this.saveEntry(entry, wordInput.value, noteInput.value);
		});
		createIconButton(actions, 'x', `取消：${entry.word}`, () => {
			this.render();
		});
		// 显式同步 value 属性与特性（attribute 仅作初始默认值语义）
		wordInput.value = entry.word;
		noteInput.value = entry.note ?? '';
		// 单词输入框聚焦，便于直接修改
		wordInput.focus();
	}

	/** 保存编辑：成功后重渲染（含提示与广播，由服务负责） */
	private async saveEntry(
		entry: VocabularyEntry,
		word: string,
		note: string,
	): Promise<void> {
		const result = await getVocabularyService().update(entry.id, {
			word,
			note,
		});
		if (result.changed) {
			this.render();
		}
	}

	/** 删除词条：成功后重渲染 */
	private async deleteEntry(entry: VocabularyEntry): Promise<void> {
		const result = await getVocabularyService().remove(entry.word);
		if (result.changed) {
			this.render();
		}
	}

	/** 渲染底部添加表单：单词（回车可提交）+ 添加按钮 */
	private renderAddForm(container: HTMLElement): void {
		let wordInput: { getValue(): string } | null = null;
		new Setting(container)
			.setName('添加生词')
			.setDesc('输入英文单词，自动匹配词典释义；查不到时仅收录单词本身。')
			.addText((text) => {
				wordInput = text;
				text.setPlaceholder('输入英文单词，如 improve');
			})
			.addButton((button) =>
				button.setButtonText('添加').setCta().onClick(async () => {
					await this.addEntry(wordInput?.getValue() ?? '');
				}),
			);
	}

	/** 收录单词：查询本地词典精确命中补快照后走服务入库 */
	private async addEntry(rawWord: string): Promise<void> {
		const word = rawWord.trim();
		if (!word) {
			new Notice('请输入要收录的单词');
			return;
		}
		// 本地词典内存查询（同步、确定性），精确命中携带音标与释义快照
		const matches = searchDictionary(word, { limit: 1 });
		const exact = matches.find((match) => match.matchType === 0);
		const result = await getVocabularyService().add(
			exact
				? {
						word,
						phonetic: exact.phonetic,
						senses: exact.senses,
					}
				: { word },
		);
		if (result.changed) {
			this.render();
		}
	}
}

/**
 * 格式化收录日期（YYYY-MM-DD，本地时区）。
 * 手动拼接保证跨环境下格式确定（toLocaleDateString 的输出随运行环境变化）。
 * @param addedAt 收录时间戳
 */
function formatEntryDate(addedAt: number): string {
	const date = new Date(addedAt);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 解析词条的展示摘要：释义优先，备注兜底，超长截断。
 * @param entry 词条
 */
function resolveMeaningText(entry: VocabularyEntry): string {
	const meaning = entry.senses
		.map((sense) => sense.z.trim())
		.filter((text) => text !== '')
		.join('；');
	const text = meaning || entry.note?.trim() || '';
	return text.length > MEANING_MAX_LENGTH
		? `${text.slice(0, MEANING_MAX_LENGTH)}…`
		: text;
}
