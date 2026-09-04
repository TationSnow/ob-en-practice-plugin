import { vi } from 'vitest';

// obsidian 包只有类型没有运行时实现，测试中提供最小可用的桌面端 Platform
vi.mock('obsidian', () => ({
	Platform: { isDesktop: true },
	MarkdownView: class MarkdownView {},
	Modal: class Modal {
		app: unknown;
		titleEl: HTMLElement;
		contentEl: HTMLElement;

		constructor(app: unknown) {
			this.app = app;
			this.titleEl = document.createElement('div');
			this.contentEl = document.createElement('div');
		}

		open(): void {}
		close(): void {}
	},
	Notice: class Notice {
		constructor(_message: string) {}
	},
	Setting: class Setting {
		constructor(_containerEl: HTMLElement) {}
		setName(_name: string): this {
			return this;
		}
		setDesc(_desc: string): this {
			return this;
		}
		addText(
			_callback: (text: {
				setPlaceholder: (_value: string) => unknown;
				getValue: () => string;
			}) => unknown,
		): this {
			return this;
		}
		addButton(
			_callback: (button: {
				setButtonText: (_text: string) => unknown;
				setCta: () => unknown;
				onClick: (
					callback: () => Promise<void>,
				) => unknown;
			}) => unknown,
		): this {
			return this;
		}
	},
	setIcon: vi.fn(),
}));
