import { describe, expect, it, vi } from 'vitest';
import {
	renderGrammarResult,
	renderHighlightedSentence,
} from '../src/ui/grammar-render';

// 词卡查询依赖词典数据模块（esbuild text loader），测试中以桩替换
vi.mock('../src/dictionary/dictionary-data', () => ({
	searchDictionary: vi.fn(() => []),
}));

/** 最小 DOM 桩，用于在 Node 环境验证渲染逻辑 */
class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';
	tag = 'div';
	attrs: Record<string, string> = {};
	listeners: Record<string, (event?: unknown) => void> = {};

	createEl(
		_tag: string,
		opts?: { text?: string; attr?: Record<string, string> },
	): FakeEl {
		const el = new FakeEl();
		el.tag = _tag;
		if (opts?.text) {
			el.text = opts.text;
		}
		if (opts?.attr) {
			for (const [key, value] of Object.entries(opts.attr)) {
				el.setAttr(key, value);
			}
		}
		this.children.push(el);
		return el;
	}

	createDiv(cls?: string): FakeEl {
		const el = new FakeEl();
		if (cls) {
			el.addClass(cls);
		}
		this.children.push(el);
		return el;
	}

	createSpan(opts?: { text?: string }): FakeEl {
		const el = new FakeEl();
		if (opts?.text) {
			el.text = opts.text;
		}
		this.children.push(el);
		return el;
	}

	addClass(cls: string): void {
		this.classes.add(cls);
	}

	setAttr(key: string, value: string): void {
		this.attrs[key] = value;
	}

	addEventListener(type: string, callback: (event?: unknown) => void): void {
		this.listeners[type] = callback;
	}

	setText(text: string): void {
		this.text = text;
	}

	empty(): void {
		this.children = [];
	}

	collectText(): string {
		return `${this.text}${this.children
			.map((child) => child.collectText())
			.join('')}`;
	}
}

/** 递归收集树中全部元素（含自身），供多个用例查找节点 */
function collectAll(el: FakeEl): FakeEl[] {
	const all = [el];
	for (const child of el.children) {
		all.push(...collectAll(child));
	}
	return all;
}

describe('renderHighlightedSentence', () => {
	it('嵌套成分渲染不应因谓语动词递归而栈溢出', () => {
		const sentence =
			'The current trend on the Internet is befriending anyone who requests to be your friend.';
		const result = {
			sentence,
			components: [
				{
					text: 'The current trend on the Internet',
					type: 'subject',
				},
				{
					text: 'is befriending',
					type: 'predicate',
					details: '谓语动词：is befriending；现在进行时，主动语态',
				},
				{
					text: 'anyone who requests to be your friend',
					type: 'object',
					details: '名词短语作宾语，内含定语从句',
					children: [
						{ text: 'who', type: 'subject' },
						{
							text: 'requests',
							type: 'predicate',
							details: '谓语动词：requests；一般现在时',
						},
						{ text: 'to be your friend', type: 'object' },
					],
				},
			],
			clauses: [
				{
					text: sentence,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
				{
					text: 'who requests to be your friend',
					level: 1,
					type: '定语从句',
					function: '修饰宾语中的名词 anyone',
				},
			],
		};

		expect(() =>
			renderHighlightedSentence(
				new FakeEl() as unknown as HTMLElement,
				sentence,
				result.components as never,
				result.clauses,
			),
		).not.toThrow();
	});

	it('从句不应被子成分重复包裹为多重括号', () => {
		const sentence =
			'Loyalty consists of a friend, who will stick by you, through thick and thin.';
		const result = {
			sentence,
			components: [
				{
					text: 'Loyalty',
					type: 'subject',
				},
				{
					text: 'consists of',
					type: 'predicate',
					details: '谓语动词：consists of；一般现在时，主动语态',
				},
				{
					text: 'a friend, who will stick by you, through thick and thin',
					type: 'object',
					details: '名词短语作宾语，内含定语从句',
					children: [
						{ text: 'a friend', type: 'object' },
						{
							text: 'who will stick by you',
							type: 'attributive',
							details: '非限制性定语从句',
							children: [
								{ text: 'who', type: 'subject' },
								{
									text: 'will stick by',
									type: 'predicate',
									details: '谓语动词：stick by；一般将来时',
								},
								{ text: 'you', type: 'object' },
							],
						},
						{
							text: 'through thick and thin',
							type: 'adverbial',
						},
					],
				},
			],
			clauses: [
				{
					text: sentence,
					level: 0,
					type: '主句',
					function: '全句主干',
				},
				{
					text: 'who will stick by you',
					level: 1,
					type: '定语从句',
					function: '修饰 a friend',
				},
			],
		};

		const root = new FakeEl();
		renderHighlightedSentence(
			root as unknown as HTMLElement,
			sentence,
			result.components as never,
			result.clauses,
		);
		const rendered = root.collectText();
		expect(rendered).not.toContain('((');
		expect(rendered).not.toContain('))');
		expect(rendered).toContain('(who will stick by you)');
	});
});

describe('句子成分标注词元化（悬浮词卡接入）', () => {
	/** 简单句渲染结果 */
	const SIMPLE = {
		sentence: 'The cat sat on the mat.',
		components: [
			{ text: 'The cat', type: 'subject' },
			{ text: 'sat', type: 'predicate', details: '谓语动词：sat' },
			{ text: 'on the mat', type: 'adverbial' },
		],
		clauses: [
			{
				text: 'The cat sat on the mat.',
				level: 0,
				type: '主句',
				function: '全句主干',
			},
		],
	};

	/** 递归收集全部词元 */
	function collectTokens(el: FakeEl): FakeEl[] {
		const tokens = el.classes.has('en-word-token') ? [el] : [];
		for (const child of el.children) {
			tokens.push(...collectTokens(child));
		}
		return tokens;
	}

	it('所有英文单词拆分为词元并携带 data-word 属性', () => {
		const root = new FakeEl();
		renderHighlightedSentence(
			root as unknown as HTMLElement,
			SIMPLE.sentence,
			SIMPLE.components as never,
			SIMPLE.clauses,
		);

		const tokens = collectTokens(root);
		const words = tokens.map((token) => token.attrs['data-word']);
		expect(words).toEqual([
			'the',
			'cat',
			'sat',
			'on',
			'the',
			'mat',
		]);
	});

	it('词元携带悬浮/点击事件监听（悬浮词卡接入）', () => {
		const root = new FakeEl();
		renderHighlightedSentence(
			root as unknown as HTMLElement,
			SIMPLE.sentence,
			SIMPLE.components as never,
			SIMPLE.clauses,
		);

		const tokens = collectTokens(root);
		expect(tokens.length).toBeGreaterThan(0);
		for (const token of tokens) {
			expect(token.listeners['mouseenter']).toBeDefined();
			expect(token.listeners['mouseleave']).toBeDefined();
			expect(token.listeners['click']).toBeDefined();
		}
	});

	it('词元化后整句文本重建与原句一致（标点空白不丢失）', () => {
		const root = new FakeEl();
		renderHighlightedSentence(
			root as unknown as HTMLElement,
			SIMPLE.sentence,
			SIMPLE.components as never,
			SIMPLE.clauses,
		);

		expect(root.collectText()).toContain(SIMPLE.sentence);
	});

	it('句子成分标注标题旁渲染播放句子语音的喇叭（见 renderGrammarResult 用例）', () => {
		// 喇叭挂载在结果卡片层（renderGrammarResult），此处仅覆盖词元渲染
		const root = new FakeEl();
		renderHighlightedSentence(
			root as unknown as HTMLElement,
			SIMPLE.sentence,
			SIMPLE.components as never,
			SIMPLE.clauses,
		);
		expect(root.collectText()).toContain(SIMPLE.sentence);
	});
});

describe('renderGrammarResult（句子喇叭挂载）', () => {
	/** 递归查找带指定 aria-label 的按钮 */
	function findButton(el: FakeEl, label: string): FakeEl | undefined {
		const all = collectAll(el);
		return all.find(
			(node) => node.tag === 'button' && node.attrs['aria-label'] === label,
		);
	}

	it('句子成分标注标题旁存在播放句子语音按钮', () => {
		const root = new FakeEl();
		renderGrammarResult(
			root as unknown as HTMLElement,
			{
				sentence: 'The cat sat on the mat.',
				components: [{ text: 'The cat', type: 'subject' }],
				clauses: [
					{
						text: 'The cat sat on the mat.',
						level: 0,
						type: '主句',
						function: '全句主干',
					},
				],
				tense: ['一般过去时'],
				voice: '主动语态',
				mood: '陈述语气',
				sentenceType: '简单句',
				structureSummary: '主谓结构',
				translation: '猫坐在垫子上。',
			},
			'The cat sat on the mat.',
			1,
			1,
		);

		expect(findButton(root, '播放句子语音')).toBeDefined();
	});
});
