import { describe, expect, it } from 'vitest';
import { formatDebugDetail } from '../src/ai/debug-log';

describe('formatDebugDetail', () => {
	it('默认不截断长文本', () => {
		const longText = 'x'.repeat(5000);
		const result = formatDebugDetail(longText);
		expect(result).toBe(JSON.stringify(longText));
		expect(result).not.toContain('...');
	});

	it('对象 JSON 完整输出', () => {
		const value = { text: 'long '.repeat(800) };
		const result = formatDebugDetail(value);
		expect(result).toBe(JSON.stringify(value));
	});

	it('显式传入 maxLength 时仍可截断', () => {
		expect(formatDebugDetail('1234567890', 5)).toBe('"1234...');
	});
});
