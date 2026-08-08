import type { GrammarResult } from '../types';
import { findComponentSpan } from '../utils/sentence';
import { SUBORDINATE_CLAUSE_TYPES } from './schemas';

/**
 * 校验语法分析结果是否满足“连续片段、结构完整”的要求。
 * 该校验在 Zod schema 校验之后执行，用于提高模型输出的可靠性。
 * @param result 模型输出的语法分析结果
 * @param sentence 用户输入的原始句子
 * @returns 问题列表；为空表示校验通过
 */
export function validateGrammarResult(
	result: GrammarResult,
	sentence: string,
): string[] {
	const issues: string[] = [];
	const normalizedInput = sentence.trim();

	// sentence 必须原样保留输入，避免模型改写
	if (result.sentence.trim() !== normalizedInput) {
		issues.push('sentence 与原句不一致');
	}

	// 成分必须非空，且每个 text 都应是原句中的连续片段
	if (result.components.length === 0) {
		issues.push('components 不能为空');
	}
	for (const component of result.components) {
		if (!findComponentSpan(normalizedInput, component.text, 0)) {
			issues.push(`成分未在原句中找到连续片段：${component.text}`);
		}
	}

	// 分句结构必须包含且仅包含一个 level 0 主句
	if (result.clauses.length === 0) {
		issues.push('clauses 不能为空，至少包含 level 0 主句');
	}
	const mainClauses = result.clauses.filter((clause) => clause.level === 0);
	if (mainClauses.length !== 1) {
		issues.push('必须且只能有一个 level 0 主句');
	}

	const clauseLevels = new Set(result.clauses.map((clause) => clause.level));
	for (const clause of result.clauses) {
		if (!findComponentSpan(normalizedInput, clause.text, 0)) {
			issues.push(`分句未在原句中找到连续片段：${clause.text}`);
		}
		// 从句必须存在上一级作为宿主，保证层级连续
		if (clause.level > 0 && !clauseLevels.has(clause.level - 1)) {
			issues.push(`level ${clause.level} 从句缺少上一级宿主：${clause.text}`);
		}
		// level 0 只能为主句，其余层级必须使用具体从句类型
		if (
			clause.level > 0 &&
			!SUBORDINATE_CLAUSE_TYPES.some((type) => type === clause.type)
		) {
			issues.push(`level ${clause.level} 从句类型无效：${clause.type}`);
		}
		if (clause.level === 0 && clause.type !== '主句') {
			issues.push('level 0 的类型必须为主句');
		}
	}

	return issues;
}
