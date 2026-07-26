import { Notice } from 'obsidian';
import type EnPracticePlugin from '../main';
import type { Difficulty, TranslationQuestion, TranslationEvaluation } from '../types';
import { DIFFICULTY_LABELS } from '../types';
import { generateQuestion, evaluateTranslation } from '../ai/translation-writing';
import {
	createCollapsibleSection,
	createActionButton,
	createResultSection,
} from './components';

/** 当前题目状态 */
interface WritingState {
	question: TranslationQuestion | null;
	difficulty: Difficulty;
}

/** DOM 选择器常量 */
const QUESTION_SELECTOR = '#en-writing-question';
const EVAL_SELECTOR = '#en-writing-evaluation';

/**
 * 渲染翻译写作模块
 * @param container 父容器
 * @param plugin 插件实例
 */
export function renderWritingPractice(
	container: HTMLElement,
	plugin: EnPracticePlugin,
): void {
	const section = createCollapsibleSection(container, '翻译写作');
	const state: WritingState = { question: null, difficulty: 'cet4' };

	// 参考英语输入（可选）
	const refLabel = section.createEl('label', { text: '参考英语（可选）' });
	refLabel.addClass('en-field-label');
	const refInput = section.createEl('textarea', {
		attr: { placeholder: '输入参考英语表达（可选）', rows: '2' },
	});
	refInput.addClass('en-text-input');

	// 难度下拉选择
	const diffContainer = section.createDiv('en-field-row');
	diffContainer.createEl('label', { text: '难度：' });
	const diffSelect = diffContainer.createEl('select');
	for (const [key, label] of Object.entries(DIFFICULTY_LABELS)) {
		const option = diffSelect.createEl('option', { value: key, text: label });
		if (key === 'cet4') option.selected = true;
	}
	diffSelect.addEventListener('change', () => {
		state.difficulty = diffSelect.value as Difficulty;
	});

	// 生成按钮
	createActionButton(section, '一键生成', async () => {
		const reference = refInput.value.trim();
		try {
			const question = await generateQuestion(
				reference,
				state.difficulty,
				plugin.settings,
			);
			state.question = question;
			renderTranslationQuestion(section, question, state.difficulty, plugin);
		} catch (err) {
			new Notice(
				`生成失败：${err instanceof Error ? err.message : '未知错误'}`,
			);
		}
	});

	// 题目展示区（初始隐藏）
	const questionArea = section.createDiv('en-result-area');
	questionArea.id = 'en-writing-question';
	questionArea.addClass('en-hidden');

	// 评估结果展示区（初始隐藏）
	const evalArea = section.createDiv('en-result-area');
	evalArea.id = 'en-writing-evaluation';
	evalArea.addClass('en-hidden');
}

/**
 * 渲染翻译题目
 * @param container 父容器
 * @param question 题目
 * @param difficulty 难度级别
 */
function renderTranslationQuestion(
	container: HTMLElement,
	question: TranslationQuestion,
	difficulty: Difficulty,
	plugin: EnPracticePlugin,
): void {
	const questionArea = container.querySelector(
		QUESTION_SELECTOR,
	) as HTMLElement;
	questionArea.empty();
	questionArea.removeClass('en-hidden');

	const displaySection = createResultSection(questionArea, '中文语句');
	displaySection.createEl('p', { text: question.chinese }).addClass('en-chinese-text');

	if (question.hint) {
		const hintSection = createResultSection(questionArea, '提示');
		hintSection.createEl('p', { text: question.hint }).addClass('en-hint-text');
	}

	// 用户翻译输入
	const inputSection = createResultSection(questionArea, '你的翻译');
	const userInput = inputSection.createEl('textarea', {
		attr: { placeholder: '输入你的翻译...', rows: '3' },
	});
	userInput.addClass('en-text-input');

	// 评估按钮
	const evalBtnContainer = questionArea.createDiv('en-button-container');
	const evalArea = container.querySelector(EVAL_SELECTOR) as HTMLElement;

	evalArea.empty();
	evalArea.addClass('en-hidden');

	createActionButton(evalBtnContainer, '📊 一键评估', async () => {
		const userTranslation = userInput.value.trim();
		if (!userTranslation) {
			new Notice('请输入你的翻译');
			return;
		}
		try {
			const result = await evaluateTranslation(
				question.chinese,
				userTranslation,
				question.hint,
				difficulty,
				plugin.settings,
			);
			renderEvaluation(evalArea, result);
		} catch (err) {
			new Notice(
				`评估失败：${err instanceof Error ? err.message : '未知错误'}`,
			);
		}
	});
}

/**
 * 渲染评估结果
 * @param container 容器
 * @param result 评估结果
 */
function renderEvaluation(
	container: HTMLElement,
	result: TranslationEvaluation,
): void {
	container.empty();
	container.removeClass('en-hidden');

	const scoreSection = createResultSection(container, '评估结果');
	scoreSection.createEl('p', {
		text: `得分：${result.score}/100`,
	}).addClass('en-score-text');

	const strengthsSection = createResultSection(container, '优点');
	const strengthsList = strengthsSection.createEl('ul');
	for (const s of result.strengths) {
		strengthsList.createEl('li', { text: s });
	}

	const weaknessesSection = createResultSection(container, '不足');
	const weaknessesList = weaknessesSection.createEl('ul');
	for (const w of result.weaknesses) {
		weaknessesList.createEl('li', { text: w });
	}

	const suggestionsSection = createResultSection(container, '改进建议');
	suggestionsSection.createEl('p', { text: result.suggestions });

	const improvedSection = createResultSection(container, '优化版本');
	improvedSection.createEl('p', { text: result.improvedVersion }).addClass('en-improved-text');
}
