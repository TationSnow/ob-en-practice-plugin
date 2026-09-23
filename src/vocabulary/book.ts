/**
 * 生词本纯函数数据层：词条的增删改查、排序、过滤与随机选词。
 * 只做状态计算与不可变更新，不涉及 DOM、持久化与提示（UI 关注点，
 * 由 service 层承担），因此可脱离 Obsidian 环境完整测试。
 */
import type {
	VocabularyEntry,
	VocabularyEntryDeps,
	VocabularyEntryDraft,
	VocabularyEntryPatch,
	VocabularyMutationResult,
} from './types';

/** 生词本出题提示：单词 + 中文含义的精简结构（AI 层按结构化约定消费） */
export interface VocabularyWordHint {
	word: string;
	/** 中文含义：释义快照拼接，缺失时为用户备注，可能为空串 */
	meaning: string;
}

/**
 * 生成词条唯一 id。
 * Electron 渲染进程与 Node 19+ 均内置 Web Crypto（crypto.randomUUID），
 * 环境不支持时退化为时间戳 + 随机串，保证 id 可用性。
 */
function defaultCreateId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 规范化单词：去除首尾空白。
 * 不做大小写归一：保留用户录入的拼写，比较时单独忽略大小写。
 * @param input 原始输入
 * @returns 规范化后的单词
 */
export function normalizeVocabWord(input: string): string {
	return input.trim();
}

/**
 * 按单词查找词条（大小写不敏感，忽略首尾空白）。
 * @param entries 现有词条列表
 * @param word 待查找的单词
 * @returns 命中的词条；未命中返回 undefined
 */
export function findVocabularyEntry(
	entries: readonly VocabularyEntry[],
	word: string,
): VocabularyEntry | undefined {
	const normalized = normalizeVocabWord(word).toLowerCase();
	if (!normalized) return undefined;
	return entries.find((entry) => entry.word.toLowerCase() === normalized);
}

/**
 * 判断单词是否已收录（大小写不敏感）。
 * @param entries 现有词条列表
 * @param word 待检查的单词
 * @returns 是否已收录
 */
export function hasVocabularyEntry(
	entries: readonly VocabularyEntry[],
	word: string,
): boolean {
	return findVocabularyEntry(entries, word) !== undefined;
}

/**
 * 由草稿创建词条：归一化单词并生成 id 与收录时间。
 * @param draft 收录草稿
 * @param deps 依赖注入（测试可注入确定性的 id 与时间）
 * @returns 完整词条
 */
export function createVocabularyEntry(
	draft: VocabularyEntryDraft,
	deps: VocabularyEntryDeps = {},
): VocabularyEntry {
	return {
		id: deps.createId?.() ?? defaultCreateId(),
		word: normalizeVocabWord(draft.word),
		phonetic: draft.phonetic,
		senses: draft.senses ?? [],
		note: draft.note?.trim() || undefined,
		addedAt: deps.now?.() ?? Date.now(),
	};
}

/**
 * 新增词条：新词追加到末尾；空单词或重复收录（大小写不敏感）时拒绝。
 * @param entries 现有词条列表
 * @param draft 收录草稿
 * @param deps 依赖注入
 * @returns 变更结果（entries 为新数组，原数组不被修改）
 */
export function addVocabularyEntry(
	entries: readonly VocabularyEntry[],
	draft: VocabularyEntryDraft,
	deps: VocabularyEntryDeps = {},
): VocabularyMutationResult {
	const word = normalizeVocabWord(draft.word);
	if (!word) {
		return { entries: [...entries], changed: false, reason: 'empty-word' };
	}
	if (hasVocabularyEntry(entries, word)) {
		return { entries: [...entries], changed: false, reason: 'duplicate' };
	}
	const entry = createVocabularyEntry({ ...draft, word }, deps);
	return { entries: [...entries, entry], entry, changed: true };
}

/**
 * 删除词条：按单词定位（大小写不敏感）。
 * @param entries 现有词条列表
 * @param word 待删除的单词
 * @returns 变更结果
 */
export function removeVocabularyEntry(
	entries: readonly VocabularyEntry[],
	word: string,
): VocabularyMutationResult {
	const target = findVocabularyEntry(entries, word);
	if (!target) {
		return { entries: [...entries], changed: false, reason: 'not-found' };
	}
	return {
		entries: entries.filter((entry) => entry.id !== target.id),
		changed: true,
	};
}

/**
 * 编辑词条：按 id 定位，仅应用补丁中出现的字段。
 * - word：归一化；为空或与其他词条重复（忽略自身，大小写不敏感）时拒绝；
 * - note / phonetic：空串视为清除；
 * - senses：整组替换。
 * @param entries 现有词条列表
 * @param id 目标词条 id
 * @param patch 编辑补丁
 * @param deps 依赖注入（改名后 id 与收录时间保持不变，仅备用扩展）
 * @returns 变更结果
 */
export function updateVocabularyEntry(
	entries: readonly VocabularyEntry[],
	id: string,
	patch: VocabularyEntryPatch,
	_deps: VocabularyEntryDeps = {},
): VocabularyMutationResult {
	const target = entries.find((entry) => entry.id === id);
	if (!target) {
		return { entries: [...entries], changed: false, reason: 'not-found' };
	}

	let nextWord = target.word;
	if (patch.word !== undefined) {
		const normalized = normalizeVocabWord(patch.word);
		if (!normalized) {
			return { entries: [...entries], changed: false, reason: 'empty-word' };
		}
		const duplicate = findVocabularyEntry(entries, normalized);
		if (duplicate && duplicate.id !== id) {
			return { entries: [...entries], changed: false, reason: 'duplicate' };
		}
		nextWord = normalized;
	}

	const updated: VocabularyEntry = {
		...target,
		word: nextWord,
		phonetic:
			patch.phonetic !== undefined
				? patch.phonetic.trim() || undefined
				: target.phonetic,
		senses: patch.senses ?? target.senses,
		note:
			patch.note !== undefined
				? patch.note.trim() || undefined
				: target.note,
	};
	return {
		entries: entries.map((entry) => (entry.id === id ? updated : entry)),
		entry: updated,
		changed: true,
	};
}

/**
 * 按收录时间降序排序（最新收录的在前），不修改原数组。
 * @param entries 词条列表
 * @returns 排序后的新数组
 */
export function sortVocabularyEntries(
	entries: readonly VocabularyEntry[],
): VocabularyEntry[] {
	return [...entries].sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * 搜索过滤：单词、备注与释义模糊匹配（大小写不敏感）。
 * @param entries 词条列表
 * @param query 搜索词（空查询返回全部词条副本）
 * @returns 过滤后的新数组
 */
export function filterVocabularyEntries(
	entries: readonly VocabularyEntry[],
	query: string,
): VocabularyEntry[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [...entries];
	return entries.filter(
		(entry) =>
			entry.word.toLowerCase().includes(normalized) ||
			(entry.note?.toLowerCase().includes(normalized) ?? false) ||
			entry.senses.some((sense) => sense.z.toLowerCase().includes(normalized)),
	);
}

/**
 * 随机抽取词条（部分 Fisher–Yates 洗牌，不重复、不修改原数组）。
 * @param entries 词条列表
 * @param count 抽取数量（超过词条总数时返回全部）
 * @param random 随机数函数（默认 Math.random，测试可注入）
 * @returns 抽取结果
 */
export function pickRandomVocabularyEntries(
	entries: readonly VocabularyEntry[],
	count: number,
	random: () => number = Math.random,
): VocabularyEntry[] {
	const take = Math.max(0, Math.min(Math.floor(count), entries.length));
	if (take === 0) return [];
	const pool = [...entries];
	const picked: VocabularyEntry[] = [];
	for (let i = 0; i < take; i += 1) {
		const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
		const entry = pool.splice(index, 1)[0];
		if (entry) picked.push(entry);
	}
	return picked;
}

/**
 * 解析词条的中文含义：释义快照拼接在前，备注兜底。
 * @param entry 词条
 * @returns 中文含义（可能为空串）
 */
export function resolveVocabularyMeaning(entry: VocabularyEntry): string {
	const meanings = entry.senses
		.map((sense) => sense.z.trim())
		.filter((text) => text !== '');
	if (meanings.length > 0) return meanings.join('；');
	return entry.note?.trim() ?? '';
}

/**
 * 把词条格式化为出题提示结构（单词 + 中文含义）。
 * @param entries 词条列表
 * @returns 精简提示结构
 */
export function formatVocabularyHints(
	entries: readonly VocabularyEntry[],
): VocabularyWordHint[] {
	return entries.map((entry) => ({
		word: entry.word,
		meaning: resolveVocabularyMeaning(entry),
	}));
}
