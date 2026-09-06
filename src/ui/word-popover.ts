/**
 * 悬浮词卡：鼠标悬浮（或点击兜底）句子中的单词时，
 * 在单词正下方展示词典释义卡片（绝不遮挡单词本身）。
 *
 * - 定位：`position: fixed` 锚定单词矩形下方，水平方向钳制在视口内；
 *   fixed 元素不受祖先 overflow 裁剪（面板视图根无 transform），popout 安全；
 * - 数据：复用词典懒加载单例（与写作查词同源），仅精确命中视为收录，
 *   未收录时展示占位（喇叭仍可朗读——TTS 不依赖词典）；
 * - 单例管理：同屏仅一张词卡；隐藏时机 = 鼠标离开（150ms 宽限可移入卡片）、
 *   Escape、宿主重新渲染时显式调用 hideWordPopover。
 */

import { searchDictionary } from '../dictionary/dictionary-data';
import { formatWordForms } from '../dictionary/lookup';
import type { DictionaryMatch } from '../dictionary/types';
import { speakEnglish } from '../speech/tts';
import { createIconButton } from './controls';

/** 词卡宽度（与样式保持一致，用于水平钳制计算） */
const POPOVER_WIDTH = 320;
/** 距视口边缘的最小间距 */
const VIEWPORT_MARGIN = 8;
/** 单词与词卡之间的过渡间距（像素） */
const POPOVER_GAP = 4;
/** 鼠标离开后延迟关闭的宽限时间（毫秒），期间可移入词卡 */
const HIDE_GRACE_MS = 150;

/** 词卡挂载与事件清理的内部状态（单例；activeWord 供点击兜底判断） */
let activeWord: string | null = null;
let activeCleanup: (() => void) | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideTimer(): void {
	if (hideTimer !== null) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}
}

function scheduleHide(): void {
	clearHideTimer();
	hideTimer = setTimeout(() => {
		hideTimer = null;
		hideWordPopover();
	}, HIDE_GRACE_MS);
}

/** 隐藏当前词卡（幂等） */
export function hideWordPopover(): void {
	clearHideTimer();
	activeCleanup?.();
	activeCleanup = null;
	activeWord = null;
}

/**
 * 在目标元素下方展示单词释义卡片。
 * @param target 锚定元素（单词 span）
 * @param word 单词原文
 * @param options.limit 词典候选上限（默认 1，取精确命中）
 */
export function showWordPopover(
	target: HTMLElement,
	word: string,
	options: { limit?: number } = {},
): void {
	hideWordPopover();
	const doc = target.ownerDocument;
	const rect = target.getBoundingClientRect();
	const viewportWidth = doc.defaultView?.innerWidth ?? VIEWPORT_WIDTH_FALLBACK;

	// 水平钳制：优先与单词左对齐，超出视口右缘时左移
	const left = Math.min(
		Math.max(rect.left, VIEWPORT_MARGIN),
		Math.max(VIEWPORT_MARGIN, viewportWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
	);
	const top = rect.bottom + POPOVER_GAP;

	const popover = doc.body.createDiv('en-word-popover');
	popover.setAttr('role', 'dialog');
	popover.setAttr('aria-label', `单词释义：${word}`);
	popover.setAttr(
		'style',
		`top:${top}px;left:${left}px;width:${POPOVER_WIDTH}px;`,
	);

	// 标题行：单词 + 朗读喇叭（TTS 不依赖词典，未收录也可朗读）
	const head = popover.createDiv('en-word-popover-head');
	head.createSpan('en-word-popover-word').setText(word);
	createIconButton(head, 'volume-2', '播放单词语音', () => {
		speakEnglish(word);
	}, { compact: true });

	// 词义：仅精确命中视为词典收录；模糊候选不作为词义来源
	const matches = searchDictionary(word, {
		limit: options.limit ?? 1,
	});
	const exact = matches.find((match) => match.matchType === 0);
	if (exact) {
		renderMatchDetails(popover, exact);
	} else {
		popover
			.createEl('p', { text: '词典未收录' })
			.addClass('en-word-popover-empty');
	}

	// 事件：离开单词/词卡安排延迟关闭，移入词卡取消（宽限机制）
	const keyHandler = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') {
			hideWordPopover();
		}
	};
	const onTargetLeave = (): void => scheduleHide();
	const onPopoverEnter = (): void => clearHideTimer();
	const onPopoverLeave = (): void => scheduleHide();
	target.addEventListener('mouseleave', onTargetLeave);
	popover.addEventListener('mouseenter', onPopoverEnter);
	popover.addEventListener('mouseleave', onPopoverLeave);
	doc.addEventListener('keydown', keyHandler);

	activeWord = word;
	activeCleanup = () => {
		doc.removeEventListener('keydown', keyHandler);
		popover.remove();
	};
}

/** 渲染词典命中详情：音标 + 词性释义组 + 词形变换 */
function renderMatchDetails(
	popover: HTMLElement,
	match: DictionaryMatch,
): void {
	if (match.phonetic) {
		popover
			.createSpan('en-word-popover-phonetic')
			.setText(`/${match.phonetic}/`);
	}
	const sensesEl = popover.createDiv('en-word-popover-senses');
	for (const sense of match.senses) {
		const senseRow = sensesEl.createDiv('en-word-popover-sense');
		if (sense.p) {
			senseRow.createSpan('en-word-popover-pos').setText(sense.p);
		}
		senseRow.createSpan('en-word-popover-gloss').setText(sense.z);
	}
	if (match.exchange) {
		const formsText = formatWordForms(match.exchange);
		if (formsText) {
			const formsRow = popover.createDiv('en-word-popover-forms');
			formsRow.createSpan('en-word-popover-forms-label').setText('词形变换');
			formsRow.createSpan('en-word-popover-forms-text').setText(formsText);
		}
	}
}

/**
 * 点击兜底（移动端无悬浮）：同一单词再次点击关闭，不同单词替换内容。
 * @param target 锚定元素
 * @param word 单词原文
 */
export function toggleWordPopover(
	target: HTMLElement,
	word: string,
	options: { limit?: number } = {},
): void {
	if (activeWord === word) {
		hideWordPopover();
		return;
	}
	showWordPopover(target, word, options);
}

/** 为单词词元绑定悬浮/点击事件（供句子渲染层调用） */
export function attachWordTokenEvents(
	token: HTMLElement,
	word: string,
): void {
	token.addEventListener('mouseenter', () => {
		showWordPopover(token, word);
	});
	token.addEventListener('mouseleave', () => scheduleHide());
	token.addEventListener('click', () => {
		// 存在文本选区时不触发，避免与鼠标框选复制冲突
		const selection = token.ownerDocument?.getSelection?.();
		if (selection && !selection.isCollapsed) {
			return;
		}
		toggleWordPopover(token, word);
	});
}

/** 视口宽度的兜底值（defaultView 缺失时使用） */
const VIEWPORT_WIDTH_FALLBACK = 1024;
