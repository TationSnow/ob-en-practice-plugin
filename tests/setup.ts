import { Notice, Setting } from 'obsidian';
import { vi } from 'vitest';

/**
 * 最小 DOM 桩：在 Node 环境模拟 Obsidian 的元素创建接口。
 * 供 Modal / PluginSettingTab 桩与 UI 测试共用（不依赖 jsdom）。
 * 通过 vi.hoisted 定义，保证 mock 工厂可以引用。
 */
const { StubElement } = vi.hoisted(() => {
	class StubElement {
		children: StubElement[] = [];
		classes = new Set<string>();
		text = '';
		tag = 'div';
		attrs: Record<string, string> = {};
		listeners: Record<string, (event?: unknown) => void> = {};
		value = '';

		createEl(
			tag: string,
			opts?: {
				text?: string;
				cls?: string;
				attr?: Record<string, string>;
			},
		): StubElement {
			const el = new StubElement();
			el.tag = tag;
			if (opts?.text) el.text = opts.text;
			if (opts?.cls) el.addClass(opts.cls);
			if (opts?.attr) {
				for (const [key, val] of Object.entries(opts.attr)) {
					el.attrs[key] = val;
				}
			}
			this.children.push(el);
			return el;
		}

		createDiv(cls?: string): StubElement {
			const el = new StubElement();
			if (cls) el.addClass(cls);
			this.children.push(el);
			return el;
		}

		createSpan(
			clsOrOpts?: string | { text?: string; cls?: string },
		): StubElement {
			const el = new StubElement();
			el.tag = 'span';
			if (typeof clsOrOpts === 'string') {
				el.addClass(clsOrOpts);
			} else if (clsOrOpts) {
				if (clsOrOpts.text) el.text = clsOrOpts.text;
				if (clsOrOpts.cls) el.addClass(clsOrOpts.cls);
			}
			this.children.push(el);
			return el;
		}

		addClass(cls: string): this {
			this.classes.add(cls);
			return this;
		}

		removeClass(cls: string): this {
			this.classes.delete(cls);
			return this;
		}

		setText(text: string): this {
			this.text = text;
			return this;
		}

		setAttr(key: string, value: string): this {
			this.attrs[key] = value;
			return this;
		}

		empty(): void {
			this.children = [];
		}

		addEventListener(type: string, callback: (event?: unknown) => void): void {
			this.listeners[type] = callback;
		}

		/** 触发已注册的事件（测试用） */
		trigger(type: string): void {
			this.listeners[type]?.();
		}

		/** 按谓词查找子孙元素（测试用） */
		queryAll(predicate: (el: StubElement) => boolean): StubElement[] {
			const found: StubElement[] = [];
			for (const child of this.children) {
				if (predicate(child)) found.push(child);
				found.push(...child.queryAll(predicate));
			}
			return found;
		}
	}
	return { StubElement };
});

export { StubElement };

/** StubElement 实例类型（vi.hoisted 返回的是类值，类型标注请使用本别名） */
export type StubElementLike = InstanceType<typeof StubElement>;

// obsidian 包只有类型没有运行时实现，测试中提供最小可用的桌面端 Platform
vi.mock('obsidian', () => ({
	Platform: { isDesktop: true },
	MarkdownView: class MarkdownView {},
	Modal: class Modal {
		app: unknown;
		titleEl: InstanceType<typeof StubElement>;
		contentEl: InstanceType<typeof StubElement>;

		constructor(app: unknown) {
			this.app = app;
			this.titleEl = new StubElement();
			this.contentEl = new StubElement();
		}

		// 模拟真实行为：open 触发 onOpen 生命周期，close 触发 onClose
		open(): void {
			(this as { onOpen?: () => void }).onOpen?.();
		}
		close(): void {
			(this as { onClose?: () => void }).onClose?.();
		}
	},
	Notice: class Notice {
		/** 全部通知消息（测试断言用，测试内自行清空） */
		static messages: string[] = [];
		message: string;

		constructor(message: string, _timeout?: number) {
			this.message = message;
			Notice.messages.push(message);
		}

		hide(): void {}
	},
	PluginSettingTab: class PluginSettingTab {
		app: unknown;
		plugin: unknown;
		containerEl: InstanceType<typeof StubElement>;

		constructor(app: unknown, plugin: unknown) {
			this.app = app;
			this.plugin = plugin;
			this.containerEl = new StubElement();
		}
	},
	Setting: class Setting {
		/** 全部 Setting 实例（测试断言用，测试内自行清空） */
		static instances: SettingLike[] = [];

		name = '';
		desc = '';
		components = {
			texts: [] as TextComponentLike[],
			toggles: [] as ToggleComponentLike[],
			dropdowns: [] as DropdownComponentLike[],
			buttons: [] as ButtonComponentLike[],
			extraButtons: [] as ExtraButtonComponentLike[],
		};

		constructor(_containerEl: unknown) {
			Setting.instances.push(this);
			// 在桩容器中留下标记节点，使测试可以在 DOM 层面统计渲染行数
			// （模拟真实 Setting 会向容器追加 DOM 的行为）
			const container = _containerEl as
				| { children?: unknown[] }
				| null
				| undefined;
			if (container && Array.isArray(container.children)) {
				const marker = new StubElement();
				marker.tag = 'setting-row';
				container.children.push(marker);
			}
		}

		setName(name: string): this {
			this.name = name;
			return this;
		}

		setDesc(desc: string): this {
			this.desc = desc;
			return this;
		}

		setHeading(): this {
			return this;
		}

		setDisabled(_disabled: boolean): this {
			return this;
		}

		setClass(_cls: string): this {
			return this;
		}

		addText(callback: (text: TextComponentLike) => unknown): this {
			const comp: TextComponentLike = {
				value: '',
				inputEl: new StubElement(),
				getValue: () => comp.value,
				setValue: (value: string) => {
					comp.value = value;
					return comp;
				},
				setPlaceholder: () => comp,
				onChange: (cb) => {
					comp.change = cb;
					return comp;
				},
			};
			this.components.texts.push(comp);
			callback(comp);
			return this;
		}

		addToggle(callback: (toggle: ToggleComponentLike) => unknown): this {
			const comp: ToggleComponentLike = {
				value: false,
				setValue: (value: boolean) => {
					comp.value = value;
					return comp;
				},
				onChange: (cb) => {
					comp.change = cb;
					return comp;
				},
			};
			this.components.toggles.push(comp);
			callback(comp);
			return this;
		}

		addDropdown(callback: (dropdown: DropdownComponentLike) => unknown): this {
			const comp: DropdownComponentLike = {
				options: {},
				value: '',
				addOption: (value: string, label: string) => {
					comp.options[value] = label;
					return comp;
				},
				setValue: (value: string) => {
					comp.value = value;
					return comp;
				},
				onChange: (cb) => {
					comp.change = cb;
					return comp;
				},
			};
			this.components.dropdowns.push(comp);
			callback(comp);
			return this;
		}

		addButton(callback: (button: ButtonComponentLike) => unknown): this {
			const comp: ButtonComponentLike = {
				text: '',
				click: undefined,
				setButtonText: (text: string) => {
					comp.text = text;
					return comp;
				},
				setCta: () => comp,
				onClick: (cb) => {
					comp.click = cb;
					return comp;
				},
			};
			this.components.buttons.push(comp);
			callback(comp);
			return this;
		}

		addExtraButton(
			callback: (button: ExtraButtonComponentLike) => unknown,
		): this {
			const comp: ExtraButtonComponentLike = {
				icon: '',
				setIcon: (icon: string) => {
					comp.icon = icon;
					return comp;
				},
				setTooltip: () => comp,
				onClick: (cb) => {
					comp.click = cb;
					return comp;
				},
			};
			this.components.extraButtons.push(comp);
			callback(comp);
			return this;
		}
	},
	setIcon: vi.fn(),
}));

/** Setting 桩的文本组件形状 */
export interface TextComponentLike {
	value: string;
	inputEl: InstanceType<typeof StubElement>;
	getValue(): string;
	setValue(value: string): unknown;
	setPlaceholder(value: string): unknown;
	onChange(callback: (value: string) => unknown): unknown;
	change?: (value: string) => unknown;
}

/** Setting 桩的开关组件形状 */
export interface ToggleComponentLike {
	value: boolean;
	setValue(value: boolean): unknown;
	onChange(callback: (value: boolean) => unknown): unknown;
	change?: (value: boolean) => unknown;
}

/** Setting 桩的下拉组件形状 */
export interface DropdownComponentLike {
	options: Record<string, string>;
	value: string;
	addOption(value: string, label: string): unknown;
	setValue(value: string): unknown;
	onChange(callback: (value: string) => unknown): unknown;
	change?: (value: string) => unknown;
}

/** Setting 桩的按钮组件形状 */
export interface ButtonComponentLike {
	text: string;
	click?: () => unknown;
	setButtonText(text: string): unknown;
	setCta(): unknown;
	onClick(callback: () => unknown): unknown;
}

/** Setting 桩的扩展按钮组件形状 */
export interface ExtraButtonComponentLike {
	icon: string;
	click?: () => unknown;
	setIcon(icon: string): unknown;
	setTooltip(tooltip: string): unknown;
	onClick(callback: () => unknown): unknown;
}

/** Setting 桩实例形状（测试断言用） */
export interface SettingLike {
	name: string;
	desc: string;
	components: {
		texts: TextComponentLike[];
		toggles: ToggleComponentLike[];
		dropdowns: DropdownComponentLike[];
		buttons: ButtonComponentLike[];
		extraButtons: ExtraButtonComponentLike[];
	};
}

/** 读取全部 Setting 桩实例（测试断言用） */
export function getSettingInstances(): SettingLike[] {
	return (Setting as unknown as { instances: SettingLike[] }).instances;
}

/** 清空 Setting 与 Notice 的录制（beforeEach 用） */
export function resetRecordedMocks(): void {
	(Setting as unknown as { instances: SettingLike[] }).instances = [];
	const NoticeCtor = Notice as unknown as { messages: string[] };
	NoticeCtor.messages = [];
}

/** 读取全部 Notice 消息（测试断言用） */
export function getNoticeMessages(): string[] {
	return (Notice as unknown as { messages: string[] }).messages;
}
