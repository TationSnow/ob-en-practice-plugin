import type { GrammarResult } from '../types';

/**
 * 归一化语法分析结果。
 * 把“可修复的冗余”转成规范值，与 schema 的“结构性校验”分离：
 * - tense 数组按首次出现顺序去重（同一时态出现多次不是错误，只是冗余）。
 * @param result 已通过 schema 校验的语法分析结果
 * @returns 归一化后的新对象（不修改入参）
 */
export function normalizeGrammarResult(result: GrammarResult): GrammarResult {
	return {
		...result,
		tense: [...new Set(result.tense)],
	};
}
