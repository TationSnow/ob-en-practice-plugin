/**
 * 生词本运行时层（纯数据结构定义）。
 * 词条在收录时从本地词典（DictionaryMatch）复制音标与释义快照，
 * 使生词本不依赖词典数据的存在即可支撑出题与管理展示；
 * 用户可在备注中补充自定义含义，出题时作为释义缺失的兜底。
 */
import type { SenseGroup } from '../dictionary/types';

/** 生词本单个词条 */
export interface VocabularyEntry {
	/** 唯一标识（收录时由数据层生成，编辑与删除按 id 定位） */
	id: string;
	/** 英文单词（词典词元优先，如悬浮 "sat" 收录为 "sit"；保留输入拼写） */
	word: string;
	/** 音标快照（收录时来自本地词典，可能缺失） */
	phonetic?: string;
	/** 释义快照（收录时来自本地词典，可能为空数组） */
	senses: SenseGroup[];
	/** 用户备注：可作为自定义释义，出题时在词典释义缺失时兜底 */
	note?: string;
	/** 收录时间戳（毫秒） */
	addedAt: number;
}

/** 收录词条的输入草稿（id 与收录时间由数据层生成，无需提供） */
export interface VocabularyEntryDraft {
	word: string;
	phonetic?: string;
	senses?: SenseGroup[];
	note?: string;
}

/** 编辑词条的补丁（省略的字段保持不变；note 传空串表示清除备注） */
export interface VocabularyEntryPatch {
	word?: string;
	phonetic?: string;
	senses?: SenseGroup[];
	note?: string;
}

/** 词条变更失败原因：供服务层映射为用户提示 */
export type VocabularyMutationFailure =
	| 'empty-word'
	| 'duplicate'
	| 'not-found';

/** 词条变更结果（不可变更新：entries 为新数组，原数组不被修改） */
export interface VocabularyMutationResult {
	/** 变更后的完整词条列表（未发生变更时为原列表的浅拷贝） */
	entries: VocabularyEntry[];
	/** 变更涉及的词条：新增/更新时为新词条，其余场景缺省 */
	entry?: VocabularyEntry;
	/** 是否真正发生了变更 */
	changed: boolean;
	/** 失败原因（changed 为 false 时提供） */
	reason?: VocabularyMutationFailure;
}

/** 词条录入依赖注入：id 生成与当前时间，测试可注入确定性实现 */
export interface VocabularyEntryDeps {
	createId?: () => string;
	now?: () => number;
}
