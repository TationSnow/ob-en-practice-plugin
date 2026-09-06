import { Notice } from 'obsidian';
import { searchChinese } from '../dictionary/dictionary-data';
import { DEFAULT_MATCH_LIMIT } from '../dictionary/lookup';
import type { DictionaryMatch } from '../dictionary/types';
import { copyTextToClipboard } from '../utils/clipboard';
import { paginate, type PaginationResult } from '../utils/pagination';
import { createActionButton, createIconButton } from './controls';
import { createCollapsibleSection, createTag } from './sections';

/** 每页大小可选项（默认 5 条，用户定夺） */
export const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

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

/** 分页控件的事件回调 */
interface PagerHandlers {
	/** 跳转到指定页（页码收敛由分页纯函数负责） */
	onPageChange: (page: number) => void;
	/** 修改每页大小（重置到第一页） */
	onPageSizeChange: (pageSize: number) => void;
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
 * 结果分页展示：默认每页 5 条，支持上下页、跳页与调整每页大小。
 * @param container 父容器（翻译输入区所在卡片）
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
	const fieldRow = section.content.createDiv('en-field-row en-dict-field-row');
	const input = fieldRow.createEl('input', {
		attr: {
			type: 'text',
			'aria-label': '输入中文单词查询英文表达',
			placeholder: '输入中文词，如：忘记 / 政府 / 高兴',
		},
	});
	input.addClass('en-text-input');
	const resultArea = section.content.createDiv('en-dict-results');

	// 分页状态：跨查询保留每页大小，新查询重置页码
	let page = 1;
	let pageSize: number = PAGE_SIZE_OPTIONS[0];
	let matches: DictionaryMatch[] = [];

	/** 渲染当前分页的候选列表与分页控件 */
	const renderPage = (): void => {
		resultArea.empty();
		if (matches.length === 0) {
			resultArea
				.createEl('p', { text: '词典未收录该释义，试试更通用的说法。' })
				.addClass('en-dict-empty');
			return;
		}
		const pageState = paginate(matches.length, page, pageSize);
		page = pageState.page;
		for (const match of matches.slice(
			pageState.startIndex,
			pageState.endIndex,
		)) {
			renderMatchRow(resultArea, match, options);
		}
		renderPager(resultArea, pageState, {
			onPageChange: (next) => {
				page = next;
				renderPage();
			},
			onPageSizeChange: (size) => {
				pageSize = size;
				page = 1;
				renderPage();
			},
		});
		if (matches.length >= (options.limit ?? DEFAULT_MATCH_LIMIT)) {
			resultArea
				.createEl('p', {
					text: `仅显示前 ${matches.length} 条候选，可换更精确的说法缩小范围。`,
				})
				.addClass('en-dict-empty');
		}
	};

	/** 执行查询并回到第一页 */
	const runSearch = (): void => {
		const query = input.value.trim();
		if (!query) {
			new Notice('请输入要查询的中文词');
			return;
		}
		try {
			matches = searchChinese(query, { limit: options.limit });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			resultArea.empty();
			resultArea
				.createEl('p', { text: `查询失败：${message}` })
				.addClass('en-dict-empty');
			return;
		}
		page = 1;
		renderPage();
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
 * 渲染单个候选行：词 + 音标 + 考纲标签 + 插入/复制操作，
 * 词性释义组逐条列示，命中的组排在最前。
 */
function renderMatchRow(
	container: HTMLElement,
	match: DictionaryMatch,
	options: DictionaryPanelOptions,
): void {
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

/**
 * 渲染分页控件：上下页、页码与总数信息、跳页、每页大小选择。
 * 边界页按钮置为 disabled，避免无效点击。
 */
function renderPager(
	container: HTMLElement,
	state: PaginationResult,
	handlers: PagerHandlers,
): void {
	const pager = container.createDiv('en-dict-pager');
	pager.setAttr('role', 'navigation');
	pager.setAttr('aria-label', '查询结果分页');

	const prevButton = createIconButton(pager, 'chevron-left', '上一页', () => {
		handlers.onPageChange(state.page - 1);
	});
	if (state.page <= 1) {
		prevButton.setAttr('disabled', '');
	}

	pager
		.createSpan('en-dict-page-info')
		.setText(
			`第 ${state.page} / ${state.pageCount} 页 · 共 ${state.totalItems} 条`,
		);

	const nextButton = createIconButton(pager, 'chevron-right', '下一页', () => {
		handlers.onPageChange(state.page + 1);
	});
	if (state.page >= state.pageCount) {
		nextButton.setAttr('disabled', '');
	}

	// 跳页：数字输入 + 跳转按钮（回车同样生效）
	const jumpInput = pager.createEl('input', {
		attr: {
			type: 'number',
			min: '1',
			max: String(Math.max(state.pageCount, 1)),
			'aria-label': '跳转页码',
			placeholder: '页码',
		},
	});
	jumpInput.addClass('en-dict-jump-input');
	const jumpTo = (): void => {
		const parsed = Number.parseInt(jumpInput.value, 10);
		if (Number.isNaN(parsed)) {
			new Notice('请输入要跳转的页码');
			return;
		}
		handlers.onPageChange(parsed);
	};
	jumpInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			jumpTo();
		}
	});
	createActionButton(pager, '跳转', async () => {
		jumpTo();
	});

	// 每页大小选择：调整后回到第一页
	const sizeSelect = pager.createEl('select', {
		attr: { 'aria-label': '每页条数' },
	});
	sizeSelect.addClass('en-dict-page-size');
	for (const size of PAGE_SIZE_OPTIONS) {
		const option = sizeSelect.createEl('option', { text: `每页 ${size} 条` });
		option.value = String(size);
	}
	sizeSelect.value = String(state.pageSize);
	sizeSelect.addEventListener('change', () => {
		const parsed = Number.parseInt(sizeSelect.value, 10);
		handlers.onPageSizeChange(
			Number.isNaN(parsed) ? state.pageSize : parsed,
		);
	});
}
