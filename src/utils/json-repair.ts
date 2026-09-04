/**
 * JSON 文本修复工具。
 * 模型输出的 JSON 偶发语法缺陷，最常见的是：中文字符串值内使用未转义的英文双引号
 * （如 "usage": "表示"资源和资产"，..."），导致整个 JSON 无法解析。
 * 这里提供纯文本层面的修复，配合 LangChain 结构化输出解析器使用：
 * 修复不产生额外模型请求，符合“代码层面让请求如期成功”的目标。
 */

/** 字符串结束引号后允许出现的字符（值分隔符或容器收口） */
const STRING_TERMINATOR_FOLLOWERS = new Set([',', '}', ']', ':']);

/**
 * 修复 JSON 字符串值内部未转义的英文双引号。
 * 扫描策略：进入字符串后遇到 `"` 时，向后查看下一个非空白字符——
 * 是分隔符（, } ] :）或文本结束则视为字符串正常结束，
 * 否则视为值内部的未转义引号，转义为 \" 后保留。
 *
 * 仅在标准 JSON.parse 失败后由调用方使用，对合法 JSON 无副作用；
 * 其他类型的语法缺陷（如截断、缺括号）不在处理范围，返回 null 交由上层报错。
 * @param text 原始 JSON 文本
 * @returns 修复后的文本；无任何变更时返回 null
 */
export function repairJsonText(text: string): string | null {
	let repaired = '';
	let inString = false;
	let changed = false;

	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);

		if (!inString) {
			if (ch === '"') {
				inString = true;
			}
			repaired += ch;
			continue;
		}

		if (ch === '\\') {
			// 已转义字符（如 \" \\ \n）连同后续字符原样保留
			repaired += ch;
			const next = text.charAt(i + 1);
			if (next) {
				repaired += next;
				i += 1;
			}
			continue;
		}

		if (ch === '"') {
			// 向后查看下一个非空白字符，判断是结束引号还是值内部引号
			let cursor = i + 1;
			while (cursor < text.length && /\s/.test(text.charAt(cursor))) {
				cursor += 1;
			}
			const follower = cursor < text.length ? text.charAt(cursor) : '';
			if (follower === '' || STRING_TERMINATOR_FOLLOWERS.has(follower)) {
				// 正常的字符串结束引号
				inString = false;
				repaired += ch;
			} else {
				repaired += '\\"';
				changed = true;
			}
			continue;
		}

		repaired += ch;
	}

	return changed ? repaired : null;
}
