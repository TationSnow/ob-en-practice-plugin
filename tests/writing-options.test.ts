import { describe, expect, it, vi } from 'vitest';
import {
	addTheme,
	createRandomSeed,
	hasTheme,
	normalizeThemeName,
	removeTheme,
	renameTheme,
	resolveSelectedTheme,
	RANDOM_THEME,
} from '../src/utils/writing-options';

describe('normalizeThemeName', () => {
	it('去除首尾空白并合并连续空白', () => {
		expect(normalizeThemeName('  环保  生活  ')).toBe('环保 生活');
	});
});

describe('addTheme / hasTheme / renameTheme / removeTheme', () => {
	it('新增主题自动去重且忽略大小写', () => {
		expect(addTheme(['环保'], '环保')).toEqual(['环保']);
		expect(addTheme(['环保'], ' 环保 ')).toEqual(['环保']);
		expect(addTheme(['环保'], 'ENVIRONMENT')).toEqual([
			'环保',
			'ENVIRONMENT',
		]);
		expect(addTheme(['环保'], ' 环保 ')).toEqual(['环保']);
		expect(addTheme(['环保'], '   ')).toEqual(['环保']);
	});

	it('重命名主题时保留顺序并阻止重名', () => {
		expect(
			renameTheme(['环保', '科技'], '环保', '环境'),
		).toEqual(['环境', '科技']);
		expect(renameTheme(['环保', '科技'], '环保', '科技')).toEqual([
			'环保',
			'科技',
		]);
		expect(renameTheme(['环保', '科技'], '环保', '  ')).toEqual([
			'环保',
			'科技',
		]);
	});

	it('删除主题仅移除目标项', () => {
		expect(removeTheme(['环保', '科技'], '环保')).toEqual(['科技']);
		expect(removeTheme(['环保'], '不存在')).toEqual(['环保']);
	});

	it('hasTheme 忽略大小写且空名称返回 false', () => {
		expect(hasTheme(['环保', 'Tech'], 'tech')).toBe(true);
		expect(hasTheme(['环保'], '   ')).toBe(false);
	});
});

describe('resolveSelectedTheme', () => {
	it('没有自定义主题且选中随机时返回 null', () => {
		expect(resolveSelectedTheme(RANDOM_THEME, [])).toBeNull();
	});

	it('选中随机且存在自定义主题时随机挑选一个', () => {
		const random = vi.fn(() => 0.5);
		expect(
			resolveSelectedTheme(RANDOM_THEME, ['环保', '科技'], random),
		).toBe('科技');
	});

	it('选中具体主题时原样返回', () => {
		expect(resolveSelectedTheme('环保', ['环保', '科技'])).toBe('环保');
	});
});

describe('createRandomSeed', () => {
	it('固定随机函数时生成确定种子', () => {
		const seed = createRandomSeed(() => 0.25);
		expect(seed).toMatch(/^seed-/);
		expect(seed).toContain('-');
	});

	it('不传随机函数时每次生成不同种子', () => {
		expect(createRandomSeed()).not.toBe(createRandomSeed());
	});
});
