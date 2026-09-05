import { describe, expect, it } from 'vitest';
import { renderDebugEntries } from '../src/ui/debug-panel';
import type { AiDebugEntry } from '../src/ai/debug-log';

/** 最小 DOM 桩，用于在 Node 环境验证调试日志渲染 */
class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';
	tag = 'div';
	attrs: Record<string, string> = {};
	listeners: Record<string, () => void> = {};
	open = false;

	createEl(
		tag: string,
		opts?: {
			text?: string;
			attr?: Record<string, string>;
		},
	): FakeEl {
		const el = new FakeEl();
		el.tag = tag;
		if (opts?.text) el.text = opts.text;
		if (opts?.attr) {
			for (const [key, value] of Object.entries(opts.attr)) {
				el.attrs[key] = value;
			}
		}
		this.children.push(el);
		return el;
	}

	createDiv(cls?: string): FakeEl {
		const el = new FakeEl();
		if (cls) el.addClass(cls);
		this.children.push(el);
		return el;
	}

	createSpan(cls?: string): FakeEl {
		const el = new FakeEl();
		el.tag = 'span';
		if (cls) el.addClass(cls);
		this.children.push(el);
		return el;
	}

	addClass(cls: string): void {
		this.classes.add(cls);
	}

	setText(text: string): void {
		this.text = text;
	}

	empty(): void {
		this.children = [];
	}

	setAttr(key: string, value: string): void {
		this.attrs[key] = value;
	}

	addEventListener(type: string, callback: () => void): void {
		this.listeners[type] = callback;
	}

	/** 按标签查找直接子元素 */
	findByTag(tag: string): FakeEl | undefined {
		return this.children.find((child) => child.tag === tag);
	}
}

/** 构造一条错误日志 */
function createEntry(detail?: string): AiDebugEntry {
	return {
		id: 1,
		timestamp: 0,
		requestId: 'request-1',
		feature: 'grammarResult',
		phase: 'error',
		message: '输出未通过 schema 校验',
		detail,
	};
}

describe('renderDebugEntries', () => {
	it('长详情折叠为可展开结构，完整内容保留不截断', () => {
		const long = 'x'.repeat(500);
		const root = new FakeEl();
		renderDebugEntries(root as unknown as HTMLElement, [createEntry(long)]);

		// 条目行 → details 折叠结构 → summary + 完整 pre
		const row = root.children[0] as FakeEl;
		const details = row.findByTag('details');
		expect(details).toBeDefined();
		expect(details?.classes.has('en-debug-entry-collapse')).toBe(true);
		expect(details?.findByTag('summary')?.text).toBe('展开详情');
		expect(details?.findByTag('pre')?.text).toBe(long);
	});

	it('短详情直接完整展示，不折叠', () => {
		const root = new FakeEl();
		renderDebugEntries(root as unknown as HTMLElement, [
			createEntry('短内容'),
		]);

		const row = root.children[0] as FakeEl;
		expect(row.findByTag('pre')?.text).toBe('短内容');
		expect(row.findByTag('details')).toBeUndefined();
	});

	it('无详情时不渲染详情元素', () => {
		const root = new FakeEl();
		renderDebugEntries(root as unknown as HTMLElement, [createEntry()]);

		const row = root.children[0] as FakeEl;
		expect(row.findByTag('pre')).toBeUndefined();
		expect(row.findByTag('details')).toBeUndefined();
	});

	it('切换展开状态时更新摘要文案', () => {
		const long = 'x'.repeat(500);
		const root = new FakeEl();
		renderDebugEntries(root as unknown as HTMLElement, [createEntry(long)]);

		const row = root.children[0] as FakeEl;
		const details = row.findByTag('details') as FakeEl;
		const summary = details.findByTag('summary') as FakeEl;
		// 模拟原生 details 展开事件
		details.open = true;
		details.listeners['toggle']?.();
		expect(summary.text).toBe('收起详情');
		details.open = false;
		details.listeners['toggle']?.();
		expect(summary.text).toBe('展开详情');
	});
});
