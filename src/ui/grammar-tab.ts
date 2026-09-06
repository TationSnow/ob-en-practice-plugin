import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import { createActionButton, createIconButton } from './controls';
import { createStatusLine } from './status';
import { dispatchGrammarReference } from './panel-events';
import { runGrammarAnalysis } from './grammar-analysis-runner';

/** 语法分析页与外部协作所需的回调 */
export interface GrammarAnalysisCallbacks {
	/** 语法分析结果用于翻译写作时切换页签 */
	onUseForWriting: (sentence: string) => void;
	/** 从当前笔记获取选中文本 */
	getSelection?: () => string | null;
}

/**
 * 渲染语法分析模块。
 * 分析流程（分句、逐句 routed 分析、结果渲染）由 grammar-analysis-runner
 * 提供，与翻译写作页的“语法分析”按钮共用同一实现。
 * @param container 父容器
 * @param plugin 插件实例
 * @param events 面板内共享的事件总线，用于和翻译写作模块联动
 * @param callbacks 页签切换与选区导入回调
 * @returns 清理函数
 */
export function renderGrammarAnalysis(
	container: HTMLElement,
	plugin: EnPracticePlugin,
	events: EventTarget,
	callbacks: GrammarAnalysisCallbacks,
): () => void {
	// 输入区与工具栏
	const composer = container.createDiv('en-composer');

	const textarea = composer.createEl('textarea', {
		attr: {
			'aria-label': '输入英语句子',
			placeholder: '粘贴或输入英语句子...',
			rows: '4',
		},
	});
	textarea.addClass('en-text-input');

	const toolbar = composer.createDiv('en-toolbar');
	createIconButton(toolbar, 'import', '导入当前选区', () => {
		const selection = callbacks.getSelection?.() ?? null;
		if (!selection) {
			new Notice('当前笔记没有选中文本');
			return;
		}
		textarea.value = selection;
		textarea.focus();
	});
	createIconButton(toolbar, 'trash-2', '清空输入', () => {
		textarea.value = '';
		analyzedInput = '';
		useForWritingButton.addClass('is-hidden');
		status.clear();
		status.hide();
		resultList.empty();
		resultList.addClass('is-hidden');
	});
	toolbar.createDiv('en-toolbar-spacer');

	const status = createStatusLine(composer);
	const resultList = container.createDiv('en-result-list');
	resultList.addClass('is-hidden');

	// 最近一次成功分析的完整输入，供“用于翻译写作”按钮使用
	let analyzedInput = '';

	/** 对输入内容按句分析（共用流程），成功后允许“用于翻译写作” */
	async function runAnalysis(): Promise<void> {
		analyzedInput = '';
		useForWritingButton.addClass('is-hidden');
		await runGrammarAnalysis({
			plugin,
			input: textarea.value,
			status,
			resultList,
			onSuccess: (analyzed) => {
				analyzedInput = analyzed;
				useForWritingButton.removeClass('is-hidden');
			},
		});
	}

	// 分析完成后，将整段输入作为参考英语用于翻译写作
	const useForWritingButton = createActionButton(
		toolbar,
		'用于翻译写作',
		async () => {
			if (!analyzedInput) {
				new Notice('请先完成语法分析');
				return;
			}
			dispatchGrammarReference(events, analyzedInput);
			callbacks.onUseForWriting(analyzedInput);
			new Notice('已将分析内容填入参考英语表达');
		},
		{ icon: 'arrow-right', variant: 'secondary' },
	);
	useForWritingButton.addClass('is-hidden');

	createActionButton(toolbar, '分析', runAnalysis, {
		icon: 'wand-2',
		variant: 'primary',
	});
	return () => {};
}
