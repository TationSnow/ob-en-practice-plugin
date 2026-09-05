import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { EnPracticeSettings } from '../settings';
import type {
	GrammarImprovementResult,
	GrammarResult,
	GrammarRouterResult,
} from '../types';
import { analyzeGrammar } from './grammar-analysis';
import { improveGrammar } from './grammar-improvement';
import { classifyGrammar } from './grammar-router';
import type { StructuredOutputCallOptions } from './structured-output';

/** 语法分流后的处理分支 */
export type GrammarRoute = 'analysis' | 'improvement';

/** 语法分析图节点依赖，便于测试注入桩实现 */
export interface GrammarGraphDeps {
	/** 路由判定：判断句子是否存在语法问题 */
	classify: (sentence: string) => Promise<GrammarRouterResult>;
	/** 语法分析：解析无问题句子的句子成分 */
	analyze: (sentence: string) => Promise<GrammarResult>;
	/** 语法改进：给出问题句子的改进建议 */
	improve: (sentence: string) => Promise<GrammarImprovementResult>;
}

/**
 * 语法分析图状态定义。
 * LangGraph 1.0 的 StateSchema 要求字段满足标准 schema JSON 描述，
 * 当前项目使用 Zod v3，因此改用官方推荐的 Annotation.Root 定义状态。
 */
const GrammarState = Annotation.Root({
	sentence: Annotation<string>,
	route: Annotation<GrammarRoute | undefined>,
	routerSummary: Annotation<string | undefined>,
	analysis: Annotation<GrammarResult | undefined>,
	improvement: Annotation<GrammarImprovementResult | undefined>,
});

/** 语法分析图状态类型 */
type GrammarGraphState = typeof GrammarState.State;
/** 语法分析图节点可返回的更新类型 */
type GrammarGraphUpdate = typeof GrammarState.Update;

/**
 * 创建语法分流图。
 * 节点通过依赖注入接入真实 AI 调用或测试桩，状态中不携带 settings。
 * 节点内的失败一律直接上抛，不做任何降级兜底——
 * 兜底降级会把语法正确的句子错误地送进改进分支，属于根本性错误。
 * @param deps 路由/分析/改进节点实现
 * @returns 已编译的 LangGraph 图
 */
export function createGrammarGraph(deps: GrammarGraphDeps) {
	const routerNode = async (
		state: GrammarGraphState,
	): Promise<GrammarGraphUpdate> => {
		const result = await deps.classify(state.sentence);
		return {
			route: result.hasGrammarIssues ? 'improvement' : 'analysis',
			routerSummary: result.summary,
		};
	};

	const analyzeNode = async (
		state: GrammarGraphState,
	): Promise<GrammarGraphUpdate> => ({
		analysis: await deps.analyze(state.sentence),
	});

	const improveNode = async (
		state: GrammarGraphState,
	): Promise<GrammarGraphUpdate> => ({
		improvement: await deps.improve(state.sentence),
	});

	return new StateGraph(GrammarState)
		.addNode('router', routerNode)
		.addNode('analyze', analyzeNode)
		.addNode('improve', improveNode)
		.addConditionalEdges(
			'router',
			(state: GrammarGraphState): GrammarRoute =>
				state.route === 'improvement' ? 'improvement' : 'analysis',
			{ analysis: 'analyze', improvement: 'improve' },
		)
		.addEdge(START, 'router')
		.addEdge('analyze', END)
		.addEdge('improve', END)
		.compile();
}

/** 语法分流后的最终结果 */
export interface GrammarGraphResult {
	route: GrammarRoute;
	routerSummary?: string;
	analysis?: GrammarResult;
	improvement?: GrammarImprovementResult;
}

/**
 * 对输入句子进行语法分流分析。
 * 无语法问题返回成分解析，有问题返回改进建议。
 * @param sentence 用户输入的英语句子
 * @param settings 插件设置
 * @param options 流式/调试选项
 * @returns 分流结果
 */
export async function analyzeGrammarRouted(
	sentence: string,
	settings: EnPracticeSettings,
	options?: StructuredOutputCallOptions,
): Promise<GrammarGraphResult> {
	const deps: GrammarGraphDeps = {
		classify: (input) => classifyGrammar(input, settings, options),
		analyze: (input) => analyzeGrammar(input, settings, options),
		improve: (input) => improveGrammar(input, settings, options),
	};
	const result = await createGrammarGraph(deps).invoke({ sentence });
	return {
		route: result.route ?? 'analysis',
		routerSummary: result.routerSummary,
		analysis: result.analysis,
		improvement: result.improvement,
	};
}
