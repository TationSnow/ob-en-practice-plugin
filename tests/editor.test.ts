import { describe, expect, it, vi } from 'vitest';
import { type App } from 'obsidian';
import { getActiveSelection } from '../src/utils/editor';

describe('getActiveSelection', () => {
	it('返回当前笔记的选中文本并去除首尾空白', () => {
		const getActiveViewOfType = vi.fn().mockReturnValue({
			editor: {
				getSelection: () => '  hello world  ',
			},
		});
		const app = {
			workspace: { getActiveViewOfType },
		} as unknown as App;

		expect(getActiveSelection(app)).toBe('hello world');
	});

	it('没有选区或不在笔记中时返回 null', () => {
		const getActiveViewOfType = vi.fn().mockReturnValue(null);
		const app = {
			workspace: { getActiveViewOfType },
		} as unknown as App;

		expect(getActiveSelection(app)).toBeNull();
	});

	it('选中内容只有空白时返回 null', () => {
		const getActiveViewOfType = vi.fn().mockReturnValue({
			editor: {
				getSelection: () => '   ',
			},
		});
		const app = {
			workspace: { getActiveViewOfType },
		} as unknown as App;

		expect(getActiveSelection(app)).toBeNull();
	});
});
