import { describe, expect, it, vi, afterEach } from 'vitest';
import { isSpeechAvailable, speakEnglish, stopSpeaking } from '../src/speech/tts';
import { getNoticeMessages, resetRecordedMocks } from './setup';

/** 构造可注入 globalThis 的假 speechSynthesis 与发声类 */
function createFakeSpeech(voices: Array<{ lang: string; name: string }> = []) {
	const fakeUtterances: Array<{
		text: string;
		lang: string;
		voice: unknown;
	}> = [];
	class FakeUtterance {
		text: string;
		lang = '';
		voice: unknown = null;
		constructor(text: string) {
			this.text = text;
			fakeUtterances.push(this);
		}
	}
	const fake = {
		cancel: vi.fn(),
		speak: vi.fn(),
		getVoices: vi.fn(() => voices),
	};
	return { fake, FakeUtterance, fakeUtterances };
}

/** 注入假实现（模拟桌面端 Electron 环境） */
function injectFakeSpeech(
	voices: Array<{ lang: string; name: string }> = [],
) {
	const fakeSpeech = createFakeSpeech(voices);
	(globalThis as Record<string, unknown>).speechSynthesis = fakeSpeech.fake;
	(globalThis as Record<string, unknown>).SpeechSynthesisUtterance =
		fakeSpeech.FakeUtterance;
	return fakeSpeech;
}

/** 移除注入的假实现（模拟移动端等不支持的环境） */
function removeFakeSpeech(): void {
	delete (globalThis as Record<string, unknown>).speechSynthesis;
	delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
}

afterEach(() => {
	removeFakeSpeech();
	resetRecordedMocks();
	vi.restoreAllMocks();
});

describe('isSpeechAvailable', () => {
	it('桌面端存在 speechSynthesis 时可用', () => {
		injectFakeSpeech();
		expect(isSpeechAvailable()).toBe(true);
	});

	it('移动端等缺失环境不可用', () => {
		removeFakeSpeech();
		expect(isSpeechAvailable()).toBe(false);
	});
});

describe('speakEnglish', () => {
	it('朗读文本：语言设为英文，优先选择 en-US 声音', () => {
		const { fake, fakeUtterances } = injectFakeSpeech([
			{ lang: 'zh-CN', name: '中文' },
			{ lang: 'en-GB', name: '英式' },
			{ lang: 'en-US', name: '美式' },
		]);

		expect(speakEnglish('The cat sat on the mat.')).toBe(true);

		expect(fake.cancel).toHaveBeenCalledTimes(1);
		expect(fake.speak).toHaveBeenCalledTimes(1);
		const utterance = fakeUtterances[0];
		expect(utterance?.text).toBe('The cat sat on the mat.');
		expect(utterance?.lang).toBe('en-US');
		expect((utterance?.voice as { lang: string } | null)?.lang).toBe(
			'en-US',
		);
	});

	it('仅非英文声音时回退默认声音（不设置 voice），仍保留 en-US 语言标记', () => {
		const { fake, fakeUtterances } = injectFakeSpeech([
			{ lang: 'zh-CN', name: '中文' },
		]);

		speakEnglish('hello');

		const utterance = fakeUtterances[0];
		expect(utterance?.lang).toBe('en-US');
		expect(utterance?.voice).toBeNull();
		expect(fake.speak).toHaveBeenCalledTimes(1);
	});

	it('重复播放先打断上一次', () => {
		const { fake } = injectFakeSpeech();

		speakEnglish('one');
		speakEnglish('two');

		expect(fake.cancel).toHaveBeenCalledTimes(2);
	});

	it('空白文本不发起朗读', () => {
		const { fake } = injectFakeSpeech();
		expect(speakEnglish('   ')).toBe(false);
		expect(fake.speak).not.toHaveBeenCalled();
	});

	it('环境不支持时降级提示并返回 false', () => {
		removeFakeSpeech();
		expect(speakEnglish('hello')).toBe(false);
		expect(getNoticeMessages()).toContain('当前环境不支持语音播放');
	});
});

describe('stopSpeaking', () => {
	it('打断当前朗读；环境缺失时静默忽略', () => {
		const { fake } = injectFakeSpeech();
		stopSpeaking();
		expect(fake.cancel).toHaveBeenCalledTimes(1);

		removeFakeSpeech();
		expect(() => stopSpeaking()).not.toThrow();
	});
});
