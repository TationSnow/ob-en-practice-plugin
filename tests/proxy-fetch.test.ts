import { describe, expect, it } from 'vitest';
import {
	createProxyFetch,
	formatProxyAddress,
} from '../src/ai/proxy-fetch';

describe('createProxyFetch', () => {
	it('有效代理地址返回 fetch 函数', () => {
		const proxyFetch = createProxyFetch('http://127.0.0.1:7897');

		expect(proxyFetch).toBeTypeOf('function');
	});

	it('无效代理地址返回抛出明确错误的函数', async () => {
		const proxyFetch = createProxyFetch('不是有效地址');

		expect(proxyFetch).toBeTypeOf('function');
		await expect(proxyFetch!('https://example.com')).rejects.toThrow(
			'代理地址无效',
		);
	});
});

describe('formatProxyAddress', () => {
	it('隐藏代理地址中的用户名和密码', () => {
		const redacted = formatProxyAddress('http://user:pass@127.0.0.1:7897');

		expect(redacted).toContain('***');
		expect(redacted).not.toContain('user');
		expect(redacted).not.toContain('pass');
	});

	it('无效地址原样返回', () => {
		expect(formatProxyAddress('不是有效地址')).toBe('不是有效地址');
	});
});
