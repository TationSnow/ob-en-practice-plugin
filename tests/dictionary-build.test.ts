import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildDictionary,
	buildEntry,
	buildFormIndex,
	parseCsv,
	parseSenseGroups,
	shouldInclude,
	type DictionaryEntry,
} from '../scripts/build-dictionary';

/** 构造一条 13 列 CSV 记录（列序与 ECDICT 表头一致） */
function createRecord(
	overrides: Partial<Record<number, string>> = {},
): string[] {
	const record = [
		'happy', // 0 word
		"'hæpi", // 1 phonetic
		'a. enjoying or showing or marked by joy or pleasure', // 2 definition
		'a. 快乐的, 幸福的, 愉快的, 恰当的', // 3 translation
		'', // 4 pos
		'4', // 5 collins
		'1', // 6 oxford
		'zk gk', // 7 tag
		'777', // 8 bnc
		'747', // 9 frq
		'r:happier/t:happiest', // 10 exchange
		'', // 11 detail
		'', // 12 audio
	];
		for (const [index, value] of Object.entries(overrides)) {
			if (value === undefined) {
				continue;
			}
			record[Number(index)] = value;
		}
	return record;
}

/** 记录转 CSV 行（简单拼接，仅测试用） */
function recordToCsv(record: string[]): string {
	return record
		.map((field) => (field.includes(',') ? `"${field}"` : field))
		.join(',');
}

describe('parseCsv', () => {
	it('解析引号内逗号与转义双引号，不误切字段', () => {
		const rows = parseCsv('a,b\n"x,1","he said ""hi""",c');
		expect(rows[0]).toEqual(['a', 'b']);
		expect(rows[1]).toEqual(['x,1', 'he said "hi"', 'c']);
	});

	it('引号内字段含字面 \\n 序列时原样保留（ECDICT 的换行约定）', () => {
		const rows = parseCsv('w,"n. 快乐的\\nv. 高兴"');
		expect(rows[0]?.[1]).toBe('n. 快乐的\\nv. 高兴');
	});

	it('处理 CRLF 行尾与文件末尾无换行的情况', () => {
		const rows = parseCsv('a,b\r\nc,d');
		expect(rows).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
	});
});

describe('parseSenseGroups', () => {
	it('按词性前缀分组并保留释义原文', () => {
		const groups = parseSenseGroups('n. 快乐的, 幸福的\\ns. 恰当的');
		expect(groups).toEqual([
			{ p: 'n.', z: '快乐的, 幸福的' },
			{ p: 's.', z: '恰当的' },
		]);
	});

	it('丢弃 [计]/[网络] 等领域缩写噪声行', () => {
		const groups = parseSenseGroups(
			'n. 爱滋病\\n[计] 高级综合数据系统, 先进交互调试系统',
		);
		expect(groups).toEqual([{ p: 'n.', z: '爱滋病' }]);
	});

	it('无词性前缀的行保留为空词性', () => {
		expect(parseSenseGroups('be的单数第一人称')).toEqual([
			{ p: '', z: 'be的单数第一人称' },
		]);
	});

	it('跳过空行并去除首尾空白', () => {
		expect(parseSenseGroups('\\n\\n  n. 非洲  ')).toEqual([
			{ p: 'n.', z: '非洲' },
		]);
	});
});

describe('buildEntry', () => {
	it('组装短键条目，空字段省略', () => {
		const entry = buildEntry(createRecord());
		expect(entry).toEqual({
			w: 'happy',
			ph: "'hæpi",
			s: [{ p: 'a.', z: '快乐的, 幸福的, 愉快的, 恰当的' }],
			tg: 'zk gk',
			b: 777,
			f: 747,
			c: 4,
			o: 1,
			e: 'r:happier/t:happiest',
		});
	});

	it('词为空或无有效释义时返回 null', () => {
		expect(buildEntry(createRecord({ 0: '' }))).toBeNull();
		expect(
			buildEntry(createRecord({ 3: '[计] 噪声\\n[网络] 噪声' })),
		).toBeNull();
	});
});

describe('shouldInclude', () => {
	const options = {
		tags: ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'],
		bncLimit: 30000,
		frqLimit: 30000,
	} as const;

	it('考纲标签命中即纳入（与词频无关）', () => {
		expect(shouldInclude(createRecord(), options)).toBe(true);
	});

	it('bnc/frq 排名达阈值即纳入，0 视为无排名', () => {
		expect(
			shouldInclude(
				createRecord({ 7: '', 8: '30000', 9: '' }),
				options,
			),
		).toBe(true);
		expect(
			shouldInclude(createRecord({ 7: '', 8: '', 9: '29999' }), options),
		).toBe(true);
		expect(
			shouldInclude(createRecord({ 7: '', 8: '0', 9: '0' }), options),
		).toBe(false);
		expect(
			shouldInclude(
				createRecord({ 7: '', 8: '30001', 9: '30001' }),
				options,
			),
		).toBe(false);
	});
});

describe('buildDictionary', () => {
	it('从 CSV 生成去重、截断后的 JSONL 与统计', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dict-test-'));
		const csvPath = join(dir, 'ecdict.csv');
		const outputPath = join(dir, 'dictionary.txt');
		const records = [
			'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
			// 考纲词
			recordToCsv(createRecord()),
			// 同名词重复：去重后只保留一条
			recordToCsv(createRecord({ 9: '999' })),
			// 高频词（无考纲标签，bnc 达阈值）
			recordToCsv(
				createRecord({
					0: 'government',
					3: 'n. 政府, 内阁\\n[计] 噪声',
					7: '',
					8: '59',
					9: '70',
				}),
			),
			// 低频且无标签：不纳入
			recordToCsv(
				createRecord({ 0: 'obscureword', 7: '', 8: '', 9: '99999' }),
			),
		];
		writeFileSync(csvPath, records.join('\n'), 'utf8');

		const stats = await buildDictionary({
			csvPath,
			outputPath,
			maxEntries: 2,
			tags: ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'],
			bncLimit: 30000,
			frqLimit: 30000,
		});

		expect(stats.selected).toBe(2);
		expect(stats.written).toBe(2);
		expect(stats.duplicatesDropped).toBe(1);

		const lines = readFileSync(outputPath, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as DictionaryEntry);
		expect(lines).toHaveLength(2);
		expect(lines.map((entry) => entry.w)).toEqual(['happy', 'government']);
		// 去重保留第一条（frq 747 而非 999）
		expect(lines[0]?.f).toBe(747);
		// government 的噪声释义组已被过滤
		expect(lines[1]?.s).toEqual([{ p: 'n.', z: '政府, 内阁' }]);
	});
});

describe('buildFormIndex（词形反向索引）', () => {
	it('从 exchange 字段抽取变形→编码映射并按头词聚合', () => {
		const entries: DictionaryEntry[] = [
			{
				w: 'improve',
				s: [{ p: 'vt.', z: '改善' }],
				e: 'd:improved/i:improving/3:improves/p:improved',
			},
			{
				w: 'decrease',
				s: [{ p: 'n.', z: '减少' }],
				e: 'd:decreased/3:decreases/s:decreases',
			},
		];
		const index = buildFormIndex(entries, new Set(['improve', 'decrease']));

		const improve = index.find((item) => item.w === 'improve');
		// 以变形词为键、编码为值；同一变形多编码（improved 同为过去式/过去分词）取规范顺序靠前者
		expect(improve?.f).toEqual({
			improved: 'p',
			improving: 'i',
			improves: '3',
		});
		const decrease = index.find((item) => item.w === 'decrease');
		// decreases 同为三单与复数，保留规范顺序中更靠前的三单
		expect(decrease?.f.decreases).toBe('3');
		expect(decrease?.f.decreased).toBe('d');
	});

	it('已是头词的变形不进入索引（运行时精确命中优先）', () => {
		const entries: DictionaryEntry[] = [
			{
				w: 'study',
				s: [{ p: 'v.', z: '学习' }],
				e: '3:studies/p:studied/i:studying',
			},
		];
		// studies 自己也是头词（如某些词库行独立存在）
		const index = buildFormIndex(entries, new Set(['study', 'studies']));
		const study = index.find((item) => item.w === 'study');
		expect(study?.f.studies).toBeUndefined();
		expect(study?.f.studied).toBe('p');
		expect(study?.f.studying).toBe('i');
	});

	it('排除判定大小写不敏感（头词/变形均按小写比较）', () => {
		const entries: DictionaryEntry[] = [
			{
				w: 'STUDY',
				s: [{ p: 'v.', z: '学习' }],
				e: '3:studies/p:studied',
			},
			{
				w: 'Improves',
				s: [{ p: 'v.', z: '改善' }],
				e: '0:improves',
			},
		];
		// improves 自身是头词（Improves）→ 排除；studies 不在头词集合 → 保留
		const index = buildFormIndex(entries, new Set(['study', 'improves']));
		expect(index.map((item) => item.w)).toEqual(['STUDY']);
		expect(index[0]?.f.studies).toBe('3');
	});
});
