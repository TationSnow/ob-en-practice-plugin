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
	createRandomSeed,
	RANDOM_THEME,
	resolveSelectedTheme,
} from '../utils/writing-options';
import {
	createActionButton,
	createSegmentedControl,
} from './controls';
import { createCopyableText } from './copy-block';
import {
	createCollapsibleSection,
	createResultCard,
	createResultSection,
	createTag,
} from './sections';
import { createStatusLine } from './status';
import { createWorkflowStepper } from './workflow';
import { createDictionaryPanel } from './dictionary-panel';
import { runGrammarAnalysis } from './grammar-analysis-runner';
import { createSeedField, createThemeSelect } from './writing-controls';
import { onGrammarReference } from './panel-events';
import { getScoreClass } from '../utils/score';
import { insertTextAtCursor } from '../utils/editor';

/** 当前题目与流程状态 */
interface WritingState {
	question: TranslationQuestion | null;
	difficulty: Difficulty;
	theme: string;
	seed: string;
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
		theme: RANDOM_THEME,
		seed: '',
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

	createActionButton(root, '生成题目', runGenerate, {
		icon: 'sparkles',
		variant: 'primary',
		className: 'en-generate-button',
	});
	
	// 参考英语输入（可选），默认收起以突出主流程；
	// 文案需说明其用途：仅作语法结构参考，不会翻译原句，避免用户误解为“翻译这句”
	const refSection = createCollapsibleSection(
		root,
		'参考英语（可选，仅作语法参考）',
		false,
	);
	const refInput = refSection.content.createEl('textarea', {
		attr: {
			'aria-label': '参考英语表达（可选，仅作为语法结构参考）',
			placeholder: '输入参考英语句子，出题时仅参考其语法结构（可选）',
			rows: '2',
		},
	});
	refInput.addClass('en-text-input');

	// 难度分段控件
	const fieldRow = root.createDiv('en-field-row');
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

	// 主题下拉与随机数种子（可选），生成题目时随提示词一起发送
	const themeSelect = createThemeSelect(fieldRow, plugin, state.theme, (value) => {
		state.theme = value;
	});
	const seedInput = createSeedField(fieldRow);

	const generateStatus = createStatusLine(root);

	// 题目卡片容器（每次生成题目后重建）
	const questionArea = root.createDiv('en-result-list');
	questionArea.id = 'en-writing-question';
	questionArea.addClass('is-hidden');

	// 结果区：评估结果与语法分析共用（后一次分析替换前一次，二者互斥展示）
	const resultArea = root.createDiv('en-result-list');
	resultArea.id = 'en-writing-evaluation';
	resultArea.addClass('is-hidden');

	/** 生成一道翻译练习题 */
	async function runGenerate(): Promise<void> {
		const reference = refInput.value.trim();
		const theme = resolveSelectedTheme(
			themeSelect.getValue(),
			plugin.settings.writingThemes,
		);
		const seed = seedInput.value.trim() || createRandomSeed();
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
				{ theme, seed },
			);
			state.question = question;
			renderTranslationQuestion(
				questionArea,
				resultArea,
				question,
				state.difficulty,
				plugin,
				setStep,
				theme,
				seed,
				reference,
			);
			setStep(1);
			// 新题目已完整呈现，状态条不再追加“题目已生成”提示
			generateStatus.clear();
			generateStatus.hide();
		} catch (err) {
			generateStatus.setState('error');
			const message = err instanceof Error ? err.message : '未知错误';
			generateStatus.setText(`生成失败：${message}`);
			new Notice(`生成失败：${message}`);
		}
	}

	// 接收语法分析结果作为参考表达
	const unsubscribeReference = onGrammarReference(events, (sentence) => {
		refInput.value = sentence;
		refSection.setOpen(true);
	});

	return () => {
		unsubscribeReference();
	};
}

/**
 * 渲染翻译题目。
 * @param questionArea 题目容器
 * @param resultArea 结果区容器（评估结果与语法分析共用，互斥展示）
 * @param question 题目
 * @param difficulty 难度级别
 * @param plugin 插件实例
 * @param setStep 更新工作流步骤
 * @param theme 实际使用的主题（null 表示不指定）
 * @param seed 本次生成使用的随机数种子
 * @param reference 生成题目时使用的参考英语表达，评估时一并提供
 */
function renderTranslationQuestion(
	questionArea: HTMLElement,
	resultArea: HTMLElement,
	question: TranslationQuestion,
	difficulty: Difficulty,
	plugin: EnPracticePlugin,
	setStep: (step: number) => void,
	theme: string | null,
	seed: string,
	reference: string,
): void {
	questionArea.empty();
	questionArea.removeClass('is-hidden');

	// 重新生成题目时关闭上一题遗留的结果面板（评估结果/语法分析）
	resultArea.empty();
	resultArea.addClass('is-hidden');

	const card = createResultCard(questionArea, '题目');

	// 展示本次生成实际使用的主题与随机数种子，方便用户复现
	const metaRow = card.createDiv('en-tag-row');
	createTag(metaRow, `主题：${theme ?? '随机'}`, 'neutral');
	createTag(metaRow, `随机数种子：${seed}`, 'neutral');

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

		// 语法分析按钮在最左、评估翻译在右（配合容器右对齐与间距样式）：
		// 就地分析用户自己翻译的英文句子（复用语法分析模块的分句/routed
		// 分析/结果渲染共用流程），结果与评估结果互斥展示
		const actionContainer = card.createDiv('en-card-actions');
		createActionButton(
			actionContainer,
			'语法分析',
			async () => {
				const userTranslation = userInput.value.trim();
				if (!userTranslation) {
					new Notice('请输入你的翻译');
					return;
				}
				resultArea.empty();
				resultArea.removeClass('is-hidden');
				const grammarStatus = createStatusLine(resultArea);
				grammarStatus.show();
				await runGrammarAnalysis({
					plugin,
					input: userTranslation,
					status: grammarStatus,
					resultList: resultArea,
				});
			},
			{ icon: 'wand-2', variant: 'secondary' },
		);
		createActionButton(
			actionContainer,
			'评估翻译',
			async () => {
				const userTranslation = userInput.value.trim();
				if (!userTranslation) {
					new Notice('请输入你的翻译');
					return;
				}
				resultArea.empty();
				resultArea.removeClass('is-hidden');
				const evalStatus = createStatusLine(resultArea);
				evalStatus.setState('loading');
				evalStatus.setText('正在评估…');
				evalStatus.show();
				try {
					const result = await evaluateTranslation(
						question.chinese,
						userTranslation,
						reference,
						difficulty,
						plugin.settings,
						{ debug: plugin.settings.debugMode },
					);
					renderEvaluation(resultArea, result);
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

		// 写作查词：写作中忘记某个中文词的英文拼写，或想验证想到的英文单词时，
		// 就地双向查询（候选词含词性/释义/音标/词形变换），可一键插入本输入框
		// 光标处，避免切去其他词典页面产生分心（词典本地查询，确定性结果）；
		// 置于卡片层级（按钮区之后），与相邻区块共享卡片统一间距
		createDictionaryPanel(card, {
			onInsert: (word) => insertTextAtCursor(userInput, word),
		});
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
	createCopyableText(card, '优化版本', result.improvedVersion);
}
