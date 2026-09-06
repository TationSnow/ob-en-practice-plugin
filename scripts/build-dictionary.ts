/**
 * 词典二次清洗脚本：从 ECDICT 全量 CSV 构建插件运行时的「中译英」查询数据。
 *
 * 背景与目标：
 * - 数据源 ECDICT（MIT 许可）为「英文 → 中文」词典；插件需求是「输入中文词 →
 *   返回多个近义英文候选」，运行时以「中文释义子串匹配」实现该方向查询，
 *   因此本脚本负责把全量 CSV 清洗为运行时友好的精简条目（JSONL）。
 * - 选词范围（用户定夺）：考纲核心词（zk/gk/cet4/cet6/ky/toefl/ielts/gre 任一标签）
 *   ∪ 高频扩展（BNC/当代语料库排名 ≤ 阈值），总量截断 ≤ maxEntries。
 * - 清洗规则：
 *   1. 丢弃英文 definition 列与全空的 pos 列（词性从释义行前缀解析）；
 *   2. 释义按词性前缀分组（`n. 快乐的, 幸福的` → {p:'n.', z:'快乐的, 幸福的'}）；
 *   3. 丢弃 `[计]/[网络]/[医]` 等领域缩写噪声行，提升查准率；
 *   4. 按 word 去重（保留首条），超量时考纲词优先、同级按词频排名升序截断。
 *
 * 运行方式（Node 24 原生执行 TypeScript，无需编译）：
 *   node scripts/build-dictionary.ts [csvPath] [outputPath]
 * 产物 src/data/dictionary.txt 提交入库，插件构建不依赖数据仓。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** ECDICT csv 列序（表头：word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio） */
const COLUMN = {
	WORD: 0,
	PHONETIC: 1,
	TRANSLATION: 3,
	COLLINS: 5,
	OXFORD: 6,
	TAG: 7,
	BNC: 8,
	FRQ: 9,
	EXCHANGE: 10,
} as const;

/** 词性释义组：p 为词性前缀（如 'n.'，无前缀为空串），z 为中文释义原文 */
export interface SenseGroup {
	p: string;
	z: string;
}

/** 词典条目（短键序列化以压缩体积；字段含义见注释） */
export interface DictionaryEntry {
	/** word 英文单词 */
	w: string;
	/** phonetic 音标 */
	ph?: string;
	/** senses 词性释义组 */
	s: SenseGroup[];
	/** tag 考纲标签（空格分隔，如 'zk gk'） */
	tg?: string;
	/** bnc 语料库词频排名（1 最高） */
	b?: number;
	/** frq 当代语料库词频排名（1 最高） */
	f?: number;
	/** collins 柯林斯星级 */
	c?: number;
	/** oxford 牛津 3000 标记 */
	o?: number;
	/** exchange 词形变换（如 'd:forgotten/p:forgot'） */
	e?: string;
}

/** 选词选项 */
export interface SelectOptions {
	/** 考纲标签白名单 */
	tags: readonly string[];
	/** BNC 排名纳入阈值（含） */
	bncLimit: number;
	/** 词频排名纳入阈值（含） */
	frqLimit: number;
}

/** 构建选项 */
export interface BuildOptions extends SelectOptions {
	csvPath: string;
	outputPath: string;
	/** 词条总量上限（考纲词优先保留） */
	maxEntries: number;
}

/** 构建统计 */
export interface BuildStats {
	/** 读取的数据行数（不含表头） */
	totalRows: number;
	/** 截断后选中的词数 */
	selected: number;
	/** 重复词丢弃数 */
	duplicatesDropped: number;
	/** 实际写出的条目数（个别词可能无有效释义） */
	written: number;
	/** 输出字节数 */
	bytes: number;
}

/**
 * 解析 CSV 文本为记录二维表（RFC4180）：
 * 支持引号字段内的逗号、转义双引号与真实换行；兼容 CRLF。
 * @param content CSV 文本
 * @returns 记录数组（首行为表头）
 */
export function parseCsv(content: string): string[][] {
	const records: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		if (inQuotes) {
			if (char === '"') {
				if (content[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n') {
			row.push(field);
			records.push(row);
			row = [];
			field = '';
		} else if (char !== '\r') {
			field += char;
		}
	}
	// 文件末尾无换行时补上最后一条记录
	if (field !== '' || row.length > 0) {
		row.push(field);
		records.push(row);
	}
	return records;
}

/**
 * 解析 translation 字段为词性释义组。
 * - 组间以字面 `\n` 序列分隔（ECDICT 的换行约定）；
 * - `[计]/[网络]/[医]` 等领域缩写行属查询噪声，整行丢弃；
 * - 无词性前缀的行保留为空词性。
 * @param translation translation 字段原文
 * @returns 词性释义组
 */
export function parseSenseGroups(translation: string): SenseGroup[] {
	const groups: SenseGroup[] = [];
	for (const segment of translation.split('\\n')) {
		const text = segment.trim();
		if (!text) {
			continue;
		}
		// 领域缩写行（如 [计] 存取管理程序）不参与中文查询，丢弃
		if (/^\[[^\]]*\]/.test(text)) {
			continue;
		}
		const posMatch = text.match(/^([A-Za-z][A-Za-z&.]{0,10}[.])\s*(.+)$/);
		if (posMatch) {
			groups.push({ p: posMatch[1] ?? '', z: (posMatch[2] ?? '').trim() });
		} else {
			groups.push({ p: '', z: text });
		}
	}
	return groups;
}

/** 解析排名类数值：空串/非数字/0 均视为无排名（undefined） */
function parseRank(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 解析星级类数值：仅保留正数 */
function parsePositive(value: string | undefined): number | undefined {
	const rank = parseRank(value);
	return rank;
}

/**
 * 组装单条词典条目（短键，空字段省略）。
 * @param record 13 列 CSV 记录
 * @returns 条目；词为空或无有效释义时返回 null
 */
export function buildEntry(record: string[]): DictionaryEntry | null {
	const word = (record[COLUMN.WORD] ?? '').trim();
	if (!word) {
		return null;
	}
	const senses = parseSenseGroups(record[COLUMN.TRANSLATION] ?? '');
	if (senses.length === 0) {
		return null;
	}
	const entry: DictionaryEntry = { w: word, s: senses };
	const phonetic = (record[COLUMN.PHONETIC] ?? '').trim();
	if (phonetic) {
		entry.ph = phonetic;
	}
	const tag = (record[COLUMN.TAG] ?? '').trim();
	if (tag) {
		entry.tg = tag;
	}
	const bnc = parseRank(record[COLUMN.BNC]);
	if (bnc !== undefined) {
		entry.b = bnc;
	}
	const frq = parseRank(record[COLUMN.FRQ]);
	if (frq !== undefined) {
		entry.f = frq;
	}
	const collins = parsePositive(record[COLUMN.COLLINS]);
	if (collins !== undefined) {
		entry.c = collins;
	}
	const oxford = parsePositive(record[COLUMN.OXFORD]);
	if (oxford !== undefined) {
		entry.o = oxford;
	}
	const exchange = (record[COLUMN.EXCHANGE] ?? '').trim();
	if (exchange) {
		entry.e = exchange;
	}
	return entry;
}

/**
 * 选词判定：考纲标签任一命中，或 BNC/词频排名达阈值。
 * 排名 0 视为无排名（ECDICT 约定）。
 * @param record CSV 记录
 * @param options 选词选项
 * @returns 是否纳入
 */
export function shouldInclude(
	record: string[],
	options: SelectOptions,
): boolean {
	const tag = (record[COLUMN.TAG] ?? '').trim();
	if (tag && tag.split(/\s+/).some((item) => options.tags.includes(item))) {
		return true;
	}
	const bnc = parseRank(record[COLUMN.BNC]);
	if (bnc !== undefined && bnc <= options.bncLimit) {
		return true;
	}
	const frq = parseRank(record[COLUMN.FRQ]);
	if (frq !== undefined && frq <= options.frqLimit) {
		return true;
	}
	return false;
}

/** 计算条目的词频排名（BNC 与词频取较优，无排名返回 Infinity） */
function rankOf(record: string[]): number {
	const bnc = parseRank(record[COLUMN.BNC]);
	const frq = parseRank(record[COLUMN.FRQ]);
	return Math.min(bnc ?? Number.POSITIVE_INFINITY, frq ?? Number.POSITIVE_INFINITY);
}

/** 判断记录是否带考纲标签 */
function isTagged(record: string[], options: SelectOptions): boolean {
	const tag = (record[COLUMN.TAG] ?? '').trim();
	return (
		tag !== '' && tag.split(/\s+/).some((item) => options.tags.includes(item))
	);
}

/**
 * 执行构建：读 CSV → 去重 → 选词 → 截断 → 组装 → 写 JSONL。
 * @param options 构建选项
 * @returns 构建统计
 */
export async function buildDictionary(
	options: BuildOptions,
): Promise<BuildStats> {
	const content = readFileSync(options.csvPath, 'utf8');
	const rows = parseCsv(content);
	const records = rows.slice(1);

	// 按 word 去重（保留首条；ECDICT 存在少量大小写变体之外的重复行）
	const byWord = new Map<string, string[]>();
	let duplicatesDropped = 0;
	for (const record of records) {
		const word = (record[COLUMN.WORD] ?? '').trim();
		if (!word) {
			continue;
		}
		if (byWord.has(word)) {
			duplicatesDropped += 1;
			continue;
		}
		byWord.set(word, record);
	}

	// 选词；超量时考纲词优先保留，同级按词频排名升序截断
	const candidates = [...byWord.values()].filter((record) =>
		shouldInclude(record, options),
	);
	candidates.sort((a, b) => {
		const taggedDiff =
			(isTagged(b, options) ? 1 : 0) - (isTagged(a, options) ? 1 : 0);
		if (taggedDiff !== 0) {
			return taggedDiff;
		}
		return rankOf(a) - rankOf(b);
	});
	const selected = candidates.slice(0, options.maxEntries);

	const entries: DictionaryEntry[] = [];
	for (const record of selected) {
		const entry = buildEntry(record);
		if (entry) {
			entries.push(entry);
		}
	}

	const text =
		entries.map((entry) => JSON.stringify(entry)).join('\n') +
		(entries.length > 0 ? '\n' : '');
	mkdirSync(dirname(options.outputPath), { recursive: true });
	writeFileSync(options.outputPath, text, 'utf8');

	return {
		totalRows: records.length,
		selected: selected.length,
		duplicatesDropped,
		written: entries.length,
		bytes: Buffer.byteLength(text, 'utf8'),
	};
}

/** 默认考纲标签集合 */
const DEFAULT_TAGS = [
	'zk',
	'gk',
	'cet4',
	'cet6',
	'ky',
	'toefl',
	'ielts',
	'gre',
] as const;

/** 命令行入口：node scripts/build-dictionary.ts [csvPath] [outputPath] */
async function main(): Promise<void> {
	const csvPath = resolve(
		process.cwd(),
		process.argv[2] ?? '../en-practice-data/ECDICT/ecdict.csv',
	);
	const outputPath = resolve(
		process.cwd(),
		process.argv[3] ?? 'src/data/dictionary.txt',
	);
	const stats = await buildDictionary({
		csvPath,
		outputPath,
		maxEntries: 50_000,
		tags: DEFAULT_TAGS,
		bncLimit: 30_000,
		frqLimit: 30_000,
	});
	console.log(
		`词典构建完成：读取 ${stats.totalRows} 行，去重丢弃 ${stats.duplicatesDropped}，` +
			`选中 ${stats.selected} 词，写出 ${stats.written} 条（${(stats.bytes / 1024 / 1024).toFixed(2)} MB）`,
	);
	console.log(`输出文件：${outputPath}`);
}

// 仅在直接执行本脚本时运行主流程，被测试导入时不产生副作用
const isDirectRun =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
	await main();
}
