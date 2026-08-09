/**
 * 句子切分与成分匹配工具。
 * 供语法分析结果展示使用：按句分段，同时保证原句标点不丢失。
 */

/** 常见英文缩写，避免将缩写句号误判为句子边界 */
const COMMON_ABBREVIATIONS = new Set([
	'mr',
	'mrs',
	'ms',
	'dr',
	'st',
	'prof',
	'jr',
	'sr',
	'vs',
	'etc',
	'no',
	'e.g',
	'i.e',
	'u.s',
	'u.k',
	'ph.d',
]);

/** 句子结束标点 */
const SENTENCE_END_PUNCTUATION = new Set(['.', '!', '?']);

/** 引号开始字符 */
const QUOTE_OPENERS = new Set(['"', '“', '‘', "'"]);

/** 引号结束字符 */
const QUOTE_CLOSERS = new Set(['"', '”', '’', "'"]);

/** 判断字符是否为引号开始（撇号不作为引号开始） */
function isQuoteOpener(text: string, index: number): boolean {
	const ch = text.charAt(index);
	if (!QUOTE_OPENERS.has(ch)) return false;

	const prev = text.charAt(index - 1);
	const next = text.charAt(index + 1);

	if (ch === '"' || ch === '“') {
		// 双引号一般出现在词边界（句首、空白或标点之后）
		return prev === '' || !/[A-Za-z0-9]/.test(prev);
	}

	// 单引号需要避开撇号：前一个字符不是字母数字，后一个字符是字母
	return (
		(prev === '' || !/[A-Za-z0-9]/.test(prev)) &&
		/[A-Za-z]/.test(next)
	);
}

/** 判断引号结束字符是否与栈顶引号匹配 */
function isMatchingQuoteCloser(top: string, ch: string): boolean {
	if (top === '"') return ch === '"';
	if (top === '“') return ch === '”';
	if (top === '‘') return ch === '’' || ch === "'";
	if (top === "'") return ch === "'" || ch === '’';
	return false;
}

/** 判断当前字符是否为引号结束（撇号不作为引号结束） */
function isQuoteCloser(text: string, index: number, top: string): boolean {
	const ch = text.charAt(index);
	if (!QUOTE_CLOSERS.has(ch) || !isMatchingQuoteCloser(top, ch)) {
		return false;
	}

	if (ch === "'" || ch === '’') {
		const next = text.charAt(index + 1);
		// 撇号（如 it's、don't）后面紧跟字母时不视为引号结束
		return next === '' || !/[A-Za-z0-9]/.test(next);
	}
	return true;
}

/** 判断字符是否为句子结束标点 */
function isSentenceEndChar(ch: string): boolean {
	return SENTENCE_END_PUNCTUATION.has(ch);
}

/** 判断句号是否属于常见缩写 */
function isAbbreviationPeriod(text: string, periodIndex: number): boolean {
	let start = periodIndex;
	while (start > 0 && /[A-Za-z.]/.test(text.charAt(start - 1))) {
		start -= 1;
	}
	const token = text
		.slice(start, periodIndex + 1)
		.toLowerCase()
		.replace(/\.+$/, '');
	return COMMON_ABBREVIATIONS.has(token);
}

/** 判断句号是否属于小数（如 3.14） */
function isDecimalPeriod(text: string, periodIndex: number): boolean {
	return (
		/[0-9]/.test(text.charAt(periodIndex - 1)) &&
		/[0-9]/.test(text.charAt(periodIndex + 1))
	);
}

/** 判断句末标点位置是否构成句子边界 */
function isSentenceBoundary(text: string, index: number): boolean {
	const ch = text.charAt(index);
	if (ch === '.' && isAbbreviationPeriod(text, index)) return false;
	if (ch === '.' && isDecimalPeriod(text, index)) return false;

	const next = text.charAt(index + 1);
	// 句末标点后跟空白、结束或右括号才视为边界，避免误切 What?Next 这类紧凑文本
	return next === '' || /\s/.test(next) || /[)"”’\]}]/.test(next);
}

/** 引号结束后的下一个有效字符是否属于新句开头 */
function startsNewSentenceAfter(text: string, index: number): boolean {
	let cursor = index;
	while (cursor < text.length && /\s/.test(text.charAt(cursor))) {
		cursor += 1;
	}
	if (cursor >= text.length) return true;

	const ch = text.charAt(cursor);
	// 小写开头视为对话继续（如 He said "What?" she asked.），不切分
	return /[A-Z0-9"“'‘]/.test(ch);
}

/**
 * 将文本按句子拆分，保留每个句子的标点。
 * 引号内的句末标点不作为边界；常见缩写和小数点不会误切。
 * @param text 原始文本
 * @returns 拆分后的句子数组（已去除首尾空白）
 */
export function splitSentences(text: string): string[] {
	const segments: string[] = [];
	const quoteStack: string[] = [];
	let current = '';
	let bracketDepth = 0;

	const flush = (): void => {
		const trimmed = current.trim();
		if (trimmed) segments.push(trimmed);
		current = '';
	};

	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		current += ch;

		const top =
			quoteStack.length > 0 ? quoteStack[quoteStack.length - 1] : undefined;
		if (top !== undefined && isQuoteCloser(text, i, top)) {
			const prev = text.charAt(i - 1);
			quoteStack.pop();
			// 引号内是一句完整的话，且引号后直接开始新句时，在引号后分段
			if (
				quoteStack.length === 0 &&
				bracketDepth === 0 &&
				isSentenceEndChar(prev) &&
				startsNewSentenceAfter(text, i + 1)
			) {
				flush();
			}
			continue;
		}
		if (top === undefined && isQuoteOpener(text, i)) {
			quoteStack.push(ch);
			continue;
		}

		if (ch === '(' || ch === '[' || ch === '{') {
			bracketDepth += 1;
			continue;
		}
		if (ch === ')' || ch === ']' || ch === '}') {
			bracketDepth = Math.max(0, bracketDepth - 1);
			continue;
		}

		if (
			quoteStack.length === 0 &&
			bracketDepth === 0 &&
			isSentenceEndChar(ch) &&
			isSentenceBoundary(text, i)
		) {
			flush();
		}
	}

	flush();
	return segments;
}

/**
 * 清理上一次语法分析渲染留下的标注痕迹。
 * 我们的从句标注会生成 `(从句)1`、`(从句)2` 等括号加层级数字；
 * 用户如果把带标注的结果再次粘贴分析，模型会把这些符号当成原文。
 * 只清理“括号后紧跟数字、且括号内包含空格”的片段，避免误伤正常括号。
 * @param text 原始输入
 * @returns 清理标注痕迹后的文本
 */
export function stripGrammarAnnotations(text: string): string {
	let result = text;
	const annotationPattern = /\(([^()]*\s+[^()]*)\)([1-9][0-9]*)/g;
	let changed = true;

	// 嵌套标注需要逐层剥离，例如 ((who will stick by you)1)1
	while (changed) {
		changed = false;
		result = result.replace(annotationPattern, (_match, inner: string) => {
			changed = true;
			return inner;
		});
	}

	return result;
}

/** 成分匹配区间 */
export interface ComponentSpan {
	start: number;
	end: number;
}

/**
 * 在源文本中查找成分文本的覆盖区间。
 * 匹配时忽略大小写和连续空白差异，返回源文本中的实际字符区间。
 * @param source 源句子文本
 * @param target 成分文本
 * @param fromIndex 搜索起点
 * @returns 匹配区间；找不到时返回 null
 */
export function findComponentSpan(
	source: string,
	target: string,
	fromIndex = 0,
): ComponentSpan | null {
	const normalizedTarget = target.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!normalizedTarget) return null;

	for (let start = fromIndex; start < source.length; start += 1) {
		let srcIndex = start;
		let targetIndex = 0;
		let matched = true;
		while (targetIndex < normalizedTarget.length) {
			if (srcIndex >= source.length) {
				matched = false;
				break;
			}
			const srcChar = source.charAt(srcIndex);
			const targetChar = normalizedTarget.charAt(targetIndex);
			if (/\s/.test(targetChar)) {
				// 目标中的单个空白对应源中的一个或多个空白
				targetIndex += 1;
				while (
					srcIndex < source.length &&
					/\s/.test(source.charAt(srcIndex))
				) {
					srcIndex += 1;
				}
				continue;
			}
			if (/\s/.test(srcChar)) {
				srcIndex += 1;
				continue;
			}
			if (srcChar.toLowerCase() !== targetChar) {
				matched = false;
				break;
			}
			srcIndex += 1;
			targetIndex += 1;
		}
		if (matched) {
			// 去掉区间开头空白，让空白留在普通文本中
			let spanStart = start;
			while (spanStart < srcIndex && /\s/.test(source.charAt(spanStart))) {
				spanStart += 1;
			}
			// 去掉区间尾部空白，让空白留在普通文本中
			let end = srcIndex;
			while (end > spanStart && /\s/.test(source.charAt(end - 1))) {
				end -= 1;
			}
			return { start: spanStart, end };
		}
	}
	return null;
}
