import { describe, expect, it } from 'vitest';
import {
	buildFormLookup,
	formatFormLabel,
	formatWordForms,
	isChineseQuery,
	parseDictionaryText,
	parseFormIndexText,
	searchDictionary,
	searchEnglishEntries,
	searchInEntries,
	searchWithFormIndex,
} from '../src/dictionary/lookup';
import type {
	DictionaryEntry,
	FormIndexEntry,
} from '../src/dictionary/types';

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
	createEntry({
		w: 'lean',
		s: [{ p: 'v.', z: '倾斜, 倚靠' }],
		b: 3000,
	}),
	createEntry({
		w: 'loan',
		s: [{ p: 'n.', z: '贷款, 借出' }],
		b: 2500,
	}),
	createEntry({
		w: 'location',
		s: [{ p: 'n.', z: '位置, 地点' }],
		b: 600,
	}),
	createEntry({
		w: 'line',
		s: [{ p: 'n.', z: '线, 行' }],
		b: 400,
	}),
	createEntry({
		w: 'discover',
		s: [{ p: 'v.', z: '发现, 找到' }],
		f: 1200,
	}),
	createEntry({
		w: 'be',
		s: [{ p: 'v.', z: '是, 表示, 在' }],
		b: 2,
		e: 'p:was/3:is/d:been/i:being',
	}),
	createEntry({
		w: 'improve',
		s: [
			{ p: 'vt.', z: '改良, 提高...的价值, 改善, 利用' },
			{ p: 'vi.', z: '变得更好, 增加' },
		],
		b: 903,
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

describe('isChineseQuery（方向自动检测）', () => {
	it('含汉字判为中译英方向', () => {
		expect(isChineseQuery('政府')).toBe(true);
		expect(isChineseQuery('快乐happy')).toBe(true);
	});

	it('纯英文/通配符查询判为英查词方向', () => {
		expect(isChineseQuery('happy')).toBe(false);
		expect(isChineseQuery('l_n')).toBe(false);
		expect(isChineseQuery("fә'get")).toBe(false);
	});
});

describe('searchEnglishEntries（英查词）', () => {
	it('词形精确命中忽略大小写（matchType 0）', () => {
		const matches = searchEnglishEntries('HaPpY', FIXTURES);
		expect(matches[0]?.word).toBe('happy');
		expect(matches[0]?.matchType).toBe(0);
		// 单词命中的候选完整展示其全部词性释义组
		expect(matches[0]?.senses).toEqual(FIXTURES[0]?.s);
	});

	it('前缀命中排在包含命中之前', () => {
		const matches = searchEnglishEntries('govern', FIXTURES);
		expect(matches[0]?.word).toBe('government');
		expect(matches[0]?.matchType).toBe(2);
		// discover 的「发现」释义不含 govern，但 discover 包含子串 govern？不含——不应命中
		expect(matches.map((match) => match.word)).not.toContain('discover');
	});

	it('包含命中兜底', () => {
		const matches = searchEnglishEntries('over', FIXTURES);
		const words = matches.map((match) => match.word);
		expect(words).toContain('government');
		expect(words).toContain('discover');
		// 同为包含命中时按词频排名升序（government bnc 124 优于 discover frq 1200）
		expect(words[0]).toBe('government');
	});

	it('通配符下划线按任意长度匹配（l_n → lean/location 等 l…n 词）', () => {
		const words = searchEnglishEntries('l_n', FIXTURES).map(
			(match) => match.word,
		);
		expect(words).toContain('lean');
		expect(words).toContain('loan');
		expect(words).toContain('location');
		// line 以 e 结尾，不满足 l…n 骨架
		expect(words).not.toContain('line');
		// 全部为通配符命中（matchType 1）
		const matches = searchEnglishEntries('l_n', FIXTURES);
		expect(matches.every((match) => match.matchType === 1)).toBe(true);
		// 同级按词频排名升序（location bnc 600 最靠前）
		expect(words[0]).toBe('location');
	});

	it('通配符问号匹配恰好一个字符（l?an → lean/loan，不含 location）', () => {
		const words = searchEnglishEntries('l?an', FIXTURES).map(
			(match) => match.word,
		);
		expect(words).toContain('lean');
		expect(words).toContain('loan');
		expect(words).not.toContain('location');
	});

	it('模糊命中容错拼写错误（matchType 4）', () => {
		const matches = searchEnglishEntries('happi', FIXTURES);
		const happy = matches.find((match) => match.word === 'happy');
		expect(happy?.matchType).toBe(4);
		// goverment（9 字母，缺一个 n）→ government
		const gov = searchEnglishEntries('goverment', FIXTURES).find(
			(match) => match.word === 'government',
		);
		expect(gov?.matchType).toBe(4);
	});

	it('短查询不启用模糊匹配，避免噪音', () => {
		// bx 与 be 编辑距离 1，但长度 2 不启用模糊；若无该限制 be 会被误召回
		expect(searchEnglishEntries('bx', FIXTURES)).toEqual([]);
	});

	it('匹配类型数值序即排序序：精确先于模糊', () => {
		// be 精确命中（bnc 2），同时 beb/bees 类模糊词不存在时不影响首位
		const matches = searchEnglishEntries('be', FIXTURES);
		expect(matches[0]?.word).toBe('be');
		expect(matches[0]?.matchType).toBe(0);
	});

	it('按 limit 截断', () => {
		const matches = searchEnglishEntries('l', FIXTURES, { limit: 3 });
		expect(matches.length).toBeLessThanOrEqual(3);
	});
});

describe('searchDictionary（方向自动分派）', () => {
	it('中文查询走释义匹配', () => {
		const matches = searchDictionary('政府', FIXTURES);
		expect(matches[0]?.word).toBe('government');
	});

	it('英文查询走单词匹配', () => {
		const matches = searchDictionary('happy', FIXTURES);
		expect(matches[0]?.word).toBe('happy');
		expect(matches[0]?.matchType).toBe(0);
	});
});

describe('formatWordForms（词形变换展示）', () => {
	it('按规范顺序翻译编码为中文标签', () => {
		expect(formatWordForms('p:was/3:is/d:been/i:being')).toBe(
			'过去式 was · 过去分词 been · 现在分词 being · 三单 is',
		);
	});

	it('比较级与最高级', () => {
		expect(formatWordForms('r:happier/t:happiest')).toBe(
			'比较级 happier · 最高级 happiest',
		);
	});

	it('空串与未知编码安全处理', () => {
		expect(formatWordForms('')).toBe('');
		expect(formatWordForms('x:unknown')).toBe('');
	});
});

describe('词形归一化（formOf 查询链）', () => {
	/** 构造词形反向索引条目 */
	function createFormEntry(
		w: string,
		f: Record<string, string>,
	): FormIndexEntry {
		return { w, f };
	}

	const FORM_FIXTURES: FormIndexEntry[] = [
		// 数据格式：f 为「变形词 → 词形编码」（与构建脚本输出一致）
		createFormEntry('improve', {
			improves: '3',
			improved: 'p',
			improving: 'i',
		}),
		createFormEntry('go', { went: 'p', gone: 'd' }),
	];

	it('parseFormIndexText 逐行解析并跳过空行与损坏行', () => {
		const text = [
			JSON.stringify({ w: 'improve', f: { '3': 'improves' } }),
			'',
			'{broken',
		].join('\n');
		const entries = parseFormIndexText(text);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.w).toBe('improve');
	});

	it('buildFormLookup 以小写变形词为键映射到词元与编码', () => {
		const lookup = buildFormLookup(FORM_FIXTURES);
		expect(lookup.get('improves')).toEqual({ word: 'improve', code: '3' });
		expect(lookup.get('went')).toEqual({ word: 'go', code: 'p' });
		expect(lookup.get('WENT')).toBeUndefined();
	});

	it('formatFormLabel 输出词形标注文案，未知编码回退', () => {
		expect(formatFormLabel('3')).toBe('三单形式');
		expect(formatFormLabel('p')).toBe('过去式形式');
		expect(formatFormLabel('0')).toBe('原形');
		expect(formatFormLabel('zz')).toBe('词形变化');
	});

	it('英文精确命中时直接返回，不走归一化', () => {
		const lookup = buildFormLookup(FORM_FIXTURES);
		const matches = searchWithFormIndex('happy', FIXTURES, lookup);
		expect(matches[0]?.word).toBe('happy');
		expect(matches[0]?.formOf).toBeUndefined();
	});

	it('变形词查询归一化到词元：释义来自词元并带词形标注', () => {
		const lookup = buildFormLookup(FORM_FIXTURES);
		const matches = searchWithFormIndex('improves', FIXTURES, lookup);

		expect(matches[0]?.word).toBe('improve');
		expect(matches[0]?.formOf).toEqual({ word: 'improve', code: '3' });
		// 释义为词元 improve 的完整释义
		expect(matches[0]?.senses[0]?.z).toContain('改良');
		// 原查询的模糊候选（同样是 improve）已被标注候选去重替代
		expect(matches.filter((match) => match.word === 'improve')).toHaveLength(
			1,
		);
	});

	it('不规则变形同样归一化（went → go）', () => {
		const lookup = buildFormLookup(FORM_FIXTURES);
		// fixture 无 go 词条 → 词元释义缺失时回退原结果
		const matches = searchWithFormIndex('went', FIXTURES, lookup);
		// go 不在 FIXTURES 中，取不到词元词条 → 返回原（空）结果
		expect(matches).toEqual([]);
	});

	it('中文查询不受词形索引影响', () => {
		const lookup = buildFormLookup(FORM_FIXTURES);
		const matches = searchWithFormIndex('政府', FIXTURES, lookup);
		expect(matches[0]?.word).toBe('government');
		expect(matches[0]?.formOf).toBeUndefined();
	});
});
