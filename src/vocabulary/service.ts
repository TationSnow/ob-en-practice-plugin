/**
 * 生词本服务层：封装词条的增删改查、持久化与变更广播。
 *
 * - 持久化：直接写 plugin.settings.vocabulary 后调用 plugin.saveData
 *   （局部保存模式，与主题/模型管理一致，不整页重渲染面板、不清空用户输入）；
 * - 提示：成功与失败原因在此层统一发 Notice（tts.ts 有服务层提示的先例），
 *   UI 层只负责根据变更刷新自身，不重复提示；
 * - 广播：观察者模式，词卡、查词面板、写作选词区等订阅后自行同步状态；
 * - 装配：plugin.onload 时通过 setVocabularyService 装配唯一实例，
 *   深层 UI（如悬浮词卡）通过 getVocabularyService 获取；测试可注入桩。
 */
import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import {
	addVocabularyEntry,
	findVocabularyEntry,
	hasVocabularyEntry,
	normalizeVocabWord,
	removeVocabularyEntry,
	sortVocabularyEntries,
	updateVocabularyEntry,
} from './book';
import type {
	VocabularyEntry,
	VocabularyEntryDraft,
	VocabularyEntryPatch,
} from './types';

/** 生词本变更类型 */
export type VocabularyChangeType = 'add' | 'remove' | 'update';

/** 生词本变更事件载荷 */
export interface VocabularyChangeDetail {
	/** 变更类型 */
	type: VocabularyChangeType;
	/** 受影响单词（收录/编辑后的词，或被移除的词，已归一化） */
	word: string;
}

/** 变更监听器 */
export type VocabularyChangeListener = (detail: VocabularyChangeDetail) => void;

/** 服务操作结果（changed 为 false 时 UI 无需刷新） */
export interface VocabularyServiceResult {
	changed: boolean;
	entry?: VocabularyEntry;
}

/** 生词本服务：单一插件实例对应一个服务实例 */
export class VocabularyBookService {
	/** 变更订阅者（服务实例生命周期内有效） */
	private readonly listeners = new Set<VocabularyChangeListener>();

	constructor(private readonly plugin: EnPracticePlugin) {}

	/** 全部词条（按收录时间降序，最新在前） */
	list(): VocabularyEntry[] {
		return sortVocabularyEntries(this.plugin.settings.vocabulary ?? []);
	}

	/** 单词是否已收录（大小写不敏感） */
	has(word: string): boolean {
		return hasVocabularyEntry(this.plugin.settings.vocabulary ?? [], word);
	}

	/**
	 * 收录单词（草稿可含音标/释义/备注快照）。
	 * 空单词或重复收录时拒绝并提示。
	 */
	async add(draft: VocabularyEntryDraft): Promise<VocabularyServiceResult> {
		const result = addVocabularyEntry(
			this.plugin.settings.vocabulary ?? [],
			draft,
		);
		if (!result.changed) {
			if (result.reason === 'empty-word') {
				new Notice('请输入要收录的单词');
			} else if (result.reason === 'duplicate') {
				// 提示已收录词条的标准拼写，而非用户输入的大小写形式
				const existing = findVocabularyEntry(
					this.plugin.settings.vocabulary ?? [],
					draft.word,
				);
				new Notice(`${existing?.word ?? draft.word} 已在生词本中`);
			}
			return { changed: false };
		}
		this.plugin.settings.vocabulary = result.entries;
		await this.persist();
		const word = result.entry?.word ?? '';
		new Notice(`已加入生词本：${word}`);
		this.notify({ type: 'add', word });
		return { changed: true, entry: result.entry };
	}

	/**
	 * 从生词本移除单词。
	 * 未收录时静默返回（调用方按钮状态本就为未收录，无需提示）。
	 */
	async remove(word: string): Promise<VocabularyServiceResult> {
		const target = findVocabularyEntry(
			this.plugin.settings.vocabulary ?? [],
			word,
		);
		const result = removeVocabularyEntry(
			this.plugin.settings.vocabulary ?? [],
			word,
		);
		if (!result.changed) {
			return { changed: false };
		}
		const normalized = target?.word ?? normalizeVocabWord(word);
		this.plugin.settings.vocabulary = result.entries;
		await this.persist();
		new Notice(`已从生词本移除：${normalized}`);
		this.notify({ type: 'remove', word: normalized });
		return { changed: true };
	}

	/**
	 * 编辑词条（单词/备注/音标/释义）。
	 * 改名为空或重复、词条不存在时拒绝并提示原因。
	 */
	async update(
		id: string,
		patch: VocabularyEntryPatch,
	): Promise<VocabularyServiceResult> {
		const result = updateVocabularyEntry(
			this.plugin.settings.vocabulary ?? [],
			id,
			patch,
		);
		if (!result.changed) {
			if (result.reason === 'empty-word') {
				new Notice('单词不能为空');
			} else if (result.reason === 'duplicate') {
				new Notice(
					`${normalizeVocabWord(patch.word ?? '')} 已在生词本中`,
				);
			} else {
				new Notice('生词本中未找到该词条');
			}
			return { changed: false };
		}
		this.plugin.settings.vocabulary = result.entries;
		await this.persist();
		const word = result.entry?.word ?? '';
		new Notice(`已更新生词本：${word}`);
		this.notify({ type: 'update', word });
		return { changed: true, entry: result.entry };
	}

	/**
	 * 订阅生词本变更。
	 * @param listener 变更监听器
	 * @returns 退订函数
	 */
	subscribe(listener: VocabularyChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 持久化：局部保存插件数据，不触发面板整页重渲染 */
	private async persist(): Promise<void> {
		await this.plugin.saveData(this.plugin.settings);
	}

	/** 广播变更到全部订阅者 */
	private notify(detail: VocabularyChangeDetail): void {
		for (const listener of this.listeners) {
			listener(detail);
		}
	}
}

/** 当前装配的生词本服务（插件 onload 装配，测试可注入桩） */
let activeService: VocabularyBookService | null = null;

/**
 * 装配生词本服务。
 * @param service 服务实例
 */
export function setVocabularyService(service: VocabularyBookService): void {
	activeService = service;
}

/**
 * 获取生词本服务。
 * @returns 已装配的服务实例
 * @throws 未装配时抛错（所有 UI 入口都依赖装配后的服务）
 */
export function getVocabularyService(): VocabularyBookService {
	if (!activeService) {
		throw new Error('生词本服务尚未初始化');
	}
	return activeService;
}
