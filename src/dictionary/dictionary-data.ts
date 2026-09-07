/**
 * 词典数据接入层。
 *
 * 数据以 JSONL 文本随插件打包（esbuild text loader 内联为字符串字面量），
 * 首次查询时才执行 JSON.parse 并缓存——词典约 4.9MB、词形索引约 0.9MB，
 * 解析一次均为数十毫秒量级，插件启动阶段零解析开销（字符串字面量的
 * 引擎解析成本也远低于对象字面量）。
 * 测试不直接导入本模块（避免 vitest 解析 .txt 模块），
 * 纯函数与真实数据分别由 lookup 测试与 fs 直读的黄金用例覆盖。
 */

import dictionaryFormsText from '../data/dictionary-forms.txt';
import dictionaryText from '../data/dictionary.txt';
import {
	buildFormLookup,
	parseDictionaryText,
	parseFormIndexText,
	searchWithFormIndex,
} from './lookup';
import type {
	DictionaryEntry,
	DictionaryMatch,
	FormIndexEntry,
	SearchOptions,
} from './types';

/** 词条解析缓存单例 */
let entriesCache: DictionaryEntry[] | null = null;

/** 词形反向索引解析缓存单例 */
let formEntriesCache: FormIndexEntry[] | null = null;

/** 变形词查询表缓存单例（由词形索引构建，小写键） */
let formLookupCache: Map<string, { word: string; code: string }> | null = null;

/** 获取词典条目（首次调用时解析并缓存） */
function getEntries(): DictionaryEntry[] {
	if (entriesCache === null) {
		entriesCache = parseDictionaryText(dictionaryText);
	}
	return entriesCache;
}

/** 获取词形反向索引条目（首次调用时解析并缓存） */
function getFormEntries(): FormIndexEntry[] {
	if (formEntriesCache === null) {
		formEntriesCache = parseFormIndexText(dictionaryFormsText);
	}
	return formEntriesCache;
}

/** 获取变形词查询表（首次调用时构建并缓存） */
function getFormLookup(): Map<string, { word: string; code: string }> {
	if (formLookupCache === null) {
		formLookupCache = buildFormLookup(getFormEntries());
	}
	return formLookupCache;
}

/**
 * 词典查询总入口（方向自动检测 + 词形归一化）：
 * - 含汉字：按中文释义查英文候选；
 * - 纯英文：按单词形态匹配（精确/通配符/前缀/包含/模糊）；
 *   精确未命中时走词形反向索引归一化到词元（如 improves → improve，
 *   结果带 formOf 词形标注）。本地查询，确定性结果，无网络与 AI 延迟。
 * @param query 用户输入（中文词或英文单词，英文可含 `l_n`/`l?n` 类通配符）
 * @param options 查询选项（候选上限等）
 * @returns 按词聚合的候选列表
 */
export function searchDictionary(
	query: string,
	options?: SearchOptions,
): DictionaryMatch[] {
	return searchWithFormIndex(query, getEntries(), getFormLookup(), options);
}
