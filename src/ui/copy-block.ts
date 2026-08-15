import { Notice } from 'obsidian';
import { copyTextToClipboard } from '../utils/clipboard';
import { createIconButton } from './controls';
import { createResultSection } from './sections';

/**
 * 创建带复制按钮的只读文本块。
 * 翻译评估的优化版本与语法改进的改进句子共用此组件。
 * @param container 父容器
 * @param title 区块标题
 * @param text 要展示和复制的文本
 * @returns 区块内容容器
 */
export function createCopyableText(
	container: HTMLElement,
	title: string,
	text: string,
): HTMLElement {
	const content = createResultSection(container, title);
	const box = content.createDiv('en-improved-text');
	box.createEl('p', { text });
	createIconButton(box, 'copy', `复制${title}`, () => {
		void copyTextToClipboard(text)
			.then(() => new Notice(`已复制${title}`))
			.catch((err: unknown) => {
				const message =
					err instanceof Error ? err.message : String(err);
				new Notice(`复制失败：${message}`);
			});
	});
	return content;
}
