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
