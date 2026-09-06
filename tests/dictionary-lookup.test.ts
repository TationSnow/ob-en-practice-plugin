import { describe, expect, it } from 'vitest';
import { parseDictionaryText, searchInEntries } from '../src/dictionary/lookup';
import type { DictionaryEntry } from '../src/dictionary/types';

/** 构造词典条目 */
function createEntry(
	overrides: Partial<DictionaryEntry> & { w: string },
): DictionaryEntry {
	return {
		s: [],
		...overrides,
	};
}

/** 高兴场景的固定条目集 */
const FIXTURES: DictionaryEntry[] = [
	createEntry({
		w: 'happy',
		ph: "'hæpi",
		s: [{ p: 'a.', z: '快乐的, 幸福的, 愉快的, 恰当的' }],
		tg: 'zk gk',
		b: 777,
		f: 747,
		c: 4,
	}),
	createEntry({
		w: 'glad',
		s: [{ p: 'a.', z: '高兴的, 乐意的' }],
		b: 1500,
	}),
	createEntry({
		w: 'cheerful',
		s: [{ p: 'a.', z: '快乐的, 兴高采烈的' }],
		f: 9000,
	}),
	createEntry({
		w: 'forget',
		s: [
			{ p: 'vt.', z: '忘记, 忽略, 忘' },
			{ p: 'vi.', z: '忘记' },
		],
		b: 813,
	}),
	createEntry({
		w: 'government',
		s: [
			{ p: 'n.', z: '政府, 内阁' },
			{ p: 'n.', z: '管理, 支配' },
		],
		b: 124,
	}),
];

describe('parseDictionaryText', () => {
	it('逐行解析 JSONL 并跳过空行', () => {
		const text = [
			JSON.stringify({ w: 'happy', s: [{ p: 'a.', z: '快乐的' }] }),
			'',
			JSON.stringify({ w: 'glad', s: [{ p: 'a.', z: '高兴的' }] }),
		].join('\n');
		const entries = parseDictionaryText(text);
		expect(entries.map((entry) => entry.w)).toEqual(['happy', 'glad']);
	});

	it('损坏行被跳过而不拖垮整库', () => {
		const text = [
			JSON.stringify({ w: 'happy', s: [] }),
			'{broken json',
			JSON.stringify({ w: 'glad', s: [] }),
		].join('\n');
		expect(parseDictionaryText(text).map((entry) => entry.w)).toEqual([
			'happy',
			'glad',
		]);
	});
});

describe('searchInEntries', () => {
	it('空查询与纯空白查询返回空结果', () => {
		expect(searchInEntries('', FIXTURES)).toEqual([]);
		expect(searchInEntries('   ', FIXTURES)).toEqual([]);
	});

	it('释义精确命中优先（matchType 0）', () => {
		const matches = searchInEntries('忘记', FIXTURES);
		expect(matches[0]?.word).toBe('forget');
		expect(matches[0]?.matchType).toBe(0);
		// 命中的词性释义组完整展示，且命中的组排在最前
		expect(matches[0]?.senses[0]).toEqual({ p: 'vt.', z: '忘记, 忽略, 忘' });
		expect(matches[0]?.senses).toHaveLength(2);
	});

	it('前缀命中（如「高兴」命中「高兴的」→ glad）排在包含命中之前', () => {
		const matches = searchInEntries('高兴', FIXTURES);
		expect(matches[0]?.word).toBe('glad');
		expect(matches[0]?.matchType).toBe(1);
		// cheerful 的「兴高采烈的」包含「高兴」以外的子串……「采烈的」不含；
		// 但「快乐的」不包含「高兴」，happy 不应命中
		expect(matches.map((match) => match.word)).not.toContain('happy');
	});

	it('包含命中兜底（如「快乐」同时命中 happy 与 cheerful 的释义）', () => {
		const matches = searchInEntries('快乐', FIXTURES);
		const words = matches.map((match) => match.word);
		expect(words).toContain('happy');
		expect(words).toContain('cheerful');
		// 同为包含命中时按词频排名升序（happy bnc 777 优于 cheerful frq 9000）
		expect(words[0]).toBe('happy');
	});

	it('同词多义组聚合为一条候选', () => {
		const matches = searchInEntries('政府', FIXTURES);
		expect(matches).toHaveLength(1);
		expect(matches[0]?.word).toBe('government');
		expect(matches[0]?.senses).toHaveLength(2);
	});

	it('按 limit 截断结果数量', () => {
		const many: DictionaryEntry[] = Array.from({ length: 30 }, (_, index) =>
			createEntry({
				w: `word${index}`,
				s: [{ p: 'n.', z: '政府' }],
				b: index + 1,
			}),
		);
		expect(searchInEntries('政府', many)).toHaveLength(20);
		expect(searchInEntries('政府', many, { limit: 5 })).toHaveLength(5);
	});

	it('未命中返回空数组', () => {
		expect(searchInEntries('不存在的释义', FIXTURES)).toEqual([]);
	});
});
