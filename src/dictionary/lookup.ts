/**
 * 词典查询核心（纯函数，不依赖数据文件）。
 *
 * 查询方向：中文词 → 英文候选。实现为「中文释义子串匹配」：
 * 数据规模 3.5 万条，线性扫描单次约数十毫秒，无需预建倒排索引，
 * 且天然支持精确 / 前缀 / 包含三种匹配（如「高兴」可命中「高兴的」→ happy）。
 * 匹配语义由数据保证确定性——这是选择词典而非 AI 的初衷（用户定夺）。
 */

import type {
	DictionaryEntry,
	DictionaryMatch,
	DictionaryMatchType,
	SearchOptions,
} from './types';

/** 默认返回候选上限 */
export const DEFAULT_MATCH_LIMIT = 20;

/**
 * 解析构建产物文本（JSONL，每行一个条目）为条目数组。
 * 单行损坏时跳过该行，不拖垮整库（产物由构建脚本保证质量）。
 * @param text JSONL 文本
 * @returns 词典条目数组
 */
export function parseDictionaryText(text: string): DictionaryEntry[] {
	const entries: DictionaryEntry[] = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			entries.push(JSON.parse(trimmed) as DictionaryEntry);
		} catch {
			// 跳过损坏行：数据由构建脚本生成并经黄金用例验证，此处为防御性兜底
			continue;
		}
	}
	return entries;
}

/** 单词的匹配中间结果 */
interface EntryMatch {
	match: DictionaryMatch;
	/** 词频排名（BNC 与词频取较优，无排名为 Infinity，用于同级排序） */
	rank: number;
}

/** 计算单个释义组与查询词的匹配类型；未命中返回 undefined */
function matchSense(zh: string, query: string): DictionaryMatchType | undefined {
	if (zh === query) {
		return 0;
	}
	if (zh.startsWith(query)) {
		return 1;
	}
	if (zh.includes(query)) {
		return 2;
	}
	return undefined;
}

/** 计算条目的词频排名（BNC 与词频取较优，无排名返回 Infinity） */
function rankOf(entry: DictionaryEntry): number {
	return Math.min(
		entry.b ?? Number.POSITIVE_INFINITY,
		entry.f ?? Number.POSITIVE_INFINITY,
	);
}

/**
 * 在词典条目中查询中文词，返回按词聚合的候选列表。
 * 排序：匹配类型升序（精确 > 前缀 > 包含）→ 词频排名升序（常用词靠前）；
 * 同词多义组完整返回（命中的组排在最前），便于用户自行挑选正确义项。
 * @param query 中文查询词
 * @param entries 词典条目
 * @param options 查询选项
 * @returns 候选列表（默认上限 20 条）
 */
export function searchInEntries(
	query: string,
	entries: DictionaryEntry[],
	options: SearchOptions = {},
): DictionaryMatch[] {
	const normalized = query.trim();
	if (!normalized) {
		return [];
	}
	const limit = options.limit ?? DEFAULT_MATCH_LIMIT;

	const matches: EntryMatch[] = [];
	for (const entry of entries) {
		let best: DictionaryMatchType | undefined;
		const matchedSenses: DictionaryMatch['senses'] = [];
		const restSenses: DictionaryMatch['senses'] = [];
		for (const sense of entry.s) {
			const type = matchSense(sense.z, normalized);
			if (type === undefined) {
				restSenses.push(sense);
				continue;
			}
			if (best === undefined || type < best) {
				best = type;
			}
			matchedSenses.push(sense);
		}
		if (best === undefined) {
			continue;
		}
		matches.push({
			rank: rankOf(entry),
			match: {
				word: entry.w,
				phonetic: entry.ph,
				senses: [...matchedSenses, ...restSenses],
				tag: entry.tg,
				bnc: entry.b,
				frq: entry.f,
				collins: entry.c,
				oxford: entry.o,
				exchange: entry.e,
				matchType: best,
			},
		});
	}

	// matchType 升序为主排序；JS 排序稳定，同类型内保持词频排序后的相对次序
	matches.sort(
		(a, b) => a.match.matchType - b.match.matchType || a.rank - b.rank,
	);
	return matches.slice(0, limit).map((item) => item.match);
}
