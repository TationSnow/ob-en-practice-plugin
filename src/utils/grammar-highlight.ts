import { findComponentSpan } from './sentence';

/** 从句在文本中的匹配区间 */
export interface ClauseRange {
	start: number;
	end: number;
	level: number;
}

/** 谓语动词核心词在文本中的匹配区间 */
export interface PredicateVerbRange {
	start: number;
	end: number;
}

/** 常见非谓语核心词，用于从谓语短语中启发式定位动词 */
const NON_VERB_WORDS = new Set([
	'indeed',
	'always',
	'never',
	'often',
	'usually',
	'sometimes',
	'already',
	'still',
	'just',
	'easily',
	'quickly',
	'slowly',
	'not',
	'away',
	'up',
	'down',
	'out',
	'back',
	'then',
	'now',
	'also',
	'even',
	'only',
]);

/**
 * 查找文本中所有从句的连续片段区间。
 * @param text 需要标注的文本
 * @param clauses 从句信息
 * @returns 匹配到的从句区间（按出现顺序）
 */
export function findClauseRanges(
	text: string,
	clauses: { text: string; level: number }[],
): ClauseRange[] {
	const ranges: ClauseRange[] = [];
	for (const clause of clauses) {
		// level 0 为主句，不需要用红色括号包裹
		if (clause.level <= 0) continue;
		const span = findComponentSpan(text, clause.text, 0);
		if (span) {
			ranges.push({
				start: span.start,
				end: span.end,
				level: clause.level,
			});
		}
	}
	return ranges;
}

/**
 * 从 details 中解析“谓语动词：”标记，得到动词在谓语文本中的区间。
 * @param text 谓语成分的完整文本
 * @param details 成分说明
 * @returns 动词区间；未找到标记时返回 null
 */
function parsePredicateVerbFromDetails(
	text: string,
	details?: string,
): PredicateVerbRange | null {
	if (!details) return null;
	const match = details.match(
		/谓语动词[:：]\s*([^；。，,]+?)\s*(?:；|。|，|,|$)/,
	);
	const verbText = match?.[1]?.trim();
	if (!verbText) return null;
	const span = findComponentSpan(text, verbText, 0);
	return span ? { start: span.start, end: span.end } : null;
}

/**
 * 启发式定位谓语动词：取谓语短语中最后一个非状语/否定词作为动词核心。
 * 适用于 “will indeed find” → find、“was taken away” → taken 等常见结构。
 * @param text 谓语成分的完整文本
 * @returns 动词区间；未识别到可用词时返回 null
 */
export function findPredicateVerbHeuristic(
	text: string,
): PredicateVerbRange | null {
	let verb: PredicateVerbRange | null = null;
	for (const token of text.matchAll(/\S+/g)) {
		const tokenStart = token.index ?? 0;
		const wordMatch = token[0].match(/[A-Za-z]+(?:'[A-Za-z]+)?/);
		if (!wordMatch || wordMatch.index === undefined) continue;
		const word = wordMatch[0].toLowerCase();
		if (NON_VERB_WORDS.has(word)) continue;
		verb = {
			start: tokenStart + wordMatch.index,
			end: tokenStart + wordMatch.index + word.length,
		};
	}
	return verb;
}

/**
 * 定位谓语动词核心词：优先使用 details 中的“谓语动词：”标记，
 * 标记缺失时回退到启发式规则。
 * @param text 谓语成分的完整文本
 * @param details 成分说明
 * @returns 动词区间；无法定位时返回 null
 */
export function findPredicateVerbRange(
	text: string,
	details?: string,
): PredicateVerbRange | null {
	return (
		parsePredicateVerbFromDetails(text, details) ??
		findPredicateVerbHeuristic(text)
	);
}
