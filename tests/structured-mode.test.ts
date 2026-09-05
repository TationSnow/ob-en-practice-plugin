import { describe, expect, it } from 'vitest';
import {
	clearCachedStructuredMode,
	clearStructuredCapabilityCache,
	getCachedStructuredMode,
	isResponseFormatUnsupportedError,
	modelCapabilityCacheKey,
	responseFormatPayload,
	resolveModeLadder,
	setCachedStructuredMode,
	zodToJsonSchemaForRequest,
} from '../src/ai/structured-mode';
import {
	grammarImprovementSchema,
	grammarRouterSchema,
	grammarSchema,
	translationEvaluationSchema,
	translationQuestionSchema,
} from '../src/ai/schemas';

describe('resolveModeLadder', () => {
	it('auto 模式按兼容面从广到窄解析为完整降级阶梯', () => {
		expect(resolveModeLadder('auto')).toEqual([
			'json_object',
			'json_schema',
			'none',
		]);
	});

	it('手动模式只尝试用户指定的单一模式（行为完全确定）', () => {
		expect(resolveModeLadder('json_object')).toEqual(['json_object']);
		expect(resolveModeLadder('json_schema')).toEqual(['json_schema']);
		expect(resolveModeLadder('none')).toEqual(['none']);
	});
});

describe('responseFormatPayload', () => {
	it('json_object 模式返回最小载荷', () => {
		expect(responseFormatPayload('json_object', grammarRouterSchema, 'x')).toEqual(
			{ type: 'json_object' },
		);
	});

	it('json_schema 模式返回带名称与 schema 的载荷', () => {
		const payload = responseFormatPayload(
			'json_schema',
			grammarRouterSchema,
			'grammarRouter',
		);
		expect(payload?.type).toBe('json_schema');
		if (payload?.type === 'json_schema') {
			expect(payload.json_schema.name).toBe('grammarRouter');
			expect(payload.json_schema.schema).toBeTypeOf('object');
		}
	});

	it('none 模式返回 undefined（完全不发送 response_format）', () => {
		expect(responseFormatPayload('none', grammarRouterSchema, 'x')).toBeUndefined();
	});
});

describe('zodToJsonSchemaForRequest', () => {
	it('全部任务 schema 均可转换为对象形式的 JSON Schema', () => {
		for (const schema of [
			grammarRouterSchema,
			grammarSchema,
			grammarImprovementSchema,
			translationQuestionSchema,
			translationEvaluationSchema,
		]) {
			const converted = zodToJsonSchemaForRequest(schema);
			expect(converted).toBeTypeOf('object');
			expect(JSON.stringify(converted)).toBeTypeOf('string');
		}
	});

	it('扁平 schema 保留属性定义', () => {
		const converted = zodToJsonSchemaForRequest(grammarRouterSchema);
		const text = JSON.stringify(converted);
		expect(text).toContain('hasGrammarIssues');
	});

	it('递归 schema（z.lazy 成分嵌套）以 $ref/$defs 表达而非死循环', () => {
		// sentenceComponentSchema 通过 z.lazy 递归引用自身；
		// 转换必须终止并产生可被 llama.cpp 等后端解析的 $ref 结构
		const converted = zodToJsonSchemaForRequest(grammarSchema);
		const text = JSON.stringify(converted);
		expect(text).toContain('$ref');
		// 二次转换结果一致（内部缓存稳定）
		expect(JSON.stringify(zodToJsonSchemaForRequest(grammarSchema))).toBe(text);
	});
});

describe('isResponseFormatUnsupportedError', () => {
	it('LM Studio 特征错误（消息以 400 开头且含 response_format）命中', () => {
		// 消息取自真实报错日志
		expect(
			isResponseFormatUnsupportedError(
				new Error(`400 "'response_format.type' must be 'json_schema' or 'text'"`),
			),
		).toBe(true);
	});

	it('openai SDK 形状错误（status 属性 = 400 且含关键词）命中', () => {
		const err = Object.assign(new Error('response_format is not supported'), {
			status: 400,
		});
		expect(isResponseFormatUnsupportedError(err)).toBe(true);
	});

	it('非 400 状态码不命中', () => {
		const err = Object.assign(new Error('invalid response_format'), {
			status: 401,
		});
		expect(isResponseFormatUnsupportedError(err)).toBe(false);
	});

	it('400 但与 response_format 无关的错误不命中（如上下文超长）', () => {
		expect(
			isResponseFormatUnsupportedError(new Error("400 'context length exceeded'")),
		).toBe(false);
	});

	it('普通网络/解析错误不命中', () => {
		expect(isResponseFormatUnsupportedError(new Error('network error'))).toBe(
			false,
		);
		expect(isResponseFormatUnsupportedError(new Error('parse failed'))).toBe(
			false,
		);
	});

	it('字符串形式的错误同样按签名判定', () => {
		expect(
			isResponseFormatUnsupportedError(
				`400 "'response_format.type' must be 'json_schema' or 'text'"`,
			),
		).toBe(true);
	});
});

describe('结构化输出能力缓存', () => {
	it('缓存键为 协议|地址|模型名，地址与模型名 trim 后参与', () => {
		expect(
			modelCapabilityCacheKey(
				'openai-compatible',
				' http://127.0.0.1:1234/v1 ',
				' qwen3.8-9b ',
			),
		).toBe('openai-compatible|http://127.0.0.1:1234/v1|qwen3.8-9b');
	});

	it('写入后可读取，按键清除与全量清空均生效', () => {
		clearStructuredCapabilityCache();
		const key = modelCapabilityCacheKey(
			'openai-compatible',
			'http://127.0.0.1:1234/v1',
			'qwen3.8-9b',
		);
		expect(getCachedStructuredMode(key)).toBeUndefined();

		setCachedStructuredMode(key, 'json_schema');
		expect(getCachedStructuredMode(key)).toBe('json_schema');

		clearCachedStructuredMode(key);
		expect(getCachedStructuredMode(key)).toBeUndefined();

		setCachedStructuredMode(key, 'json_object');
		clearStructuredCapabilityCache();
		expect(getCachedStructuredMode(key)).toBeUndefined();
	});
});
