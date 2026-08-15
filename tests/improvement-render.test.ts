import { describe, expect, it } from 'vitest';
import { renderImprovementResult } from '../src/ui/improvement-render';
import type { GrammarImprovementResult } from '../src/types';

/** 最小 DOM 桩，用于在 Node 环境验证改进结果渲染 */
class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';
	tag = 'div';
	attrs: Record<string, string> = {};
	listeners: Record<string, () => void> = {};

	createEl(
		tag: string,
		opts?: {
			text?: string;
			attr?: Record<string, string>;
		},
	): FakeEl {
		const el = new FakeEl();
		el.tag = tag;
		if (opts?.text) el.text = opts.text;
		if (opts?.attr) {
			for (const [key, value] of Object.entries(opts.attr)) {
				el.attrs[key] = value;
			}
		}
		this.children.push(el);
		return el;
	}

	createDiv(cls?: string): FakeEl {
		const el = new FakeEl();
		if (cls) el.addClass(cls);
		this.children.push(el);
		return el;
	}

	createSpan(cls?: string): FakeEl {
		const el = new FakeEl();
		el.tag = 'span';
		if (cls) el.addClass(cls);
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

	setAttr(key: string, value: string): void {
		this.attrs[key] = value;
	}

	addEventListener(_type: string, callback: () => void): void {
		this.listeners[_type] = callback;
	}

	collectText(): string {
		return `${this.text}${this.children
			.map((child) => child.collectText())
			.join('')}`;
	}
}

const RESULT: GrammarImprovementResult = {
	sentence: 'I am interesting in between read and write.',
	issues: [
		{
			text: 'am interesting in',
			type: '搭配错误',
			explanation: 'be interested in 是固定搭配。',
			suggestion: '改为 am interested in',
		},
	],
	patterns: [
		{
			pattern: 'between ... and ...',
			usage: '后接名词或动名词。',
			example: 'She is torn between staying and leaving.',
		},
	],
	suggestions: ['修正固定搭配后句子即可恢复正确。'],
	improvedSentence: 'I am interested in reading and writing.',
};

describe('renderImprovementResult', () => {
	it('渲染错误、句式、建议与改进句子', () => {
		const root = new FakeEl();

		renderImprovementResult(
			root as unknown as HTMLElement,
			RESULT,
			RESULT.sentence,
			1,
			1,
		);

		const rendered = root.collectText();
		expect(rendered).toContain('语法改进');
		expect(rendered).toContain('搭配错误');
		expect(rendered).toContain('between ... and ...');
		expect(rendered).toContain('改进后的句子');
		expect(rendered).toContain('I am interested in reading and writing.');
	});
});
