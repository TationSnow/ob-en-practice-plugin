import type { ChatPromptTemplate } from '@langchain/core/prompts';
import { type BaseMessage } from '@langchain/core/messages';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import type { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { EnPracticeSettings } from '../settings';
import { AiError } from '../types';
import { repairJsonText } from '../utils/json-repair';
import { createModel } from './index';
import {
	addDebugEntry,
	createRequestId,
	formatDebugDetail,
} from './debug-log';

/** 解析失败详情最大长度，避免把整段原始输出塞进错误消息 */
const PARSE_ERROR_DETAIL_LIMIT = 200;

/**
 * AI 功能函数可接收的流式/调试选项。
 * 流式回调仅在插件开启“启用流式输出”时生效，由 runStructuredTask 统一接线。
 */
export interface StructuredOutputCallOptions {
	/** 流式输出回调，收到文本分片时触发 */
	onToken?: (token: string) => void;
	/** 是否写入调试日志 */
	debug?: boolean;
}

/** 结构化输出调用参数 */
export interface InvokeStructuredOptions<T extends z.ZodType> {
	model: ChatOpenAI;
	prompt: ChatPromptTemplate;
	schema: T;
	/** 任务标识，同时用作调试日志 feature 名称 */
	outputName: string;
	variables: Record<string, unknown>;
	/** 流式输出回调，收到文本分片时触发 */
	onToken?: (token: string) => void;
	/** 是否写入调试日志 */
	debug?: boolean;
	/** Zod 校验通过后的附加业务校验；返回问题列表，非空视为本次输出无效 */
	additionalValidation?: (parsed: z.infer<T>) => string[];
}

/** 单个 AI 功能任务的配置，供 runStructuredTask 使用 */
export interface StructuredTaskConfig<T extends z.ZodType> {
	/** 任务标识，同时用作调试日志 feature 名称 */
	outputName: string;
	/** 编译好的提示词模板 */
	prompt: ChatPromptTemplate;
	/** 输出 schema */
	schema: T;
	/** 模板变量 */
	variables: Record<string, unknown>;
	/** Zod 校验通过后的附加业务校验 */
	additionalValidation?: (parsed: z.infer<T>) => string[];
	/**
	 * 本任务的输出 token 上限，与用户设置取小。
	 * 用于输出体积可预期的任务（路由判定、改进建议），防止模型失控生成长文本。
	 */
	maxTokens?: number;
}

/**
 * 提取校验错误的可读摘要，用于错误消息与调试日志。
 * @param err 校验错误
 * @returns 截断后的错误文本
 */
function parseErrorDetail(err: unknown): string {
	const text = errorMessage(err);
	return text.length > PARSE_ERROR_DETAIL_LIMIT
		? `${text.slice(0, PARSE_ERROR_DETAIL_LIMIT)}...`
		: text;
}

/**
 * 获取错误的可读文本。
 * @param err 未知错误
 * @returns 错误信息
 */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * 提取模型输出中的纯文本内容。
 * @param content 模型返回的 MessageContent
 * @returns 拼接后的文本
 */
function extractTextContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === 'string') {
					return block;
				}
				if (
					typeof block === 'object' &&
					block !== null &&
					'text' in block
				) {
					const text = (block as { text?: unknown }).text;
					return typeof text === 'string' ? text : '';
				}
				return '';
			})
			.join('');
	}
	return '';
}

/** 流式分块结构：LangChain 消息分块带 additional_kwargs */
interface StreamChunk {
	content: unknown;
	additional_kwargs?: Record<string, unknown>;
}

/** 从原始响应中提取思考内容（DeepSeek reasoning_content） */
function extractReasoningContent(chunk: StreamChunk): string {
	const raw = chunk.additional_kwargs?.__raw_response as
		| {
				choices?: Array<{
					delta?: { reasoning_content?: unknown };
					message?: { reasoning_content?: unknown };
				}>;
		  }
		| undefined;
	const choice = raw?.choices?.[0];
	return extractTextContent(
		choice?.message?.reasoning_content ?? choice?.delta?.reasoning_content,
	);
}

/**
 * 逐块收集流式文本并触发 onToken 回调。
 * 思考模型的最终答案优先取 content；content 为空时回退到 reasoning_content。
 * @param stream 模型返回的流
 * @param onToken 文本分片回调
 * @returns 拼接后的完整文本
 */
async function collectStreamText(
	stream: AsyncIterable<StreamChunk>,
	onToken?: (token: string) => void,
): Promise<string> {
	let rawText = '';
	let reasoningText = '';
	for await (const chunk of stream) {
		const text = extractTextContent(chunk.content);
		if (text) {
			rawText += text;
			onToken?.(text);
		} else {
			reasoningText += extractReasoningContent(chunk);
		}
	}
	// 只有最终答案为空时才使用思考内容，避免解析到中间推理过程
	return rawText || reasoningText;
}

/**
 * 以 JSON Mode 请求模型并收集输出文本。
 * 统一使用 response_format: json_object（OpenAI 兼容接口兼容面最广，且支持流式）；
 * 传入 onToken 时走流式逐块回调，否则单次调用。
 * @param model ChatOpenAI 实例
 * @param messages 请求消息
 * @param onToken 流式文本回调；缺省时使用非流式调用
 * @returns 模型输出的完整文本
 */
async function collectModelText(
	model: ChatOpenAI,
	messages: BaseMessage[],
	onToken?: (token: string) => void,
): Promise<string> {
	// 请求 JSON Mode：接口按 JSON 约束输出，减少 Markdown 代码块等杂讯
	const jsonModel = model.withConfig({
		response_format: { type: 'json_object' },
	});
	if (onToken) {
		const stream = await jsonModel.stream(messages);
		return collectStreamText(stream, onToken);
	}
	const message = await jsonModel.invoke(messages);
	const text = extractTextContent(message.content);
	// 思考模型（如 deepseek-reasoner）在非流式下答案可能落在 reasoning_content；
	// BaseMessage 结构上兼容 StreamChunk（content + additional_kwargs），可直接复用
	if (!text) {
		return extractReasoningContent(message);
	}
	return text;
}

/** 解析结果：parsed 为解析输出，repaired 标记是否经过本地 JSON 修复 */
interface ParseOutcome<T> {
	parsed: T;
	repaired: boolean;
}

/**
 * 解析模型输出的 JSON 文本。
 * 标准解析失败时，尝试本地修复常见 JSON 语法缺陷
 * （如中文字符串值内未转义的英文双引号）后重新解析；
 * 修复是纯文本操作，不产生额外模型请求。修复后仍失败则抛出原始错误。
 * @param parser LangChain 结构化输出解析器
 * @param rawText 模型原始输出
 * @returns 解析结果与是否经过修复
 */
async function parseWithRepair<T>(
	parser: { parse(text: string): Promise<T> },
	rawText: string,
): Promise<ParseOutcome<T>> {
	try {
		return { parsed: await parser.parse(rawText), repaired: false };
	} catch (firstError) {
		const repaired = repairJsonText(rawText);
		if (repaired === null) {
			throw firstError;
		}
		try {
			return { parsed: await parser.parse(repaired), repaired: true };
		} catch {
			// 修复后仍失败：抛出原始错误，它才是真正的语法根因
			throw firstError;
		}
	}
}

/**
 * 统一执行结构化输出调用：一次请求，解析与校验失败即快速抛错。
 * 不做重试、不做方法降级、不做普通文本兜底——失败原因直接交给上层提示用户，
 * 既避免多次请求拖慢响应，也防止兜底机制污染业务路由。
 * @param options 调用参数
 * @returns 校验通过的解析结果
 */
export async function invokeStructured<T extends z.ZodType>(
	options: InvokeStructuredOptions<T>,
): Promise<z.infer<T>> {
	const {
		model,
		prompt,
		schema,
		outputName,
		variables,
		onToken,
		debug,
		additionalValidation,
	} = options;
	const parser = StructuredOutputParser.fromZodSchema(schema);
	const requestId = createRequestId(outputName);

	if (debug) {
		addDebugEntry({
			requestId,
			feature: outputName,
			phase: 'request',
			message: '开始请求',
			detail: formatDebugDetail({ variables }),
		});
	}

	// 收集模型输出；网络/接口错误直接映射为 API_ERROR，交由界面提示
	let rawText: string;
	try {
		const promptValue = await prompt.invoke(variables);
		rawText = await collectModelText(model, promptValue.messages, onToken);
	} catch (err) {
		if (debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'error',
				message: '请求失败',
				detail: errorMessage(err),
			});
		}
		throw new AiError('API_ERROR', `模型调用失败：${errorMessage(err)}`);
	}

	if (debug) {
		addDebugEntry({
			requestId,
			feature: outputName,
			phase: 'stream',
			message: '输出接收完成',
			detail: `已接收 ${rawText.length} 字符`,
		});
	}

	// Zod schema 校验；标准解析失败时先尝试本地 JSON 修复（零额外请求），仍失败才快速抛错
	let parsed: z.infer<T>;
	try {
		const outcome = await parseWithRepair(parser, rawText);
		parsed = outcome.parsed;
		if (outcome.repaired && debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'repair',
				message: 'JSON 语法修复后解析成功',
				detail:
					'模型输出的 JSON 存在字符串值内未转义引号等缺陷，已在本地修复（未产生额外模型请求）',
			});
		}
	} catch (err) {
		// 调试日志记录完整错误与原始输出，不做截断——
		// 调试面板展示与“复制日志”都依赖它排查解析失败的具体原因
		if (debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'error',
				message: '输出未通过 schema 校验',
				detail: `${errorMessage(err)}\n原始输出：${rawText}`,
			});
		}
		// 面向用户的错误消息保留截断摘要，避免通知过长；完整内容见调试日志
		throw new AiError(
			'PARSE_ERROR',
			`模型输出无法解析（${parseErrorDetail(err)}），原始输出：${rawText}`,
		);
	}

	// 附加业务校验（如成分必须是原句连续片段），失败即抛出
	if (additionalValidation) {
		const issues = additionalValidation(parsed);
		if (issues.length > 0) {
			if (debug) {
				addDebugEntry({
					requestId,
					feature: outputName,
					phase: 'error',
					message: '输出未通过附加校验',
					detail: issues.join('；'),
				});
			}
			throw new AiError(
				'PARSE_ERROR',
				`模型输出未通过业务校验：${issues.join('；')}，原始输出：${rawText}`,
			);
		}
	}

	if (debug) {
		addDebugEntry({
			requestId,
			feature: outputName,
			phase: 'success',
			message: '请求成功',
			detail: formatDebugDetail(parsed),
		});
	}
	return parsed;
}

/**
 * 执行一个标准 AI 结构化任务：创建模型、按设置接线流式/调试选项并解析输出。
 * 各 AI 功能节点共用此入口，收敛“创建模型 + 选项透传”的重复样板。
 * @param settings 插件设置
 * @param options 调用方的流式/调试选项
 * @param config 任务配置
 * @returns 校验通过的任务结果
 */
export async function runStructuredTask<T extends z.ZodType>(
	settings: EnPracticeSettings,
	options: StructuredOutputCallOptions | undefined,
	config: StructuredTaskConfig<T>,
): Promise<z.infer<T>> {
	const model = createModel(settings, config.maxTokens);
	return invokeStructured({
		model,
		prompt: config.prompt,
		schema: config.schema,
		outputName: config.outputName,
		variables: config.variables,
		// 流式开关由插件设置统一控制，未开启时不接通回调
		onToken: settings.streamingEnabled ? options?.onToken : undefined,
		debug: options?.debug,
		additionalValidation: config.additionalValidation,
	});
}
