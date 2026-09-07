import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	hideWordPopover,
	showWordPopover,
	toggleWordPopover,
} from '../src/ui/word-popover';
import type { DictionaryMatch } from '../src/dictionary/types';
import { resetRecordedMocks, StubElement } from './setup';

// 词典查询与语音朗读替换为桩实现
const { searchDictionaryMock, speakEnglishMock } = vi.hoisted(() => ({
	searchDictionaryMock: vi.fn(),
	speakEnglishMock: vi.fn(),
}));
vi.mock('../src/dictionary/dictionary-data', () => ({
	searchDictionary: searchDictionaryMock,
}));
vi.mock('../src/speech/tts', () => ({
	speakEnglish: speakEnglishMock,
}));

/** 构造词典命中候选 */
function createHappyMatch(): DictionaryMatch {
	return {
		word: 'happy',
		phonetic: "'hæpi",
		senses: [{ p: 'a.', z: '快乐的, 幸福的' }],
		tag: 'zk gk',
		matchType: 0,
	};
}

/** 构造悬浮目标（携带 ownerDocument 假文档与矩形） */
function createTarget() {
	const doc = {
		body: new StubElement(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		getSelection: vi.fn(() => ({ isCollapsed: true })),
		defaultView: { innerWidth: 1200, innerHeight: 800 },
	};
	const target = new StubElement();
	(target as unknown as { ownerDocument: unknown }).ownerDocument = doc;
	target.getBoundingClientRect = () => ({
		left: 100,
		top: 200,
		right: 160,
		bottom: 220,
		width: 60,
		height: 20,
	});
	const popovers = () =>
		doc.body.queryAll((el) => el.classes.has('en-word-popover'));
	return { doc, target, body: doc.body, popovers };
}

beforeEach(() => {
	resetRecordedMocks();
	searchDictionaryMock.mockReset();
	speakEnglishMock.mockReset();
	hideWordPopover();
});

describe('showWordPopover（悬浮词卡）', () => {
	it('词典命中：渲染单词标题、音标与词性释义，定位在单词正下方', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);

		showWordPopover(target as unknown as HTMLElement, 'happy');

		expect(popovers()).toHaveLength(1);
		const popover = popovers()[0];
		// 定位：单词矩形下方（bottom 220 + 间距 4），水平钳制在视口内
		expect(popover?.attrs['style']).toContain('top:224px');
		expect(popover?.attrs['style']).toContain('left:100px');

		const word = popover?.queryAll((el) =>
			el.classes.has('en-word-popover-word'),
		)[0];
		expect(word?.text).toBe('happy');
		const senses = popover?.queryAll((el) =>
			el.classes.has('en-word-popover-sense'),
		);
		expect(senses).toHaveLength(1);
		// 展示时不自动朗读
		expect(speakEnglishMock).not.toHaveBeenCalled();
	});

	it('同屏仅保留一张词卡（再次悬浮替换）', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);

		showWordPopover(target as unknown as HTMLElement, 'happy');
		showWordPopover(target as unknown as HTMLElement, 'happy');

		expect(popovers()).toHaveLength(1);
	});

	it('词典未收录时展示占位，喇叭仍可朗读', () => {
		const { target, body } = createTarget();
		searchDictionaryMock.mockReturnValue([]);

		showWordPopover(target as unknown as HTMLElement, 'qqqxx');

		const empty = body.queryAll((el) =>
			el.classes.has('en-word-popover-empty'),
		)[0];
		expect(empty?.text).toContain('词典未收录');
		// 未收录仍可朗读
		const speakButton = body
			.queryAll((el) => el.tag === 'button')
			.find((el) => el.attrs['aria-label'] === '播放单词语音');
		speakButton?.trigger('click');
		expect(speakEnglishMock).toHaveBeenCalledWith('qqqxx');
	});

	it('模糊命中的候选不作为词义来源（仅精确命中才算词典收录）', () => {
		const { target, body } = createTarget();
		searchDictionaryMock.mockReturnValue([
			{ ...createHappyMatch(), word: 'happy', matchType: 4 },
		]);
		showWordPopover(target as unknown as HTMLElement, 'happi');

		expect(
			body.queryAll((el) => el.classes.has('en-word-popover-empty')),
		).toHaveLength(1);
	});

	it('单词标题旁的喇叭点击后朗读单词（独立于展示逻辑）', () => {
		const { target, body } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);

		showWordPopover(target as unknown as HTMLElement, 'happy');

		const speakButton = body
			.queryAll((el) => el.tag === 'button')
			.find((el) => el.attrs['aria-label'] === '播放单词语音');
		speakButton?.trigger('click');
		expect(speakEnglishMock).toHaveBeenCalledWith('happy');
	});

	it('Escape 关闭词卡', () => {
		const { doc, target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);
		showWordPopover(target as unknown as HTMLElement, 'happy');

		const keyHandler = doc.addEventListener.mock.calls.find(
			(call) => call[0] === 'keydown',
		)?.[1] as (event: { key: string }) => void;
		keyHandler({ key: 'Escape' });

		expect(popovers()).toHaveLength(0);
		expect(doc.removeEventListener).toHaveBeenCalledWith(
			'keydown',
			keyHandler,
		);
	});

	it('鼠标离开单词后延迟关闭，期间可移入词卡（宽限机制）', () => {
		vi.useFakeTimers();
		try {
			const { target, body, popovers } = createTarget();
			searchDictionaryMock.mockReturnValue([createHappyMatch()]);
			showWordPopover(target as unknown as HTMLElement, 'happy');

			// 离开单词：安排延迟关闭
			target.trigger('mouseleave');
			expect(popovers()).toHaveLength(1);

			// 宽限期内移入词卡：取消关闭
			const popover = popovers()[0];
			popover?.trigger('mouseenter');
			vi.advanceTimersByTime(300);
			expect(popovers()).toHaveLength(1);

			// 未在宽限期内移入：延迟后关闭
			popover?.trigger('mouseleave');
			vi.advanceTimersByTime(300);
			expect(popovers()).toHaveLength(0);
			expect(body.children).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('toggleWordPopover（点击兜底）', () => {
	it('同一单词再次点击关闭卡片', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);

		toggleWordPopover(target as unknown as HTMLElement, 'happy');
		expect(popovers()).toHaveLength(1);

		toggleWordPopover(target as unknown as HTMLElement, 'happy');
		expect(popovers()).toHaveLength(0);
	});

	it('不同单词点击替换卡片内容', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock
			.mockReturnValueOnce([createHappyMatch()])
			.mockReturnValueOnce([
				{
					word: 'government',
					senses: [{ p: 'n.', z: '政府, 内阁' }],
					matchType: 0,
				},
			]);

		toggleWordPopover(target as unknown as HTMLElement, 'happy');
		toggleWordPopover(target as unknown as HTMLElement, 'government');

		expect(popovers()).toHaveLength(1);
	});
});

describe('词形归一化标注（悬浮卡）', () => {
	it('命中 formOf 时渲染词形来源标注行', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([
			{
				word: 'improve',
				phonetic: "im'pru:v",
				senses: [{ p: 'vt.', z: '改良, 改善' }],
				matchType: 0,
				formOf: { word: 'improve', code: '3' },
			},
		]);

		showWordPopover(target as unknown as HTMLElement, 'improves');

		const formOf = popovers()[0]?.queryAll((el) =>
			el.classes.has('en-word-popover-formof'),
		)[0];
		expect(formOf?.text).toBe('improve 的三单形式');
	});

	it('无 formOf 时不渲染标注行（原形词/通配命中）', () => {
		const { target, popovers } = createTarget();
		searchDictionaryMock.mockReturnValue([createHappyMatch()]);

		showWordPopover(target as unknown as HTMLElement, 'happy');

		expect(
			popovers()[0]?.queryAll((el) =>
				el.classes.has('en-word-popover-formof'),
			),
		).toHaveLength(0);
	});
});
