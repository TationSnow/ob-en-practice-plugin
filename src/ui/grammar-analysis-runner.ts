import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import { AiError } from '../types';
import { analyzeGrammarRouted } from '../ai/grammar-graph';
import { splitSentences, stripGrammarAnnotations } from '../utils/sentence';
import { renderImprovementResult } from './improvement-render';
import { renderGrammarResult } from './grammar-render';
import type { StatusLineControl } from './status';

/** 语法分析执行选项 */
export interface GrammarAnalysisRunOptions {
	/** 插件实例（读取设置与调试开关） */
	plugin: EnPracticePlugin;
	/** 用户输入的原始文本（可含多句，内部负责清理与分句） */
	input: string;
	/** 加载/成功/错误状态条（由宿主创建并布局在结果区附近） */
	status: StatusLineControl;
	/** 结果卡片渲染容器 */
	resultList: HTMLElement;
	/** 全部分析成功后的回调（参数为清理标注后的完整输入） */
	onSuccess?: (analyzedInput: string) => void;
	/** 分析失败后的回调（宿主用于复位自身状态，如隐藏辅助按钮） */
	onError?: () => void;
}

/**
 * 执行“按句分析 + 结果渲染”的完整语法分析流程（语法分析页与翻译写作页共用）。
 * 流程：清理历史括号标注 → 分句 → 逐句 routed 分析（LangGraph 编排，
 * 按是否发现问题自动分流到改进/分析节点）→ 渲染对应结果卡片。
 * 流式分片接入状态栏展示生成预览；解析失败等错误统一转为面向用户的简短文案。
 * @param options 执行选项
 */
export async function runGrammarAnalysis(
	options: GrammarAnalysisRunOptions,
): Promise<void> {
	const { plugin, status, resultList, onSuccess, onError } = options;
	// 清理上次渲染留下的括号标注，避免模型把标注符号当成原句
	const input = stripGrammarAnnotations(options.input.trim());
	if (!input) {
		new Notice('请输入要分析的英语句子');
		return;
	}
	const sentences = splitSentences(input);
	if (sentences.length === 0) {
		new Notice('未识别到有效的英语句子');
		return;
	}

	status.clear();
	status.setState('loading');
	status.setText(`正在分析第 1/${sentences.length} 句…`);
	status.show();
	resultList.empty();
	resultList.removeClass('is-hidden');

	// 流式输出累计缓冲，用于在状态栏展示生成预览
	let streamBuffer = '';

	try {
		for (let index = 0; index < sentences.length; index += 1) {
			const sentence = sentences[index];
			if (!sentence) continue;
			// 每句开始时重置流式缓冲
			streamBuffer = '';
			status.setText(`正在分析第 ${index + 1}/${sentences.length} 句…`);
			const result = await analyzeGrammarRouted(sentence, plugin.settings, {
				debug: plugin.settings.debugMode,
				// 把流式分片接入状态栏，让“启用流式输出”设置真正可见
				onToken: (token) => {
					streamBuffer = (streamBuffer + token).slice(-120);
					status.setText(
						`正在分析第 ${index + 1}/${sentences.length} 句… ` +
							`${streamBuffer.trimStart().slice(-40)}`,
					);
				},
			});
			if (result.route === 'improvement' && result.improvement) {
				renderImprovementResult(
					resultList,
					result.improvement,
					sentence,
					index + 1,
					sentences.length,
				);
			} else if (result.analysis) {
				renderGrammarResult(
					resultList,
					result.analysis,
					sentence,
					index + 1,
					sentences.length,
				);
			}
		}
		status.setState('success');
		status.setText(`分析完成，共 ${sentences.length} 句`);
		onSuccess?.(input);
	} catch (err) {
		status.setState('error');
		// 解析失败属于“模型格式问题”，原始 JSON 只留在调试面板，
		// 界面只展示面向用户的简短文案
		const message =
			err instanceof AiError && err.code === 'PARSE_ERROR'
				? '模型输出格式校验失败，请重试或换用更强的模型'
				: err instanceof Error
					? err.message
					: '未知错误';
		status.setText(`分析失败：${message}`);
		new Notice(`分析失败：${message}`);
		onError?.();
	}
}
