/**
 * 生词本共享控件：单词的"加入/移出生词本"切换按钮。
 *
 * 顶栏管理弹窗、写作查词面板、语法分析悬浮词卡共用本控件，
 * 保证三处入口的行为与样式一致：
 * - 样式与 TTS 朗读按钮同源（createIconButton，compact 紧凑变体），
 *   已收录时追加 en-icon-button--active 高亮（样式见 styles.css）；
 * - 点击后立即切换收录状态并就地刷新图标；
 * - observe 模式（短命容器如悬浮词卡）内部订阅服务自动刷新；
 *   非订阅模式（如查词面板多行）由外部在服务变更时调用
 *   refreshVocabularyButtons 批量刷新，避免每行各自订阅。
 */
import { setIcon } from 'obsidian';
import { getVocabularyService } from '../vocabulary/service';
import type { VocabularyChangeDetail } from '../vocabulary/service';
import type { VocabularyEntryDraft } from '../vocabulary/types';
import { createIconButton } from './controls';

/** 词本切换按钮的标记类（批量刷新用的选择器） */
export const VOCAB_TOGGLE_BUTTON_CLASS = 'en-vocab-toggle';

/** 词本切换按钮记录目标单词的 data 属性名 */
export const VOCAB_WORD_ATTR = 'data-vocab-word';

/** 未收录态图标（加入生词本） */
const ADD_ICON = 'book-plus';
/** 已收录态图标（移出生词本） */
const REMOVE_ICON = 'book-x';

/** 词本切换按钮的可选配置 */
export interface VocabularyToggleOptions {
	/**
	 * 紧凑变体（与词卡/查词行的 TTS 朗读按钮一致）；默认 false。
	 */
	compact?: boolean;
	/**
	 * 内部订阅服务变更：同词增删后自动刷新按钮。
	 * 适用于生命周期由调用方显式管理的短命容器（如悬浮词卡，
	 * cleanup 并入 activeCleanup）。默认 false：由外部在服务变更时
	 * 调用 refreshVocabularyButtons 批量刷新，避免多行重复订阅。
	 */
	observe?: boolean;
	/** 收录时提供词条快照（音标/释义/备注）；未提供时仅收录单词 */
	getDraft?: () => VocabularyEntryDraft;
}

/** 词本切换按钮控制器 */
export interface VocabularyToggleButtonControl {
	/** 按服务当前状态重绘按钮（图标/高亮/无障碍名称） */
	refresh(): void;
	/** 释放内部订阅（仅 observe 模式有实际动作） */
	cleanup(): void;
}

/**
 * 按服务状态渲染单个词本按钮（创建与批量刷新共用，保证两路渲染一致）。
 * @param button 按钮元素
 * @param word 目标单词
 * @param known 是否已收录
 */
function applyVocabularyButtonState(
	button: HTMLElement,
	word: string,
	known: boolean,
): void {
	button.toggleClass('en-icon-button--active', known);
	button.setAttr(
		'aria-label',
		known ? `从生词本移除 ${word}` : `将 ${word} 加入生词本`,
	);
	setIcon(button, known ? REMOVE_ICON : ADD_ICON);
}

/**
 * 创建"加入/移出生词本"切换按钮。
 * @param container 父容器
 * @param word 目标单词（词元优先，如悬浮 "sat" 传 "sit"）
 * @param options 可选配置
 * @returns 按钮控制器
 */
export function createVocabularyToggleButton(
	container: HTMLElement,
	word: string,
	options: VocabularyToggleOptions = {},
): VocabularyToggleButtonControl {
	const service = getVocabularyService();
	const button = createIconButton(container, ADD_ICON, '', () => {
		void toggleVocabulary();
	}, { compact: options.compact ?? false });
	button.addClass(VOCAB_TOGGLE_BUTTON_CLASS);
	button.setAttr(VOCAB_WORD_ATTR, word);

	/** 点击切换收录状态，随后就地刷新按钮 */
	const toggleVocabulary = async (): Promise<void> => {
		if (service.has(word)) {
			await service.remove(word);
		} else {
			await service.add(options.getDraft?.() ?? { word });
		}
		apply();
	};

	// observe 模式：订阅服务，仅响应同词变更（外部批量刷新场景无需订阅）
	let unsubscribe: (() => void) | null = null;
	if (options.observe) {
		unsubscribe = service.subscribe((detail: VocabularyChangeDetail) => {
			if (detail.word.toLowerCase() === word.toLowerCase()) {
				apply();
			}
		});
	}

	const apply = (): void => {
		applyVocabularyButtonState(button, word, service.has(word));
	};

	apply();
	return {
		refresh: apply,
		cleanup: () => {
			unsubscribe?.();
			unsubscribe = null;
		},
	};
}

/**
 * 批量刷新容器内全部词本切换按钮（服务变更后由订阅方调用）。
 * 通过标记类与 data 属性定位按钮，不依赖具体业务容器结构。
 * @param root 查询根容器
 */
export function refreshVocabularyButtons(root: HTMLElement): void {
	const service = getVocabularyService();
	const buttons = root.querySelectorAll(`button.${VOCAB_TOGGLE_BUTTON_CLASS}`);
	for (const button of Array.from(buttons)) {
		const word = button.getAttribute(VOCAB_WORD_ATTR);
		if (!word) continue;
		applyVocabularyButtonState(button as HTMLElement, word, service.has(word));
	}
}
