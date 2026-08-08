/** 语法分析结果作为翻译写作参考句的事件名 */
export const GRAMMAR_REFERENCE_EVENT = 'grammar-reference';

/** 语法分析参考句事件载荷 */
export interface GrammarReferenceDetail {
	sentence: string;
}

/**
 * 向面板广播语法分析得到的参考句。
 * 翻译写作模块监听该事件后，可将句子填入参考英语输入框。
 * @param events 面板内共享的 EventTarget
 * @param sentence 分析的原句
 */
export function dispatchGrammarReference(
	events: EventTarget,
	sentence: string,
): void {
	events.dispatchEvent(
		new CustomEvent<GrammarReferenceDetail>(GRAMMAR_REFERENCE_EVENT, {
			detail: { sentence },
		}),
	);
}

/**
 * 订阅语法分析参考句事件。
 * @param events 面板内共享的 EventTarget
 * @param handler 收到句子后的回调
 * @returns 取消订阅函数
 */
export function onGrammarReference(
	events: EventTarget,
	handler: (sentence: string) => void,
): () => void {
	const listener = (event: Event): void => {
		const detail = (event as CustomEvent<GrammarReferenceDetail>).detail;
		if (detail) {
			handler(detail.sentence);
		}
	};
	events.addEventListener(GRAMMAR_REFERENCE_EVENT, listener);
	return () => {
		events.removeEventListener(GRAMMAR_REFERENCE_EVENT, listener);
	};
}
