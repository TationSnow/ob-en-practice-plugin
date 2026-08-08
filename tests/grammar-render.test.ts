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
});
