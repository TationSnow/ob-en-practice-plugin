/**
 * 语音朗读服务（系统 TTS）。
 *
 * 基于 Web Speech API（speechSynthesis）：Obsidian 桌面端为 Chromium 环境，
 * 原生支持且随操作系统提供英文声音，离线免费——句子与单词均直接朗读文本，
 * 无需音频资源与网络。移动端 WebView 支持不稳定，缺失时降级为 Notice 提示。
 */

import { Notice } from 'obsidian';

/** 判断当前环境是否支持语音朗读 */
export function isSpeechAvailable(): boolean {
	return typeof speechSynthesis !== 'undefined' && speechSynthesis !== null;
}

/**
 * 从声音列表中选择英文声音：en-US 优先，其次任意 en 开头的声音。
 * @param voices 系统声音列表
 * @returns 英文声音；无英文声音时返回 undefined（回退默认声音）
 */
function pickEnglishVoice(
	voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
	const english = voices.filter((voice) =>
		voice.lang.toLowerCase().startsWith('en'),
	);
	return (
		english.find((voice) => voice.lang.toLowerCase() === 'en-us') ??
		english[0]
	);
}

/**
 * 朗读英文文本（句子或单词）。
 * 重复调用会先打断上一次朗读，避免多段语音重叠；
 * 环境不支持时以 Notice 降级提示。
 * @param text 要朗读的英文文本
 * @returns 是否成功发起朗读
 */
export function speakEnglish(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	if (!isSpeechAvailable()) {
		new Notice('当前环境不支持语音播放');
		return false;
	}
	// 打断上一次朗读，保证新朗读立即开始
	speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(trimmed);
	// 语言标记兜底：即使系统没有英文声音，浏览器也会按英文规则拼读
	utterance.lang = 'en-US';
	const voice = pickEnglishVoice(speechSynthesis.getVoices());
	if (voice) {
		utterance.voice = voice;
	}
	speechSynthesis.speak(utterance);
	return true;
}

/** 打断当前朗读；环境缺失时静默忽略 */
export function stopSpeaking(): void {
	if (isSpeechAvailable()) {
		speechSynthesis.cancel();
	}
}
