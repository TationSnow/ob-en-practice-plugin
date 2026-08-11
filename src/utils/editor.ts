import { type App, MarkdownView } from 'obsidian';

/**
 * 获取当前活跃 Markdown 笔记中的选中文本。
 * @param app Obsidian App 实例
 * @returns 去除首尾空白后的选中文本；无选区或不在笔记中时返回 null
 */
export function getActiveSelection(app: App): string | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const selection = view?.editor.getSelection();
	const trimmed = selection?.trim();
	return trimmed ? trimmed : null;
}
