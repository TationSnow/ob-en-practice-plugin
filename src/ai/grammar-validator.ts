import type { GrammarResult, SentenceComponent } from '../types';
import { findComponentSpan } from '../utils/sentence';
import { SUBORDINATE_CLAUSE_TYPES } from './schemas';

/** 句尾标点（含中英文），模型常给句尾补句号，修复时用于剥除 */
const TRAILING_PUNCTUATION = /[.。!！?？;；,，、"'”’）)\]}]+$/;

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
		validateComponentTree(
			component,
			component.text,
			normalizedInput,
			issues,
		);
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

/**
 * 递归校验成分及其嵌套子成分：
 * 子成分必须包含在父成分中，且都是原句的连续片段。
 * @param component 当前成分
 * @param parentText 父成分文本（用于校验子成分是否包含在内）
 * @param sentence 原句
 * @param issues 问题列表
 */
function validateComponentTree(
	component: SentenceComponent,
	parentText: string,
	sentence: string,
	issues: string[],
): void {
	if (!findComponentSpan(sentence, component.text, 0)) {
		issues.push(`成分未在原句中找到连续片段：${component.text}`);
	}
	for (const child of component.children ?? []) {
		if (!findComponentSpan(parentText, child.text, 0)) {
			issues.push(`子成分未包含在父成分中：${child.text}`);
		}
		validateComponentTree(child, component.text, sentence, issues);
	}
}

/**
 * 修复模型输出中与原句的“可修复差异”，把可自动纠正的校验失败就地修复。
 * 模型常给句尾补句号或微调空白（英文书写习惯使然），这类差异不代表内容幻觉；
 * 真实的改写、幻觉片段不会被修复，仍由 validateGrammarResult 拦截。
 * 修复在解析成功后、业务校验前执行，原地修改 result。
 * @param result 待修复的分析结果（原地修改）
 * @param sentence 用户输入的原始句子
 */
export function repairGrammarResult(
	result: GrammarResult,
	sentence: string,
): void {
	const normalizedInput = sentence.trim();
	repairSentenceField(result, normalizedInput);

	// 分句与顶层成分都在原句范围内修复
	for (const clause of result.clauses) {
		repairSpanText(clause, normalizedInput);
	}
	for (const component of result.components) {
		repairComponentTree(component, normalizedInput);
	}
}

/**
 * 修复 sentence 字段：与原句仅差空白或句尾标点时回填为原句。
 * @param result 分析结果（原地修改）
 * @param normalizedInput 去除首尾空白后的原句
 */
function repairSentenceField(
	result: GrammarResult,
	normalizedInput: string,
): void {
	// 完全一致时无需处理
	if (result.sentence === normalizedInput) {
		return;
	}
	// 空白差异（含首尾空白与连续空白）：折叠后一致即可修复
	if (
		collapseWhitespace(result.sentence) ===
		collapseWhitespace(normalizedInput)
	) {
		result.sentence = normalizedInput;
		return;
	}
	// 仅句尾标点差异：剥除句尾标点后一致即可修复
	if (
		collapseWhitespace(stripTrailingPunctuation(result.sentence)) ===
		collapseWhitespace(stripTrailingPunctuation(normalizedInput))
	) {
		result.sentence = normalizedInput;
	}
}

/**
 * 递归修复成分树：成分相对原句修复，子成分相对父成分修复。
 * @param component 当前成分（原地修改）
 * @param sentence 原句
 */
function repairComponentTree(
	component: SentenceComponent,
	sentence: string,
): void {
	repairSpanText(component, sentence);
	for (const child of component.children ?? []) {
		repairComponentTree(child, component.text);
	}
}

/**
 * 尝试修复单个片段的 text 字段。
 * 仅当直接匹配失败、且剥除句尾标点后能在 source 中找到连续片段时，
 * 才把 text 替换为 source 中的精确子串；其余情况保持原样交由校验处理。
 * @param span 携带 text 的片段（原地修改）
 * @param source 搜索范围（原句或父成分文本）
 */
function repairSpanText(
	span: { text: string },
	source: string,
): void {
	if (findComponentSpan(source, span.text, 0)) {
		return;
	}
	const stripped = stripTrailingPunctuation(span.text);
	if (!stripped) {
		return;
	}
	const repaired = findComponentSpan(source, stripped, 0);
	if (repaired) {
		span.text = source.slice(repaired.start, repaired.end);
	}
}

/** 剥除文本末尾的标点字符 */
function stripTrailingPunctuation(text: string): string {
	return text.replace(TRAILING_PUNCTUATION, '').trimEnd();
}

/** 折叠连续空白并去除首尾空白 */
function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
