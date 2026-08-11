/** 工作流步骤定义 */
export interface WorkflowStep {
	id: string;
	label: string;
}

/** 工作流步骤指示器控制器 */
export interface WorkflowStepperControl {
	setStep(index: number): void;
}

/**
 * 创建翻译写作的三步工作流指示器。
 * @param container 父容器
 * @param steps 步骤列表
 * @param initialIndex 当前步骤
 * @returns 步骤指示器控制器
 */
export function createWorkflowStepper(
	container: HTMLElement,
	steps: WorkflowStep[],
	initialIndex = 0,
): WorkflowStepperControl {
	const root = container.createEl('ol', { attr: { role: 'list' } });
	root.addClass('en-workflow-steps');

	const items: HTMLLIElement[] = steps.map((step, index) => {
		const item = root.createEl('li');
		item.addClass('en-workflow-step');
		if (index === initialIndex) item.addClass('is-current');
		item.setAttr('aria-current', index === initialIndex ? 'step' : 'false');

		const badge = item.createSpan('en-workflow-step-badge');
		badge.setText(String(index + 1));
		item.createSpan('en-workflow-step-label').setText(step.label);
		return item;
	});

	return {
		setStep: (index: number) => {
			for (let i = 0; i < items.length; i += 1) {
				const item = items[i];
				if (!item) continue;
				const current = i === index;
				item.toggleClass('is-current', current);
				item.setAttr('aria-current', current ? 'step' : 'false');
			}
		},
	};
}
