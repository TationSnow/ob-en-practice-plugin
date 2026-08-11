import { Notice } from 'obsidian';
import {
	clearDebugLog,
	getDebugLog,
	subscribeDebugLog,
	type AiDebugEntry,
} from '../ai/debug-log';
import {
	createActionButton,
} from './controls';
import { createCollapsibleSection } from './sections';
import { copyTextToClipboard } from '../utils/clipboard';

/** 调试面板渲染选项 */
export interface DebugPanelOptions {
	/** 是否作为独立页签内嵌渲染（不套可折叠区块） */
	embedded?: boolean;
}

/**
 * 渲染调试面板。
 * @param container 父容器
 * @param options 渲染选项
 * @returns 清理函数，用于取消日志订阅
 */
export function renderDebugPanel(
	container: HTMLElement,
	options: DebugPanelOptions = {},
): () => void {
	const content = options.embedded
		? createEmbeddedDebugPanel(container)
		: createCollapsibleSection(container, '调试面板').content;
	content.addClass('en-debug-panel');

	const logEl = content.createDiv('en-debug-log');
	const render = (): void => renderDebugEntries(logEl, getDebugLog());

	const actions = content.createDiv('en-debug-actions');
	createActionButton(actions, '复制日志', async () => {
		const entries = getDebugLog();
		if (entries.length === 0) {
			new Notice('暂无调试日志');
			return;
		}
		try {
			await copyTextToClipboard(buildDebugLogText(entries));
			new Notice('已复制调试日志');
		} catch (err) {
			new Notice(
				`复制失败：${err instanceof Error ? err.message : String(err)}`,
			);
		}
	});
	createActionButton(actions, '清空日志', async () => {
		clearDebugLog();
		render();
	});

	const unsubscribe = subscribeDebugLog(() => {
		if (!content.isConnected) {
			unsubscribe();
			return;
		}
		render();
	});

	render();
	return unsubscribe;
}

/** 创建内嵌在调试页签中的调试面板容器 */
function createEmbeddedDebugPanel(container: HTMLElement): HTMLElement {
	const root = container.createDiv('en-debug-view');
	root.createEl('h3', { text: '调试日志' }).addClass('en-panel-heading');
	return root;
}

/**
 * 渲染调试日志条目列表。
 * @param container 日志容器
 * @param entries 调试日志
 */
function renderDebugEntries(
	container: HTMLElement,
	entries: readonly AiDebugEntry[],
): void {
	container.empty();

	if (entries.length === 0) {
		container.createEl('p', { text: '暂无调试日志' }).addClass(
			'en-debug-empty',
		);
		return;
	}

	for (const entry of [...entries].reverse()) {
		const row = container.createDiv('en-debug-entry');
		if (entry.phase === 'error') {
			row.addClass('en-debug-error');
		}

		const header = row.createDiv('en-debug-entry-header');
		header.setText(
			`${formatDebugTime(entry.timestamp)} [${entry.feature}] ${entry.message}`,
		);

		if (entry.detail) {
			row.createEl('pre', { text: entry.detail }).addClass(
				'en-debug-entry-detail',
			);
		}
	}
}

/**
 * 格式化调试日志时间。
 * @param timestamp 毫秒时间戳
 * @returns HH:mm:ss
 */
function formatDebugTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString('zh-CN', {
		hour12: false,
	});
}

/**
 * 将调试日志转换为可复制的纯文本。
 * @param entries 调试日志
 * @returns 格式化后的文本
 */
function buildDebugLogText(entries: readonly AiDebugEntry[]): string {
	return entries
		.map((entry) => {
			const time = new Date(entry.timestamp).toLocaleString('zh-CN', {
				hour12: false,
			});
			const detail = entry.detail ? `\n${entry.detail}` : '';
			return `[${time}] [${entry.feature}] ${entry.message}${detail}`;
		})
		.join('\n\n');
}
