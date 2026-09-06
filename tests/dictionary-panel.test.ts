import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDictionaryPanel } from '../src/ui/dictionary-panel';
import type { DictionaryMatch } from '../src/dictionary/types';
import {
	getNoticeMessages,
	resetRecordedMocks,
	StubElement,
	type StubElementLike,
} from './setup';

// 词典查询与剪贴板替换为桩实现（数据模块依赖 esbuild text loader，测试不导入）
const { searchChineseMock, copyTextToClipboardMock } = vi.hoisted(() => ({
	searchChineseMock: vi.fn(),
	copyTextToClipboardMock: vi.fn(),
}));
vi.mock('../src/dictionary/dictionary-data', () => ({
	searchChinese: searchChineseMock,
}));
vi.mock('../src/utils/clipboard', () => ({
	copyTextToClipboard: copyTextToClipboardMock,
}));

/** 构造一个候选词（forget） */
function createForgetMatch(): DictionaryMatch {
	return {
		word: 'forget',
		phonetic: "fә'get",
		senses: [
			{ p: 'vt.', z: '忘记, 忽略, 忽' },
			{ p: 'vi.', z: '忘记' },
		],
		tag: 'zk gk',
		bnc: 813,
		frq: 872,
		matchType: 0,
	};
}

/** 构造一个候选词（government） */
function createGovernmentMatch(): DictionaryMatch {
	return {
		word: 'government',
		phonetic: "'gʌvәnmәnt",
		senses: [{ p: 'n.', z: '政府, 内阁' }],
		tag: 'zk gk cet4 cet6 ky ielts',
		bnc: 124,
		frq: 201,
		matchType: 0,
	};
}

/** 构造 N 个候选词（word0..wordN-1） */
function createMatches(count: number): DictionaryMatch[] {
	return Array.from({ length: count }, (_, index) => ({
		word: `word${index}`,
		senses: [{ p: 'n.', z: '政府' }],
		matchType: 0,
	}));
}

/** 创建面板并返回桩容器与查找助手 */
function openPanel(options: {
	onInsert?: (word: string) => void;
	limit?: number;
} = {}) {
	const container = new StubElement();
	createDictionaryPanel(
		container as unknown as HTMLElement,
		options,
	);
	const findButton = (label: string) =>
		container
			.queryAll(
				(el) =>
					el.tag === 'button' &&
					(el.attrs['aria-label'] ?? '').includes(label),
			)
			.at(-1);
	return { container, findButton };
}

/** 从面板容器中找到查词输入框桩 */
function findInput(container: StubElementLike): StubElementLike {
	const input = container.queryAll((el) => el.tag === 'input')[0];
	if (!input) {
		throw new Error('未找到查词输入框');
	}
	return input;
}

/** 等待微任务（复制流程）完成 */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	resetRecordedMocks();
	searchChineseMock.mockReset();
	// 默认返回空结果：仅断言调用参数的用例无需逐个设置返回值
	searchChineseMock.mockReturnValue([]);
	copyTextToClipboardMock.mockReset();
	copyTextToClipboardMock.mockResolvedValue(undefined);
});

describe('createDictionaryPanel', () => {
	it('输入为空时查询给出提示，不触发词典查询', () => {
		const { findButton } = openPanel();
		findButton('查询')?.trigger('click');

		expect(searchChineseMock).not.toHaveBeenCalled();
		expect(getNoticeMessages()).toContain('请输入要查询的中文词');
	});

	it('查询后渲染候选列表：词、音标、考纲标签与词性释义', () => {
		const { container, findButton } = openPanel();
		searchChineseMock.mockReturnValue([
			createForgetMatch(),
			createGovernmentMatch(),
		]);
		const input = findInput(container);
		input.value = '忘记';

		findButton('查询')?.trigger('click');

		expect(searchChineseMock).toHaveBeenCalledWith('忘记', {
			limit: undefined,
		});
		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(2);

		const firstWord = rows[0]?.queryAll((el) =>
			el.classes.has('en-dict-word'),
		)[0];
		expect(firstWord?.text).toBe('forget');
		const phonetic = rows[0]?.queryAll((el) =>
			el.classes.has('en-dict-phonetic'),
		)[0];
		expect(phonetic?.text).toBe("/fә'get/");
		// 考纲标签最多展示两个
		const tags = rows[0]?.queryAll((el) => el.classes.has('en-tag'));
		expect(tags?.map((tag) => tag.text)).toEqual(['中考', '高考']);

		const senses = rows[0]?.queryAll((el) =>
			el.classes.has('en-dict-sense'),
		);
		expect(senses).toHaveLength(2);
	});

	it('回车键触发查询（键盘可达）', () => {
		const { container } = openPanel();
		const input = findInput(container);
		input.value = '政府';

		input.trigger('keydown', {
			key: 'Enter',
			preventDefault: vi.fn(),
		});

		expect(searchChineseMock).toHaveBeenCalledWith('政府', {
			limit: undefined,
		});
	});

	it('点击插入按钮回调携带候选词', () => {
		const onInsert = vi.fn();
		const { container, findButton } = openPanel({ onInsert });
		searchChineseMock.mockReturnValue([createForgetMatch()]);
		const input = findInput(container);
		input.value = '忘记';
		findButton('查询')?.trigger('click');

		findButton('插入 forget')?.trigger('click');

		expect(onInsert).toHaveBeenCalledWith('forget');
	});

	it('点击复制按钮写入剪贴板并提示', async () => {
		const { container, findButton } = openPanel();
		searchChineseMock.mockReturnValue([createForgetMatch()]);
		const input = findInput(container);
		input.value = '忘记';
		findButton('查询')?.trigger('click');

		findButton('复制 forget')?.trigger('click');
		await flush();

		expect(copyTextToClipboardMock).toHaveBeenCalledWith('forget');
		expect(getNoticeMessages()).toContain('已复制 forget');
	});

	it('未收录时展示空态提示', () => {
		const { container, findButton } = openPanel();
		searchChineseMock.mockReturnValue([]);
		const input = findInput(container);
		input.value = '不存在的词';
		findButton('查询')?.trigger('click');

		const empty = container.queryAll((el) =>
			el.classes.has('en-dict-empty'),
		);
		expect(empty).toHaveLength(1);
		expect(empty[0]?.text).toContain('词典未收录');
	});

	it('结果达到上限时展示截断提示', () => {
		const { container, findButton } = openPanel({ limit: 2 });
		searchChineseMock.mockReturnValue([
			createForgetMatch(),
			createGovernmentMatch(),
		]);
		const input = findInput(container);
		input.value = '政府';
		findButton('查询')?.trigger('click');

		const hints = container.queryAll((el) =>
			el.classes.has('en-dict-empty'),
		);
		expect(hints[0]?.text).toContain('仅显示前 2 条');
	});
});

describe('查词结果分页', () => {
	/** 执行一次返回 12 条候选的查询 */
	function searchTwelveMatches(
		panel: ReturnType<typeof openPanel>,
	): StubElementLike {
		searchChineseMock.mockReturnValue(createMatches(12));
		const input = findInput(panel.container);
		input.value = '政府';
		panel.findButton('查询')?.trigger('click');
		return panel.container;
	}

	/** 查找分页控件元素 */
	function findPagerInfo(container: StubElementLike): StubElementLike {
		const info = container.queryAll((el) =>
			el.classes.has('en-dict-page-info'),
		)[0];
		if (!info) {
			throw new Error('未找到页码信息');
		}
		return info;
	}

	it('默认每页 5 条，渲染首页与页码信息', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);

		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(5);
		expect(findPagerInfo(container).text).toBe('第 1 / 3 页 · 共 12 条');
		// 首行是第 1 条候选
		const firstWord = container.queryAll((el) =>
			el.classes.has('en-dict-word'),
		)[0];
		expect(firstWord?.text).toBe('word0');
	});

	it('下一页渲染第 6-10 条，末页禁用下一页', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);
		panel.findButton('下一页')?.trigger('click');

		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(5);
		const firstWord = container.queryAll((el) =>
			el.classes.has('en-dict-word'),
		)[0];
		expect(firstWord?.text).toBe('word5');
		expect(findPagerInfo(container).text).toBe('第 2 / 3 页 · 共 12 条');

		panel.findButton('下一页')?.trigger('click');
		expect(findPagerInfo(container).text).toBe('第 3 / 3 页 · 共 12 条');
		const lastRows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(lastRows).toHaveLength(2);
		const nextButton = panel
			.findButton('下一页');
		expect(nextButton?.attrs['disabled']).toBe('');
	});

	it('上一页在首页时禁用，越界页码收敛到首页', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);

		const prevButton = panel.findButton('上一页');
		expect(prevButton?.attrs['disabled']).toBe('');
		prevButton?.trigger('click');
		expect(findPagerInfo(container).text).toBe('第 1 / 3 页 · 共 12 条');
	});

	it('跳转页码越界时收敛到末页', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);

		const jumpInput = container.queryAll(
			(el) => el.classes.has('en-dict-jump-input'),
		)[0];
		if (!jumpInput) {
			throw new Error('未找到跳页输入框');
		}
		jumpInput.value = '99';
		panel.findButton('跳转')?.trigger('click');

		expect(findPagerInfo(container).text).toBe('第 3 / 3 页 · 共 12 条');
		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(2);
	});

	it('调整每页大小后回到第一页', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);

		const sizeSelect = container.queryAll(
			(el) => el.classes.has('en-dict-page-size'),
		)[0];
		if (!sizeSelect) {
			throw new Error('未找到每页大小选择器');
		}
		sizeSelect.value = '10';
		sizeSelect.trigger('change');

		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(10);
		expect(findPagerInfo(container).text).toBe('第 1 / 2 页 · 共 12 条');
	});

	it('新查询重置页码但保留每页大小', () => {
		const panel = openPanel();
		const container = searchTwelveMatches(panel);
		panel.findButton('下一页')?.trigger('click');

		// 调整每页大小到 10，再发起一次新查询
		const sizeSelect = container.queryAll(
			(el) => el.classes.has('en-dict-page-size'),
		)[0];
		if (!sizeSelect) throw new Error('未找到每页大小选择器');
		sizeSelect.value = '10';
		sizeSelect.trigger('change');
		const input = findInput(container);
		input.value = '翻译';
		panel.findButton('查询')?.trigger('click');

		expect(findPagerInfo(container).text).toBe('第 1 / 2 页 · 共 12 条');
		const rows = container.queryAll((el) =>
			el.classes.has('en-dict-row'),
		);
		expect(rows).toHaveLength(10);
	});
});
