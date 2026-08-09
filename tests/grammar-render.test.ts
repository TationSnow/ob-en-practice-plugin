import { describe, expect, it } from 'vitest';
import { renderHighlightedSentence } from '../src/ui/components';

/** 最小 DOM 桩，用于在 Node 环境验证渲染逻辑 */
class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';

	createEl(_tag: string, opts?: { text?: string }): FakeEl {
		const el = new FakeEl();
		if (opts?.text) {
			el.text = opts.text;
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
