/** 调试日志阶段类型 */
export type DebugPhase =
	| 'model'
	| 'request'
	| 'stream'
	| 'retry'
	| 'fallback'
	| 'success'
	| 'error';

/** 单条 AI 调试日志 */
export interface AiDebugEntry {
	id: number;
	timestamp: number;
	requestId: string;
	feature: string;
	phase: DebugPhase;
	message: string;
	detail?: string;
}

/** 内存中最多保留的日志条数 */
const MAX_ENTRIES = 200;

let entries: AiDebugEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notifyListeners(): void {
	for (const listener of listeners) {
		listener();
	}
}

/**
 * 追加一条调试日志并通知订阅者。
 * @param entry 除 id、timestamp 外的日志内容
 */
export function addDebugEntry(
	entry: Omit<AiDebugEntry, 'id' | 'timestamp'>,
): void {
	const fullEntry: AiDebugEntry = {
		...entry,
		id: nextId,
		timestamp: Date.now(),
	};
	nextId += 1;
	entries = [...entries, fullEntry].slice(-MAX_ENTRIES);
	notifyListeners();
}

/** 清空全部调试日志 */
export function clearDebugLog(): void {
	entries = [];
	notifyListeners();
}

/** 获取当前调试日志（最新在最后） */
export function getDebugLog(): readonly AiDebugEntry[] {
	return entries;
}

/**
 * 订阅调试日志变化。
 * @param listener 日志变化时的回调
 * @returns 取消订阅函数
 */
export function subscribeDebugLog(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * 生成一次请求的调试 ID。
 * @param feature 功能名称
 * @returns 请求 ID
 */
export function createRequestId(feature: string): string {
	return `${feature}-${Date.now()}-${nextId}`;
}

/**
 * 将调试详情转换为完整字符串，便于调试时查看和复制全部信息。
 * @param value 原始详情
 * @param maxLength 可选的最大长度；默认不截断
 * @returns 可展示的字符串
 */
export function formatDebugDetail(
	value: unknown,
	maxLength = Number.POSITIVE_INFINITY,
): string {
	try {
		const text = JSON.stringify(value) ?? String(value);
		if (text.length > maxLength) {
			return `${text.slice(0, maxLength)}...`;
		}
		return text;
	} catch {
		return String(value);
	}
}
