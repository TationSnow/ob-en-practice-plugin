import type { ChatPromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import type {
	ChatOpenAI,
	ChatOpenAIStructuredOutputMethodOptions,
} from '@langchain/openai';
import type { z } from 'zod';
import { AiError } from '../types';
import {
	addDebugEntry,
	createRequestId,
	formatDebugDetail,
} from './debug-log';

/** 支持的结构化输出方法 */
export type StructuredOutputMethod = 'jsonMode' | 'functionCalling' | 'jsonSchema';

/** 已知支持 OpenAI structured outputs 的模型名模式 */
const OPENAI_STRUCTURED_MODEL_PATTERN = /gpt-4o|gpt-4\.1|gpt-5|o[1-9]/i;

/** 解析失败后追加给模型的纠错提示 */
const RETRY_HINT =
	'上次输出未通过 JSON 格式或字段校验。请重新输出，只返回一个合法 JSON 对象：不要 Markdown 代码块、不要解释、不要补充文字，必须包含全部字段。';

/** 结构化输出调用参数 */
export interface InvokeStructuredOptions<T extends z.ZodType> {
	model: ChatOpenAI;
	prompt: ChatPromptTemplate;
	schema: T;
	outputName: string;
	variables: Record<string, unknown>;
	maxRetries: number;
	/** 流式输出回调，收到文本分片时触发 */
	onToken?: (token: string) => void;
	/** 是否写入调试日志 */
	debug?: boolean;
	/** 是否启用思考模式；开启时跳过不兼容的函数调用方法 */
	thinkingEnabled?: boolean;
}

/** AI 功能函数可接收的流式/调试选项 */
export type StructuredOutputCallOptions = Pick<
	InvokeStructuredOptions<never>,
	'onToken' | 'debug'
>;

/** withStructuredOutput 的 includeRaw 返回结构 */
interface ParsedStructuredResult<T> {
	raw: BaseMessage;
	parsed: T | null;
}

/**
 * 根据模型自动选择结构化输出方法链。
 * @param model ChatOpenAI 实例
 * @returns 按优先级排列的方法列表
 */
export function resolveOutputMethods(
	model: ChatOpenAI,
	thinkingEnabled = false,
): StructuredOutputMethod[] {
	const modelName = (model.model ?? '').toLowerCase();

	// 未来模型集成如果填充了 profile，优先使用 JSON Schema
	if (model.profile.structuredOutput === true) {
		return ['jsonSchema', 'jsonMode', 'functionCalling'];
	}

	// DeepSeek 官方确认支持 JSON Output，优先 jsonMode；
	// 思考模式不支持 tool_choice，需要去掉 functionCalling
	if (modelName.includes('deepseek')) {
		return thinkingEnabled
			? ['jsonMode']
			: ['jsonMode', 'functionCalling'];
	}

	// 已知 OpenAI 结构化输出模型优先使用 JSON Schema
	if (OPENAI_STRUCTURED_MODEL_PATTERN.test(modelName)) {
		return ['jsonSchema', 'functionCalling', 'jsonMode'];
	}

	// 老版 GPT-3/GPT-4 系列使用函数调用更稳妥
	if (modelName.startsWith('gpt-3') || modelName.startsWith('gpt-4')) {
		return ['functionCalling', 'jsonMode'];
	}

	// 未知的 OpenAI 兼容接口默认 JSON Mode，兼容面最广
	return ['jsonMode', 'functionCalling'];
}

/**
 * 判断是否可对当前模型开启 strict 模式。
 * @param model ChatOpenAI 实例
 * @returns 是否启用 strict
 */
function shouldUseStrict(model: ChatOpenAI): boolean {
	const modelName = model.model ?? '';
	return (
		model.profile.structuredOutput === true ||
		OPENAI_STRUCTURED_MODEL_PATTERN.test(modelName)
	);
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
 * 获取错误的可读文本。
 * @param err 未知错误
 * @returns 错误信息
 */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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
 * 以 JSON Mode 流式请求，并在结束后执行 Zod 校验。
 * @param model ChatOpenAI 实例
 * @param messages 请求消息
 * @param schema Zod schema
 * @param onToken 流式文本回调
 * @returns 解析结果（失败时为 null）与原始文本
 */
async function invokeJsonModeStream<T extends z.ZodType>(
	model: ChatOpenAI,
	messages: BaseMessage[],
	schema: T,
	onToken?: (token: string) => void,
): Promise<{ parsed: z.infer<T> | null; rawText: string }> {
	const streamModel = model.withConfig({
		response_format: { type: 'json_object' },
	});
	const stream = await streamModel.stream(messages);
	const rawText = await collectStreamText(stream, onToken);
	try {
		const parsed = await StructuredOutputParser.fromZodSchema(schema).parse(
			rawText,
		);
		return { parsed, rawText };
	} catch {
		return { parsed: null, rawText };
	}
}

/**
 * 以普通文本流式请求，并在结束后执行 Zod 校验。
 * @param model ChatOpenAI 实例
 * @param messages 请求消息
 * @param schema Zod schema
 * @param onToken 流式文本回调
 * @returns 解析结果（失败时为 null）与原始文本
 */
async function invokePlainStream<T extends z.ZodType>(
	model: ChatOpenAI,
	messages: BaseMessage[],
	schema: T,
	onToken?: (token: string) => void,
): Promise<{ parsed: z.infer<T> | null; rawText: string }> {
	const stream = await model.stream(messages);
	const rawText = await collectStreamText(stream, onToken);
	try {
		const parsed = await StructuredOutputParser.fromZodSchema(schema).parse(
			rawText,
		);
		return { parsed, rawText };
	} catch {
		return { parsed: null, rawText };
	}
}

/**
 * 统一执行结构化输出调用。
 * 优先使用 LangChain 原生 withStructuredOutput，失败时自动降级并重试。
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
		thinkingEnabled,
	} = options;
	const maxAttempts = Math.max(
		0,
		Math.min(3, Math.floor(options.maxRetries)),
	);
	const parser = StructuredOutputParser.fromZodSchema(schema);
	const methods = resolveOutputMethods(model, thinkingEnabled);
	const requestId = createRequestId(outputName);

	if (debug) {
		addDebugEntry({
			requestId,
			feature: outputName,
			phase: 'request',
			message: '开始请求',
			detail: formatDebugDetail({ methods, variables }),
		});
	}

	// 依次尝试原生方法；API 不支持当前方法时切换到下一方法
	for (const method of methods) {
		for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
			try {
				const promptValue = await prompt.invoke(variables);
				const messages =
					attempt === 0
						? promptValue.messages
						: [
								...promptValue.messages,
								new HumanMessage(RETRY_HINT),
							];
				if (debug) {
					addDebugEntry({
						requestId,
						feature: outputName,
						phase: 'request',
						message: `尝试 ${method}（第 ${attempt + 1}/${maxAttempts + 1} 次）`,
						detail: formatDebugDetail({ variables }),
					});
				}

				// 流式 JSON Mode 优先用于可见的流式输出
				if (method === 'jsonMode' && onToken) {
					const { parsed, rawText } = await invokeJsonModeStream(
						model,
						messages,
						schema,
						onToken,
					);
					if (debug) {
						addDebugEntry({
							requestId,
							feature: outputName,
							phase: 'stream',
							message: '流式输出结束',
							detail: `已接收 ${rawText.length} 字符`,
						});
					}
					if (parsed !== null && parsed !== undefined) {
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
					if (debug) {
						addDebugEntry({
							requestId,
							feature: outputName,
							phase: 'retry',
							message: '输出未通过校验',
							detail:
								attempt < maxAttempts
									? '准备重试'
									: '切换下一方法',
						});
					}
					continue;
				}

				const config: ChatOpenAIStructuredOutputMethodOptions<true> = {
					method,
					includeRaw: true,
					name: outputName,
				};
				if (method !== 'jsonMode' && shouldUseStrict(model)) {
					config.strict = true;
				}
				const runnable = model.withStructuredOutput(
					schema as unknown as Parameters<
						ChatOpenAI['withStructuredOutput']
					>[0],
					config,
				);
				const result = (await runnable.invoke(
					messages,
				)) as unknown as ParsedStructuredResult<z.infer<T>>;
				if (result.parsed !== null && result.parsed !== undefined) {
					if (debug) {
						addDebugEntry({
							requestId,
							feature: outputName,
							phase: 'success',
							message: '请求成功',
							detail: formatDebugDetail(result.parsed),
						});
					}
					return result.parsed;
				}
				// parsed 为 null 表示格式校验失败，继续按重试次数重试
				if (debug) {
					addDebugEntry({
						requestId,
						feature: outputName,
						phase: 'retry',
						message: '输出未通过校验',
						detail:
							attempt < maxAttempts
								? '准备重试'
								: '切换下一方法',
					});
				}
			} catch (err) {
				// API 层错误说明当前方法不被接口支持，直接尝试下一方法
				if (debug) {
					addDebugEntry({
						requestId,
						feature: outputName,
						phase: 'error',
						message: `${method} 调用失败，切换下一方法`,
						detail: errorMessage(err),
					});
				}
				break;
			}
		}
	}

	// 最后兜底：普通文本输出 + Zod 校验，兼容不支持任何结构化参数的接口
	let parsed: z.infer<T> | null = null;
	let rawText = '';
	try {
		const promptValue = await prompt.invoke(variables);
		if (debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'fallback',
				message: '使用普通文本兜底',
			});
		}
		if (onToken) {
			const fallback = await invokePlainStream(
				model,
				promptValue.messages,
				schema,
				onToken,
			);
			parsed = fallback.parsed;
			rawText = fallback.rawText;
		} else {
			const message = await model.invoke(promptValue.messages);
			rawText = extractTextContent(message.content);
			if (!rawText) {
				rawText = extractReasoningContent(message);
			}
			try {
				parsed = await parser.parse(rawText);
			} catch {
				parsed = null;
			}
		}
	} catch (err) {
		if (debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'error',
				message: '兜底请求失败',
				detail: errorMessage(err),
			});
		}
		throw new AiError(
			'API_ERROR',
			`模型调用失败：${errorMessage(err)}`,
		);
	}

	if (parsed !== null && parsed !== undefined) {
		if (debug) {
			addDebugEntry({
				requestId,
				feature: outputName,
				phase: 'success',
				message: '兜底解析成功',
				detail: formatDebugDetail(parsed),
			});
		}
		return parsed;
	}

	const parseError = new AiError(
		'PARSE_ERROR',
		`模型输出无法解析，原始输出：${rawText.slice(0, 500)}`,
	);
	if (debug) {
		addDebugEntry({
			requestId,
			feature: outputName,
			phase: 'error',
			message: '请求失败',
			detail: parseError.message,
		});
	}
	throw parseError;
}
