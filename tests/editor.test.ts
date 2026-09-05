import { describe, expect, it } from 'vitest';
import { type App, MarkdownView, type WorkspaceLeaf } from 'obsidian';
import {
	getActiveSelection,
	trackDomSelection,
} from '../src/utils/editor';

/** 构造带选区的 Markdown 视图叶子 */
function createMarkdownLeaf(selection: string): { view: MarkdownView } {
	// 测试 mock 的 MarkdownView 构造器忽略参数，这里仅为满足真实类型签名
	const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {
		editor: { getSelection: () => selection },
	});
	return { view };
}

/** 构造非 Markdown 视图叶子（如 PDF 阅读器） */
function createPdfLeaf(): { view: unknown } {
	return { view: { getViewType: () => 'pdf' } };
}

/** 用缓存记录一次 DOM 选区，模拟 selectionchange 事件触发 */
function cacheDomSelection(text: string): void {
	trackDomSelection({
		getSelection: () => ({
			isCollapsed: text === '',
			toString: () => text,
		}),
	} as unknown as Document);
}

// 注意：选区缓存是模块级状态，依赖“无缓存”的用例必须放在所有缓存写入用例之前
describe('getActiveSelection', () => {
	it('工作区没有叶子时返回 null', () => {
		const app = {
			workspace: { getMostRecentLeaf: () => null },
		} as unknown as App;

		expect(getActiveSelection(app)).toBeNull();
	});

	it('没有缓存且非 Markdown 视图时返回 null', () => {
		const leaf = createPdfLeaf();
		const app = {
			workspace: { getMostRecentLeaf: () => leaf },
		} as unknown as App;

		expect(getActiveSelection(app)).toBeNull();
	});

	it('最近活跃叶子是 Markdown 视图时返回其编辑器选区并去除首尾空白', () => {
		// 点击插件按钮后活跃视图已是插件自身，必须依赖“最近活跃叶子”找到编辑器
		const leaf = createMarkdownLeaf('  hello world  ');
		const app = {
			workspace: { getMostRecentLeaf: () => leaf },
		} as unknown as App;

		expect(getActiveSelection(app)).toBe('hello world');
	});

	it('Markdown 编辑器选区为空时直接返回 null，不回退到缓存', () => {
		cacheDomSelection('stale pdf text');
		const leaf = createMarkdownLeaf('   ');
		const app = {
			workspace: { getMostRecentLeaf: () => leaf },
		} as unknown as App;

		expect(getActiveSelection(app)).toBeNull();
	});

	it('最近活跃叶子是 PDF 等非 Markdown 视图时回退到缓存的 DOM 选区', () => {
		cacheDomSelection('  selected pdf text  ');
		const leaf = createPdfLeaf();
		const app = {
			workspace: { getMostRecentLeaf: () => leaf },
		} as unknown as App;

		expect(getActiveSelection(app)).toBe('selected pdf text');
	});

	it('空白菜区不会覆盖缓存', () => {
		// 点击按钮本身会清空 DOM 选区且 selectionchange 早于 click 触发，
		// 因此空选区必须忽略，保留最近一次有效选区
		cacheDomSelection('');
		const leaf = createPdfLeaf();
		const app = {
			workspace: { getMostRecentLeaf: () => leaf },
		} as unknown as App;

		expect(getActiveSelection(app)).toBe('selected pdf text');
	});
});
