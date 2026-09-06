import { type App, MarkdownView } from 'obsidian';

/**
 * 最近一次捕获的非空 DOM 选中文本，供 PDF 等非 Markdown 视图回退使用。
 * 点击插件面板按钮时浏览器会清空正文 DOM 选区，且 selectionchange
 * 早于 click 触发，因此只在选区非空时更新缓存、永不主动清空。
 */
let lastDomSelection: string | null = null;

/**
 * 记录文档当前选中文本。
 * 由 main.ts 监听 selectionchange 时调用：在选区被点击清空前抢先缓存。
 * @param doc 目标文档（主窗口）
 */
export function trackDomSelection(doc: Document): void {
	const selection = doc.getSelection();
	if (!selection || selection.isCollapsed) {
		return;
	}
	const text = selection.toString().trim();
	if (text) {
		lastDomSelection = text;
	}
}

/**
 * 获取最近活跃编辑器/文档中的选中文本。
 * 插件面板位于侧栏，点击按钮时活跃视图已是插件自身，
 * 因此不能依赖 getActiveViewOfType(MarkdownView)：
 * 1. Markdown 视图：取最近活跃主区叶子的编辑器选区
 *    （CodeMirror 失焦后仍保有选区，编辑器选区为空即视为没有选中文本）；
 * 2. PDF 等其他视图：回退到 selectionchange 缓存的 DOM 选区。
 * @param app Obsidian App 实例
 * @returns 去除首尾空白后的选中文本；无选区时返回 null
 */
export function getActiveSelection(app: App): string | null {
	const leaf = app.workspace.getMostRecentLeaf();
	const view = leaf?.view;
	if (view instanceof MarkdownView) {
		const selection = view.editor.getSelection().trim();
		return selection || null;
	}
	return lastDomSelection;
}

/**
 * 在多行文本输入框的光标处插入文本（保留原选区内容，插入后焦点回到输入框）。
 * 供词典查询面板把英文候选词写入翻译输入框使用。
 * @param textarea 目标输入框
 * @param text 要插入的文本（自动追加尾随空格，符合英文书写习惯）
 */
export function insertTextAtCursor(
	textarea: HTMLTextAreaElement,
	text: string,
): void {
	const insertion = `${text.trim()} `;
	const start = textarea.selectionStart ?? textarea.value.length;
	const end = textarea.selectionEnd ?? start;
	textarea.value =
		textarea.value.slice(0, start) +
		insertion +
		textarea.value.slice(end);
	// 光标移到插入文本末尾，便于用户继续输入
	const caret = start + insertion.length;
	textarea.setSelectionRange(caret, caret);
	textarea.focus();
}
