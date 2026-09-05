import type {
	ComponentType,
	GrammarResult,
	SentenceComponent,
} from '../types';
import { findComponentSpan } from '../utils/sentence';
import { SUBORDINATE_CLAUSE_TYPES } from './schemas';

/** 句尾标点（含中英文），模型常给句尾补句号，修复时用于剥除 */
const TRAILING_PUNCTUATION = /[.。!！?？;；,，、"'”’）)\]}]+$/;

/**
 * 从句类型到成分类型的映射，供合成 children 时推导成分角色。
 * 从句在句中承担的成分功能与类型名一致：宾语从句作宾语、状语从句作状语等。
 */
const CLAUSE_TYPE_TO_COMPONENT_TYPE: Record<string, ComponentType> = {
	宾语从句: 'object',
	主语从句: 'subject',
	表语从句: 'complement',
	定语从句: 'attributive',
	状语从句: 'adverbial',
	同位语从句: 'other',
	比较从句: 'adverbial',
};

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
 * 为“包含从句文本但没有 children”的成分合成子成分（递归）。
 * 模型偶尔会把整个从句作为单个成分返回而不拆解内部结构；
 * 此时 clauses 数组中的从句类型与层级信息仍然可用：
 * 按从句类型映射成分角色（宾语从句→宾语、定语从句→定语等），
 * 把嵌套在成分文本内的从句文本合成为 children，恢复渲染所需的结构层次。
 * 这是基于模型自身输出的结构性修复，不能恢复从句内部的成分细节；
 * 已有 children 的成分只递归向下，不做合成。
 * @param components 当前层级的成分列表（原地修改）
 * @param clauses 从句信息
 */
function synthesizeClauseChildren(
	components: SentenceComponent[],
	clauses: GrammarResult['clauses'],
): void {
	for (const component of components) {
		if (component.children?.length) {
			synthesizeClauseChildren(component.children, clauses);
			continue;
		}
		const children = buildClauseChildrenFromClauses(component.text, clauses);
		if (children) {
			component.children = children;
			// 合成出的从句子成分内部可能还嵌套更深层从句，继续向下合成
			synthesizeClauseChildren(children, clauses);
		}
	}
}

/**
 * 从从句列表中收集嵌套在成分文本内的从句区间，按类型映射为子成分。
 * 与成分文本完全一致的从句（成分本身就是该从句）以及与已收集区间
 * 重叠的从句会被跳过；从句区间之间的连接文本留给父成分底色渲染。
 * @param text 成分文本
 * @param clauses 从句信息
 * @returns 合成的子成分列表；无可合成内容时返回 null
 */
function buildClauseChildrenFromClauses(
	text: string,
	clauses: GrammarResult['clauses'],
): SentenceComponent[] | null {
	const spans: { start: number; end: number; type: ComponentType }[] = [];
	for (const clause of clauses) {
		// level 0 主句不参与子成分合成
		if (clause.level <= 0) continue;
		const span = findComponentSpan(text, clause.text, 0);
		if (!span) continue;
		// 成分本身就是该从句时跳过，避免合成出与父成分等大的子成分
		if (span.start === 0 && span.end === text.length) continue;
		// 与已收集区间重叠的从句交由递归处理（作为外层从句的子成分）
		if (spans.some((item) => span.start < item.end && item.start < span.end)) {
			continue;
		}
		spans.push({
			start: span.start,
			end: span.end,
			type: CLAUSE_TYPE_TO_COMPONENT_TYPE[clause.type] ?? 'other',
		});
	}
	if (spans.length === 0) {
		return null;
	}
	spans.sort((a, b) => a.start - b.start);
	return spans.map((span) => ({
		text: text.slice(span.start, span.end),
		type: span.type,
	}));
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

	// 先修复树拓扑：把文本上不属于父成分的子成分提升为平级成分，
	// 否则后续按“父成分文本”修复子成分文本时无从下手
	repairComponentTopology(result.components, normalizedInput);

	// 分句与顶层成分都在原句范围内修复
	for (const clause of result.clauses) {
		repairSpanText(clause, normalizedInput);
	}
	for (const component of result.components) {
		repairComponentTree(component, normalizedInput);
	}

	// 最后为“包含从句文本但没有 children”的成分合成结构。
	// 提示词约束只能降低该形态的概率，无法根除；合成后渲染层即可按
	// 成分类型着色，避免整段从句只剩灰白底色。
	synthesizeClauseChildren(result.components, result.clauses);
}

/**
 * 修复成分树拓扑：把“文本不在父成分文本内”的子成分提升为父成分的平级成分。
 * 模型偶尔会输出树拓扑与文本片段不一致的结果——把从句成分挂到某个成分的
 * children 下，但其文本并不包含在父成分文本内（例如把两个宾语从句挂到较短的
 * 定语成分下）。这类输出信息本身完整，只是挂载层级错误：
 * 提升后即等价于正确的平铺结构，无需重新请求。
 * 子成分文本在原句中不存在（真实幻觉）时保留原样，交由 validateGrammarResult 报错。
 * @param components 当前层级的成分列表（原地修改）
 * @param sentence 原句
 */
function repairComponentTopology(
	components: SentenceComponent[],
	sentence: string,
): void {
	for (let index = 0; index < components.length; index += 1) {
		const component = components[index] as SentenceComponent;
		// 先递归修复子树，被提升的成分在挂载前已完成自身的拓扑修复
		if (component.children?.length) {
			repairComponentTopology(component.children, sentence);
		}
		const children = component.children;
		if (!children?.length) {
			continue;
		}
		const kept: SentenceComponent[] = [];
		const hoisted: SentenceComponent[] = [];
		for (const child of children) {
			const inParent = findComponentSpan(component.text, child.text, 0);
			const inSentence = findComponentSpan(sentence, child.text, 0);
			if (!inParent && inSentence) {
				hoisted.push(child);
			} else {
				kept.push(child);
			}
		}
		if (hoisted.length > 0) {
			// 全部提升后清空 children；保留的子成分继续留在父成分内
			component.children = kept.length > 0 ? kept : undefined;
			// 插入到父成分之后，保持与原句出现顺序一致
			components.splice(index + 1, 0, ...hoisted);
			index += hoisted.length;
		}
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
