/**
 * 词典数据接入层。
 *
 * 数据以 JSONL 文本随插件打包（esbuild text loader 内联为字符串字面量），
 * 首次查询时才执行 JSON.parse 并缓存——4.85MB 文本解析一次约数十毫秒，
 * 插件启动阶段零解析开销（字符串字面量的引擎解析成本也远低于对象字面量）。
 * 测试不直接导入本模块（避免 vitest 解析 .txt 模块），
 * 纯函数与真实数据分别由 lookup 测试与 fs 直读的黄金用例覆盖。
 */

import dictionaryText from '../data/dictionary.txt';
import {
	parseDictionaryText,
	searchInEntries,
} from './lookup';
import type { DictionaryEntry, DictionaryMatch, SearchOptions } from './types';

/** 解析缓存单例 */
let entriesCache: DictionaryEntry[] | null = null;

/** 获取词典条目（首次调用时解析并缓存） */
function getEntries(): DictionaryEntry[] {
	if (entriesCache === null) {
		entriesCache = parseDictionaryText(dictionaryText);
	}
	return entriesCache;
}

/**
 * 查询中文词对应的英文候选（词典本地查询，确定性结果，无网络与 AI 延迟）。
 * @param query 中文查询词
 * @param options 查询选项（候选上限等）
 * @returns 按词聚合的候选列表
 */
export function searchChinese(
	query: string,
	options?: SearchOptions,
): DictionaryMatch[] {
	return searchInEntries(query, getEntries(), options);
}
