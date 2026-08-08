import { describe, expect, it, vi } from 'vitest';
import {
	dispatchGrammarReference,
	onGrammarReference,
} from '../src/ui/panel-events';

describe('panel-events', () => {
	it('语法分析参考句事件可被翻译写作模块接收', () => {
		const events = new EventTarget();
		const handler = vi.fn();

		onGrammarReference(events, handler);
		dispatchGrammarReference(events, 'The cat sat on the mat.');

		expect(handler).toHaveBeenCalledWith('The cat sat on the mat.');
	});

	it('取消订阅后不再接收事件', () => {
		const events = new EventTarget();
		const handler = vi.fn();

		const unsubscribe = onGrammarReference(events, handler);
		unsubscribe();
		dispatchGrammarReference(events, 'Hello world.');

		expect(handler).not.toHaveBeenCalled();
	});
});
