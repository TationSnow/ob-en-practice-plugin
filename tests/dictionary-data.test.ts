import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	parseDictionaryText,
	searchEnglishEntries,
	searchInEntries,
} from '../src/dictionary/lookup';

/**
 * 真实数据黄金用例：直读构建产物（src/data/dictionary.txt，已提交入库），
 * 验证清洗质量与查询链路的端到端正确性。
 * 数据模块（dictionary-data.ts）依赖 esbuild text loader，测试中不导入，
 * 改用 node:fs 读取同一产物，覆盖完全相同的解析与查询路径。
 */

const dictionaryPath = fileURLToPath(
	new URL('../src/data/dictionary.txt', import.meta.url),
);
const text = readFileSync(dictionaryPath, 'utf8');
const entries = parseDictionaryText(text);

describe('真实词典数据黄金用例', () => {
	it('数据规模与构建统计一致（约 3.5 万词）', () => {
		expect(entries.length).toBeGreaterThan(30_000);
		expect(entries.length).toBeLessThan(50_000);
	});

	it('「忘记」命中 forget（动词词性与释义）', () => {
		const matches = searchInEntries('忘记', entries);
		const forget = matches.find((match) => match.word === 'forget');
		expect(forget).toBeDefined();
		expect(forget?.matchType).toBe(0);
		expect(
			forget?.senses.some(
				(sense) => sense.p === 'vt.' && sense.z.includes('忘记'),
			),
		).toBe(true);
	});

	it('「高兴」通过前缀命中 glad（happy 的释义不含「高兴」，不应命中——词典确定性）', () => {
		const words = searchInEntries('高兴', entries).map(
			(match) => match.word,
		);
		expect(words).toContain('glad');
		expect(words).not.toContain('happy');
	});

	it('「政府」命中 government（名词释义）', () => {
		const government = searchInEntries('政府', entries).find(
			(match) => match.word === 'government',
		);
		expect(government).toBeDefined();
		expect(government?.senses[0]?.p).toBe('n.');
		expect(government?.senses[0]?.z).toContain('政府');
	});

	it('领域缩写噪声不产生误命中（查询「管理」不出现 AM 的 [计] 释义）', () => {
		// AM 的 [计] 释义行（含「存取管理程序」）在清洗阶段被丢弃
		const am = entries.find((entry) => entry.w === 'AM');
		expect(am).toBeDefined();
		for (const sense of am?.s ?? []) {
			expect(sense.z).not.toContain('存取管理程序');
		}
	});

	it('查询性能冒烟：全库线性扫描应在毫秒级完成', () => {
		const startedAt = Date.now();
		searchInEntries('快乐', entries);
		const elapsed = Date.now() - startedAt;
		expect(elapsed).toBeLessThan(2000);
	});

	it('英文模糊容错：goverment（缺 n）命中 government', () => {
		const gov = searchEnglishEntries('goverment', entries).find(
			(match) => match.word === 'government',
		);
		expect(gov?.matchType).toBe(4);
		expect(gov?.senses[0]?.z).toContain('政府');
	});

	it('英文通配符：l*n 命中 lean 与 location（骨架匹配）', () => {
		const words = searchEnglishEntries('l*n', entries, { limit: 20 }).map(
			(match) => match.word,
		);
		expect(words).toContain('lean');
		expect(words).toContain('location');
	});

	it('英文通配符性能冒烟：通配正则全库扫描在毫秒级完成', () => {
		const startedAt = Date.now();
		const matches = searchEnglishEntries('l*n', entries);
		const elapsed = Date.now() - startedAt;
		expect(matches.length).toBeLessThanOrEqual(20);
		expect(elapsed).toBeLessThan(2000);
	});
});
