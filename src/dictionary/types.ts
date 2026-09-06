/**
 * 词典运行时层（纯数据结构定义）。
 * 与构建脚本 scripts/build-dictionary.ts 的产物结构保持一致，
 * 但此处独立定义类型，运行时不依赖构建脚本。
 */

/** 词性释义组：p 为词性前缀（如 'n.'，无前缀为空串），z 为中文释义原文 */
export interface SenseGroup {
	p: string;
	z: string;
}

/** 词典条目（构建产物 JSONL 的短键结构，含义见 scripts/build-dictionary.ts） */
export interface DictionaryEntry {
	/** 英文单词 */
	w: string;
	/** 音标 */
	ph?: string;
	/** 词性释义组 */
	s: SenseGroup[];
	/** 考纲标签（空格分隔，如 'zk gk'） */
	tg?: string;
	/** BNC 语料库词频排名（1 最高） */
	b?: number;
	/** 当代语料库词频排名（1 最高） */
	f?: number;
	/** 柯林斯星级 */
	c?: number;
	/** 牛津 3000 标记 */
	o?: number;
	/** 词形变换（如 'd:forgotten/p:forgot'） */
	e?: string;
}

/**
 * 查询匹配类型（数值序即排序序，数值越小越靠前）。
 * - 中译英方向（中文释义匹配）：0 释义精确命中 / 1 释义前缀命中 / 2 释义包含命中；
 * - 英查词方向（单词形态匹配）：0 词形精确命中（忽略大小写）/ 1 通配符整词命中 /
 *   2 前缀命中 / 3 包含命中 / 4 模糊命中（编辑距离容错）。
 */
export type DictionaryMatchType = 0 | 1 | 2 | 3 | 4;

/** 查询结果候选（按词聚合，多义组完整展示） */
export interface DictionaryMatch {
	/** 英文单词 */
	word: string;
	/** 音标 */
	phonetic?: string;
	/** 词性释义组（命中的组排在最前，其余组随后完整展示） */
	senses: SenseGroup[];
	/** 考纲标签 */
	tag?: string;
	/** BNC 词频排名 */
	bnc?: number;
	/** 词频排名 */
	frq?: number;
	/** 柯林斯星级 */
	collins?: number;
	/** 牛津 3000 标记 */
	oxford?: number;
	/** 词形变换 */
	exchange?: string;
	/** 匹配类型 */
	matchType: DictionaryMatchType;
}

/** 查询选项 */
export interface SearchOptions {
	/** 返回候选上限（默认 20） */
	limit?: number;
}
