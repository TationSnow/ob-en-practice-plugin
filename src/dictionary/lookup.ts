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

/** 汉字判定（含 CJK 统一表意文字）：用于查词方向的自动检测 */
const CJK_PATTERN = /[\u4e00-\u9fa5]/;

/** 通配符字符：下划线/星号代表任意长度字母，问号代表恰好一个字母 */
const WILDCARD_MULTI = /[*_]/;
const WILDCARD_SINGLE = '?';

/** 词形变换编码 → 中文标签（ECDICT exchange 约定） */
const WORD_FORM_LABELS: Record<string, string> = {
	'0': '原型',
	p: '过去式',
	d: '过去分词',
	i: '现在分词',
	'3': '三单',
	s: '复数',
	r: '比较级',
	t: '最高级',
};

/** 词形变换的展示顺序（原型 → 时态 → 语态 → 单复数 → 级） */
const WORD_FORM_ORDER = ['0', 'p', 'd', 'i', '3', 's', 'r', 't'] as const;

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

/**
 * 查询方向自动检测：含汉字视为中译英（按释义查词），否则视为英查词（验证/检索单词）。
 * @param query 用户输入
 * @returns 是否为中译英方向
 */
export function isChineseQuery(query: string): boolean {
	return CJK_PATTERN.test(query);
}

/**
 * 把通配符模式编译为锚定整词的正则（忽略大小写）。
 * `_` 与 `*` 匹配任意长度字母序列（可为零），`?` 匹配恰好一个字符，
 * 其余字符按字面转义，避免用户输入注入正则元字符。
 * @param pattern 含通配符的查询词
 * @returns 整词锚定的正则
 */
function buildWildcardRegex(pattern: string): RegExp {
	let source = '^';
	for (const char of pattern) {
		if (WILDCARD_MULTI.test(char)) {
			source += '.*';
		} else if (char === WILDCARD_SINGLE) {
			source += '.';
		} else if (/[a-z0-9]/i.test(char)) {
			source += char;
		} else {
			source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`${source}$`, 'i');
}

/**
 * 判定两词的编辑距离是否不超过上限（带阈值剪枝的滚动行 DP）。
 * @param a 词 A
 * @param b 词 B
 * @param maxDist 编辑距离上限
 * @returns 是否在阈值内
 */
export function levenshteinWithin(
	a: string,
	b: string,
	maxDist: number,
): boolean {
	if (Math.abs(a.length - b.length) > maxDist) {
		return false;
	}
	if (a === b) {
		return true;
	}
	// 滚动行：prev 为上一行，curr 为当前行；行内最小值超过阈值即提前终止
	let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i += 1) {
		const curr = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const value = Math.min(
				(prev[j] ?? 0) + 1,
				(curr[j - 1] ?? 0) + 1,
				(prev[j - 1] ?? 0) + cost,
			);
			curr.push(value);
			if (value < rowMin) {
				rowMin = value;
			}
		}
		if (rowMin > maxDist) {
			return false;
		}
		prev = curr;
	}
	return (prev[b.length] ?? maxDist + 1) <= maxDist;
}

/** 模糊匹配的编辑距离阈值：词长 ≥6 允许 2，3-5 允许 1，<3 不启用（返回 0） */
function fuzzyMaxDist(query: string): number {
	if (query.length < 3) {
		return 0;
	}
	return query.length >= 6 ? 2 : 1;
}

/**
 * 在词典条目中按英文单词查询（验证拼写、通配符检索、查看词性释义）。
 * 匹配分级：精确（忽略大小写）> 通配符整词 > 前缀 > 包含 > 模糊；
 * 含通配符（`_`/`*` 任意长度、`?` 单字符）时仅做通配符整词匹配；
 * 同级按词频排名升序（常用词靠前）。
 * @param query 英文查询词（可含通配符）
 * @param entries 词典条目
 * @param options 查询选项
 * @returns 候选列表（默认上限 20 条）
 */
export function searchEnglishEntries(
	query: string,
	entries: DictionaryEntry[],
	options: SearchOptions = {},
): DictionaryMatch[] {
	const normalized = query.trim();
	if (!normalized) {
		return [];
	}
	const limit = options.limit ?? DEFAULT_MATCH_LIMIT;
	const lower = normalized.toLowerCase();
	const useWildcard = WILDCARD_MULTI.test(normalized) || normalized.includes(WILDCARD_SINGLE);
	const wildcardRegex = useWildcard ? buildWildcardRegex(normalized) : undefined;
	const maxDist = useWildcard ? undefined : fuzzyMaxDist(lower);

	const matches: EntryMatch[] = [];
	for (const entry of entries) {
		const wordLower = entry.w.toLowerCase();
		let type: DictionaryMatchType | undefined;
		if (wildcardRegex) {
			// 通配符模式：仅整词匹配，不做包含/模糊，保持结果聚焦
			if (wildcardRegex.test(wordLower)) {
				type = 1;
			}
		} else if (wordLower === lower) {
			type = 0;
		} else if (lower && wordLower.startsWith(lower)) {
			type = 2;
		} else if (lower && wordLower.includes(lower)) {
			type = 3;
		} else if (maxDist !== undefined && maxDist > 0 && levenshteinWithin(lower, wordLower, maxDist)) {
			type = 4;
		}
		if (type === undefined) {
			continue;
		}
		matches.push({
			rank: rankOf(entry),
			match: {
				word: entry.w,
				phonetic: entry.ph,
				senses: [...entry.s],
				tag: entry.tg,
				bnc: entry.b,
				frq: entry.f,
				collins: entry.c,
				oxford: entry.o,
				exchange: entry.e,
				matchType: type,
			},
		});
	}

	matches.sort(
		(a, b) => a.match.matchType - b.match.matchType || a.rank - b.rank,
	);
	return matches.slice(0, limit).map((item) => item.match);
}

/**
 * 词典查询总入口（方向自动分派）：含汉字走释义匹配，否则走英文单词匹配。
 * @param query 用户输入
 * @param entries 词典条目
 * @param options 查询选项
 * @returns 候选列表
 */
export function searchDictionary(
	query: string,
	entries: DictionaryEntry[],
	options: SearchOptions = {},
): DictionaryMatch[] {
	return isChineseQuery(query)
		? searchInEntries(query, entries, options)
		: searchEnglishEntries(query, entries, options);
}

/**
 * 把词形变换编码串格式化为可读文本。
 * 如 `p:was/3:is/d:been` → `过去式 was · 三单 is · 过去分词 been`；
 * 未知编码的片段安全跳过，空串返回空文本。
 * @param exchange 词形变换编码串（ECDICT exchange 字段）
 * @returns 可读文本
 */
export function formatWordForms(exchange: string): string {
	if (!exchange) {
		return '';
	}
	const parts: Array<{ code: string; value: string }> = [];
	for (const segment of exchange.split('/')) {
		const separatorIndex = segment.indexOf(':');
		if (separatorIndex <= 0) {
			continue;
		}
		parts.push({
			code: segment.slice(0, separatorIndex),
			value: segment.slice(separatorIndex + 1),
		});
	}
	parts.sort(
		(a, b) =>
			WORD_FORM_ORDER.indexOf(a.code as (typeof WORD_FORM_ORDER)[number]) -
			WORD_FORM_ORDER.indexOf(b.code as (typeof WORD_FORM_ORDER)[number]),
	);
	return parts
		.filter(
			(part) =>
				WORD_FORM_ORDER.includes(part.code as (typeof WORD_FORM_ORDER)[number]) &&
				part.value !== '',
		)
		.map((part) => `${WORD_FORM_LABELS[part.code]} ${part.value}`)
		.join(' · ');
}
