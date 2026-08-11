import { describe, expect, it, vi } from 'vitest';
import {
	createSegmentedControl,
	createTabBar,
} from '../src/ui/controls';

/** 最小 DOM 桩，用于在 Node 环境验证控件逻辑 */
class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';
	tag = 'div';
	attrs: Record<string, string> = {};
	listeners: Record<
		string,
		(event?: { key?: string; preventDefault?: () => void }) => void
	> = {};
	focused = false;

	createEl(
		tag: string,
		opts?: { text?: string; attr?: Record<string, string | number> },
	): FakeEl {
		const el = new FakeEl();
		el.tag = tag;
		if (opts?.text) el.text = opts.text;
		if (opts?.attr) {
			for (const [key, value] of Object.entries(opts.attr)) {
				el.attrs[key] = String(value);
			}
		}
		this.children.push(el);
		return el;
	}

	createDiv(cls?: string): FakeEl {
		const el = new FakeEl();
		el.tag = 'div';
		if (cls) el.addClass(cls);
		this.children.push(el);
		return el;
	}

	createSpan(opts?: { cls?: string; text?: string }): FakeEl {
		const el = new FakeEl();
		el.tag = 'span';
		if (opts?.cls) el.addClass(opts.cls);
		if (opts?.text) el.text = opts.text;
		this.children.push(el);
		return el;
	}

	addClass(cls: string): void {
		this.classes.add(cls);
	}

	removeClass(cls: string): void {
		this.classes.delete(cls);
	}

	toggleClass(cls: string, force?: boolean): void {
		if (force === true) this.addClass(cls);
		else if (force === false) this.removeClass(cls);
		else if (this.classes.has(cls)) this.removeClass(cls);
		else this.addClass(cls);
	}

	setAttr(key: string, value: string | number | boolean): void {
		this.attrs[key] = String(value);
	}

	removeAttribute(key: string): void {
		delete this.attrs[key];
	}

	getAttribute(key: string): string | null {
		return this.attrs[key] ?? null;
	}

	setText(text: string): void {
		this.text = text;
	}

	empty(): void {
		this.children = [];
	}

	addEventListener(
		type: string,
		callback: (event?: { key?: string; preventDefault?: () => void }) => void,
	): void {
		this.listeners[type] = callback;
	}

	focus(): void {
		this.focused = true;
	}

	click(): void {
		this.listeners.click?.();
	}

	keydown(key: string): void {
		this.listeners.keydown?.({
			key,
			preventDefault: () => {},
		});
	}
}

describe('createSegmentedControl', () => {
	it('setValue 更新激活项并触发回调', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		const control = createSegmentedControl(root as unknown as HTMLElement, {
			ariaLabel: '题目难度',
			value: 'cet4',
			options: [
				{ value: 'cet4', label: '四级' },
				{ value: 'cet6', label: '六级' },
				{ value: 'postgraduate', label: '考研' },
			],
			onChange,
		});

		control.setValue('cet6');

		expect(onChange).toHaveBeenCalledWith('cet6');
		expect(control.getValue()).toBe('cet6');
		const controlEl = root.children[0];
		expect(controlEl?.attrs.role).toBe('radiogroup');
		expect(controlEl?.children[0]?.attrs['aria-checked']).toBe('false');
		expect(controlEl?.children[1]?.attrs['aria-checked']).toBe('true');
	});

	it('点击按钮可切换选项', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		createSegmentedControl(root as unknown as HTMLElement, {
			ariaLabel: '题目难度',
			value: 'cet4',
			options: [
				{ value: 'cet4', label: '四级' },
				{ value: 'cet6', label: '六级' },
				{ value: 'postgraduate', label: '考研' },
			],
			onChange,
		});

		const controlEl = root.children[0];
		controlEl?.children[2]?.click();

		expect(onChange).toHaveBeenCalledWith('postgraduate');
		expect(controlEl?.children[2]?.attrs['aria-checked']).toBe('true');
	});

	it('方向键可移动焦点并切换选项', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		createSegmentedControl(root as unknown as HTMLElement, {
			ariaLabel: '题目难度',
			value: 'cet4',
			options: [
				{ value: 'cet4', label: '四级' },
				{ value: 'cet6', label: '六级' },
				{ value: 'postgraduate', label: '考研' },
			],
			onChange,
		});

		const controlEl = root.children[0];
		controlEl?.children[0]?.keydown('ArrowRight');

		expect(onChange).toHaveBeenCalledWith('cet6');
		expect(controlEl?.children[1]?.focused).toBe(true);
	});
});

describe('createTabBar', () => {
	it('setActive 更新页签状态并触发回调', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		const tabBar = createTabBar(
			root as unknown as HTMLElement,
			[
				{ id: 'grammar', label: '语法分析' },
				{ id: 'writing', label: '翻译写作' },
			],
			0,
			onChange,
		);

		tabBar.setActive(1);

		expect(onChange).toHaveBeenCalledWith(1);
		const tabBarEl = root.children[0];
		expect(tabBarEl?.children[0]?.attrs['aria-selected']).toBe('false');
		expect(tabBarEl?.children[1]?.attrs['aria-selected']).toBe('true');
		expect(tabBarEl?.children[1]?.attrs.tabindex).toBe('0');
	});

	it('点击页签可切换激活项', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		createTabBar(
			root as unknown as HTMLElement,
			[
				{ id: 'grammar', label: '语法分析' },
				{ id: 'writing', label: '翻译写作' },
			],
			0,
			onChange,
		);

		const tabBarEl = root.children[0];
		tabBarEl?.children[1]?.click();

		expect(onChange).toHaveBeenCalledWith(1);
	});

	it('方向键可切换页签', () => {
		const root = new FakeEl();
		const onChange = vi.fn();
		createTabBar(
			root as unknown as HTMLElement,
			[
				{ id: 'grammar', label: '语法分析' },
				{ id: 'writing', label: '翻译写作' },
			],
			0,
			onChange,
		);

		const tabBarEl = root.children[0];
		tabBarEl?.children[0]?.keydown('ArrowRight');

		expect(onChange).toHaveBeenCalledWith(1);
		expect(tabBarEl?.children[1]?.focused).toBe(true);
	});
});
