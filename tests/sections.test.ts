import { describe, expect, it, vi } from 'vitest';
import { createResultSection } from '../src/ui/sections';
import { StubElement, type StubElementLike } from './setup';

describe('createResultSection', () => {
	it('默认渲染标题 h4 与内容容器', () => {
		const container = new StubElement();
		const content = createResultSection(
			container as unknown as HTMLElement,
			'句子成分标注',
		);

		const heading = container
			.queryAll((el) => el.tag === 'h4')[0]
			?.text;
		expect(heading).toBe('句子成分标注');
		// content 为 HTMLElement（真实返回类型），经结构化桩承载渲染
		const contentStub = content as unknown as StubElementLike;
		expect(contentStub.classes.has('en-result-content')).toBe(true);
	});

	it('headingExtra 在标题渲染后收到 h4 元素，可追加标题旁动作', () => {
		const container = new StubElement();
		const headingExtra = vi.fn((heading: HTMLElement) => {
			heading.createDiv('en-section-action');
		});

		createResultSection(
			container as unknown as HTMLElement,
			'句子成分标注',
			{ headingExtra },
		);

		expect(headingExtra).toHaveBeenCalledTimes(1);
		// 动作元素挂在 h4 内部，与其同行展示
		const heading = container.queryAll((el) => el.tag === 'h4')[0];
		expect(
			heading?.children.some((child) =>
				child.classes.has('en-section-action'),
			),
		).toBe(true);
	});
});
