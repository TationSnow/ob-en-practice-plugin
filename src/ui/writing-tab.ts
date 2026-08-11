import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import type {
	Difficulty,
	TranslationEvaluation,
	TranslationQuestion,
} from '../types';
import { DIFFICULTY_LABELS } from '../types';
import {
	evaluateTranslation,
	generateQuestion,
} from '../ai/translation-writing';
import {
	createActionButton,
	createIconButton,
	createSegmentedControl,
} from './controls';
import {
	createCollapsibleSection,
	createResultCard,
	createResultSection,
	createTag,
} from './sections';
import { createStatusLine } from './status';
import { createWorkflowStepper } from './workflow';
import { onGrammarReference } from './panel-events';
import { renderDebugPanel } from './debug-panel';
import { copyTextToClipboard } from '../utils/clipboard';
import { getScoreClass } from '../utils/score';

/** 当前题目与流程状态 */
interface WritingState {
	question: TranslationQuestion | null;
	difficulty: Difficulty;
	step: number;
}

/**
 * 渲染翻译写作模块。
 * @param container 父容器
 * @param plugin 插件实例
 * @param events 面板内共享的事件总线，用于接收语法分析参考句
 * @returns 清理函数
 */
export function renderWritingPractice(
	container: HTMLElement,
	plugin: EnPracticePlugin,
	events: EventTarget,
): () => void {
	const root = container.createDiv('en-writing-root');

	const state: WritingState = {
		question: null,
		difficulty: 'cet4',
		step: 0,
	};
	const stepper = createWorkflowStepper(
		root,
		[
			{ id: 'generate', label: '生成题目' },
			{ id: 'translate', label: '完成翻译' },
			{ id: 'evaluate', label: '查看评估' },
		],
		0,
	);
	const setStep = (step: number): void => {
		state.step = step;
		stepper.setStep(step);
	};

	// 参考英语输入（可选），默认收起以突出主流程
	const refSection = createCollapsibleSection(root, '参考英语（可选）', false);
	const refInput = refSection.content.createEl('textarea', {
		attr: {
			'aria-label': '参考英语表达（可选）',
			placeholder: '输入参考英语表达（可选）',
			rows: '2',
		},
	});
	refInput.addClass('en-text-input');

	// 难度分段控件
	const fieldRow = root.createDiv('en-field-row');
	fieldRow.createSpan('en-field-label').setText('难度');
	createSegmentedControl<Difficulty>(fieldRow, {
		ariaLabel: '题目难度',
		value: state.difficulty,
		options: (
			Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][]
		).map(([value, label]) => ({ value, label })),
		onChange: (value) => {
			state.difficulty = value;
		},
	});

	const generateStatus = createStatusLine(root);

	// 题目与评估结果容器（初始隐藏）
	const questionArea = root.createDiv('en-result-list');
	questionArea.id = 'en-writing-question';
	questionArea.addClass('is-hidden');
	const evalArea = root.createDiv('en-result-list');
	evalArea.id = 'en-writing-evaluation';
	evalArea.addClass('is-hidden');

	/** 生成一道翻译练习题 */
	async function runGenerate(): Promise<void> {
		const reference = refInput.value.trim();
		generateStatus.clear();
		generateStatus.setState('loading');
		generateStatus.setText('正在生成题目…');
		generateStatus.show();
		try {
			const question = await generateQuestion(
				reference,
				state.difficulty,
				plugin.settings,
				{ debug: plugin.settings.debugMode },
			);
			state.question = question;
			renderTranslationQuestion(
				questionArea,
				evalArea,
				question,
				state.difficulty,
				plugin,
				setStep,
			);
			setStep(1);
			generateStatus.setState('success');
			generateStatus.setText('题目已生成');
		} catch (err) {
			generateStatus.setState('error');
			const message = err instanceof Error ? err.message : '未知错误';
			generateStatus.setText(`生成失败：${message}`);
			new Notice(`生成失败：${message}`);
		}
	}

	createActionButton(root, '生成题目', runGenerate, {
		icon: 'sparkles',
		variant: 'primary',
		className: 'en-generate-button',
	});

	// 接收语法分析结果作为参考表达
	const unsubscribeReference = onGrammarReference(events, (sentence) => {
		refInput.value = sentence;
		refSection.setOpen(true);
	});

	// 调试模式：在翻译写作下方展示 AI 请求日志
	const unsubscribeDebug = plugin.settings.debugMode
		? renderDebugPanel(root)
		: () => {};

	return () => {
		unsubscribeReference();
		unsubscribeDebug();
	};
}

/**
 * 渲染翻译题目。
 * @param questionArea 题目容器
 * @param evalArea 评估结果容器
 * @param question 题目
 * @param difficulty 难度级别
 * @param plugin 插件实例
 * @param setStep 更新工作流步骤
 */
function renderTranslationQuestion(
	questionArea: HTMLElement,
	evalArea: HTMLElement,
	question: TranslationQuestion,
	difficulty: Difficulty,
	plugin: EnPracticePlugin,
	setStep: (step: number) => void,
): void {
	questionArea.empty();
	questionArea.removeClass('is-hidden');

	const card = createResultCard(questionArea, '题目');

	// 中文语句与提示
	const displaySection = createResultSection(card, '中文语句');
	displaySection.createEl('p', { text: question.chinese }).addClass(
		'en-chinese-text',
	);

	const tagRow = card.createDiv('en-tag-row');
	if (question.hint) {
		createTag(tagRow, question.hint, 'warning');
	}
	if (question.targetGrammar) {
		createTag(tagRow, question.targetGrammar, 'accent');
	}

	// 用户翻译输入
	const inputSection = createResultSection(card, '你的翻译');
	const userInput = inputSection.createEl('textarea', {
		attr: {
			'aria-label': '你的翻译',
			placeholder: '输入你的翻译...',
			rows: '3',
		},
	});
	userInput.addClass('en-text-input');

	const actionContainer = card.createDiv('en-card-actions');
	createActionButton(
		actionContainer,
		'评估翻译',
		async () => {
			const userTranslation = userInput.value.trim();
			if (!userTranslation) {
				new Notice('请输入你的翻译');
				return;
			}
			evalArea.empty();
			evalArea.removeClass('is-hidden');
			const evalStatus = createStatusLine(evalArea);
			evalStatus.setState('loading');
			evalStatus.setText('正在评估…');
			evalStatus.show();
			try {
				const result = await evaluateTranslation(
					question.chinese,
					userTranslation,
					'',
					difficulty,
					plugin.settings,
					{ debug: plugin.settings.debugMode },
				);
				renderEvaluation(evalArea, result);
				setStep(2);
			} catch (err) {
				evalStatus.setState('error');
				const message = err instanceof Error ? err.message : '未知错误';
				evalStatus.setText(`评估失败：${message}`);
				new Notice(`评估失败：${message}`);
			}
		},
		{ icon: 'check', variant: 'primary' },
	);
}

/**
 * 渲染评估结果。
 * @param container 容器
 * @param result 评估结果
 */
function renderEvaluation(
	container: HTMLElement,
	result: TranslationEvaluation,
): void {
	container.empty();
	container.removeClass('is-hidden');

	const card = createResultCard(container, '评估结果');

	// 分数等级
	const scoreRow = card.createDiv('en-score-row');
	const scoreBadge = scoreRow.createSpan('en-score-badge');
	scoreBadge.addClass(getScoreClass(result.score));
	scoreBadge.setText(`得分 ${result.score}`);
	scoreRow.createSpan('en-score-scale').setText('/100');

	// 优点与不足
	const strengthsSection = createResultSection(card, '优点');
	const strengthsList = strengthsSection.createEl('ul');
	for (const strength of result.strengths) {
		strengthsList.createEl('li', { text: strength });
	}

	const weaknessesSection = createResultSection(card, '不足');
	const weaknessesList = weaknessesSection.createEl('ul');
	for (const weakness of result.weaknesses) {
		weaknessesList.createEl('li', { text: weakness });
	}

	// 改进建议
	const suggestionsSection = createResultSection(card, '改进建议');
	suggestionsSection.createEl('p', { text: result.suggestions });

	// 优化版本与复制入口
	const improvedSection = createResultSection(card, '优化版本');
	const improvedBox = improvedSection.createDiv('en-improved-text');
	improvedBox.createEl('p', { text: result.improvedVersion });
	createIconButton(improvedBox, 'copy', '复制优化版本', () => {
		void copyTextToClipboard(result.improvedVersion)
			.then(() => new Notice('已复制优化版本'))
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				new Notice(`复制失败：${message}`);
			});
	});
}
