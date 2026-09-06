import { Notice } from 'obsidian';
import { searchChinese } from '../dictionary/dictionary-data';
import { DEFAULT_MATCH_LIMIT } from '../dictionary/lookup';
import type { DictionaryMatch } from '../dictionary/types';
import { copyTextToClipboard } from '../utils/clipboard';
import { createActionButton, createIconButton } from './controls';
import { createCollapsibleSection, createTag } from './sections';

/** 词典查询面板选项 */
export interface DictionaryPanelOptions {
	/**
	 * 候选词「插入」回调：把英文词写入翻译输入框光标处。
	 * 未提供时不渲染插入按钮（面板可在无输入框的场景复用）。
	 */
	onInsert?: (word: string) => void;
	/** 候选上限（默认与词典查询层一致） */
	limit?: number;
}

/** 考纲标签的显示名（节选常用考纲，未列出的标签原样展示） */
const TAG_LABELS: Record<string, string> = {
	zk: '中考',
	gk: '高考',
	cet4: '四级',
	cet6: '六级',
	ky: '考研',
	toefl: '托福',
	ielts: '雅思',
	gre: 'GRE',
};

/**
 * 创建「中译英查词」面板（可折叠区块）。
 * 场景：写作时某个中文词忘记英文拼写，就地查询多个近义英文候选
 * （含词性、释义、音标），一键插入翻译输入框或复制，避免切换页面分心。
 * 查询为本地词典匹配，结果确定、零网络延迟；不使用 AI（用户定夺）。
 * @param container 父容器（翻译输入区）
 * @param options 面板选项
 */
export function createDictionaryPanel(
	container: HTMLElement,
	options: DictionaryPanelOptions = {},
): void {
	const section = createCollapsibleSection(
		container,
		'中译英查词（写作助手）',
		true,
	);
	const fieldRow = section.content.createDiv('en-field-row');
	const input = fieldRow.createEl('input', {
		attr: {
			type: 'text',
			'aria-label': '输入中文单词查询英文表达',
			placeholder: '输入中文词，如：忘记 / 政府 / 高兴',
		},
	});
	input.addClass('en-text-input');
	const resultArea = section.content.createDiv('en-dict-results');

	/** 执行查询并渲染结果 */
	const runSearch = (): void => {
		const query = input.value.trim();
		resultArea.empty();
		if (!query) {
			new Notice('请输入要查询的中文词');
			return;
		}
		let matches: DictionaryMatch[];
		try {
			matches = searchChinese(query, { limit: options.limit });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			resultArea
				.createEl('p', { text: `查询失败：${message}` })
				.addClass('en-dict-empty');
			return;
		}
		if (matches.length === 0) {
			resultArea
				.createEl('p', { text: '词典未收录该释义，试试更通用的说法。' })
				.addClass('en-dict-empty');
			return;
		}
		renderMatches(resultArea, matches, options);
		if (matches.length >= (options.limit ?? DEFAULT_MATCH_LIMIT)) {
			resultArea
				.createEl('p', {
					text: `仅显示前 ${matches.length} 条候选，可换更精确的说法缩小范围。`,
				})
				.addClass('en-dict-empty');
		}
	};

	// 回车触发查询，保持键盘可达
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			runSearch();
		}
	});

	createActionButton(fieldRow, '查询', async () => {
		runSearch();
	}, { icon: 'search' });
}

/**
 * 渲染候选列表：每个候选一行（词 + 音标 + 考纲标签 + 插入/复制操作），
 * 词性释义组逐条列示，命中的组排在最前。
 */
function renderMatches(
	container: HTMLElement,
	matches: DictionaryMatch[],
	options: DictionaryPanelOptions,
): void {
	for (const match of matches) {
		const row = container.createDiv('en-dict-row');

		const head = row.createDiv('en-dict-head');
		head.createSpan('en-dict-word').setText(match.word);
		if (match.phonetic) {
			head.createSpan('en-dict-phonetic').setText(`/${match.phonetic}/`);
		}
		// 考纲标签最多展示两个，避免行内拥挤
		if (match.tag) {
			for (const tag of match.tag.split(/\s+/).slice(0, 2)) {
				createTag(head, TAG_LABELS[tag] ?? tag, 'neutral');
			}
		}

		const actions = head.createDiv('en-dict-actions');
		if (options.onInsert) {
			createIconButton(actions, 'corner-down-left', `插入 ${match.word}`, () => {
				options.onInsert?.(match.word);
			});
		}
		createIconButton(actions, 'copy', `复制 ${match.word}`, () => {
			void copyTextToClipboard(match.word)
				.then(() => new Notice(`已复制 ${match.word}`))
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					new Notice(`复制失败：${message}`);
				});
		});

		const sensesEl = row.createDiv('en-dict-senses');
		for (const sense of match.senses) {
			const senseRow = sensesEl.createDiv('en-dict-sense');
			if (sense.p) {
				senseRow.createSpan('en-dict-pos').setText(sense.p);
			}
			senseRow.createSpan('en-dict-gloss').setText(sense.z);
		}
	}
}
