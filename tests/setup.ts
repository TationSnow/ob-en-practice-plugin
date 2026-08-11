import { vi } from 'vitest';

// obsidian 包只有类型没有运行时实现，测试中提供最小可用的桌面端 Platform
vi.mock('obsidian', () => ({
	Platform: { isDesktop: true },
	MarkdownView: class MarkdownView {},
}));
