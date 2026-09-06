import { describe, expect, it } from 'vitest';
import {
	addModelProfile,
	applyAddModelProfile,
	applyLegacyModelMigration,
	applyRemoveModelProfile,
	applySetActiveModelProfile,
	applyUpdateModelProfile,
	createModelProfileId,
	findModelProfile,
	getActiveModelProfile,
	normalizeModelProfileDraft,
	removeModelProfile,
	resolveActiveModelSettings,
	updateModelProfile,
	validateModelProfileDraft,
	type GlobalModelDefaults,
	type ModelProfile,
	type ModelProfileDraft,
} from '../src/settings/models';
import { isConfigValid } from '../src/types';

/** 构造一个合法的档位草稿（本地 LM Studio 场景，无需 API Key） */
function createDraft(
	overrides: Partial<ModelProfileDraft> = {},
): ModelProfileDraft {
	return normalizeModelProfileDraft({
		name: '本地 LM Studio',
		baseUrl: 'http://127.0.0.1:1234/v1',
		apiKey: '',
		modelName: 'qwen3.8-9b',
		...overrides,
	});
}

/** 构造一个已有档位 */
function createProfile(
	overrides: Partial<ModelProfile> = {},
): ModelProfile {
	return {
		id: 'profile-1',
		name: '本地 LM Studio',
		protocol: 'openai-compatible',
		baseUrl: 'http://127.0.0.1:1234/v1',
		apiKey: '',
		modelName: 'qwen3.8-9b',
		structuredOutput: 'auto',
		...overrides,
	};
}

/** 构造模型档位宿主（EnPracticeSettings 的结构子集） */
function createHost(
	profiles: ModelProfile[] = [],
	activeModelId = '',
): GlobalModelDefaults {
	return {
		models: profiles,
		activeModelId,
		apiKey: '',
		baseUrl: '',
		modelName: '',
		maxTokens: 4096,
		proxyEnabled: false,
		proxyUrl: 'http://127.0.0.1:7897',
		streamingEnabled: true,
		debugMode: false,
	};
}

describe('createModelProfileId', () => {
	it('多次生成的 id 互不相同', () => {
		const ids = new Set(
			Array.from({ length: 20 }, () => createModelProfileId()),
		);
		expect(ids.size).toBe(20);
	});
});

describe('normalizeModelProfileDraft', () => {
	it('去除首尾空白并补全协议与结构化输出默认值', () => {
		const normalized = normalizeModelProfileDraft(
			createDraft({
				name: ' 本地 LM Studio ',
				baseUrl: ' http://127.0.0.1:1234/v1 ',
				modelName: ' qwen3.8-9b ',
			}),
		);
		expect(normalized.name).toBe('本地 LM Studio');
		expect(normalized.baseUrl).toBe('http://127.0.0.1:1234/v1');
		expect(normalized.modelName).toBe('qwen3.8-9b');
		expect(normalized.protocol).toBe('openai-compatible');
		expect(normalized.structuredOutput).toBe('auto');
	});

	it('保留显式指定的覆盖字段', () => {
		const normalized = normalizeModelProfileDraft(
			createDraft({
				structuredOutput: 'json_schema',
				proxyEnabled: true,
				proxyUrl: 'http://127.0.0.1:7897',
				maxTokens: 8192,
			}),
		);
		expect(normalized.structuredOutput).toBe('json_schema');
		expect(normalized.proxyEnabled).toBe(true);
		expect(normalized.proxyUrl).toBe('http://127.0.0.1:7897');
		expect(normalized.maxTokens).toBe(8192);
	});
});

describe('validateModelProfileDraft', () => {
	it('必填字段缺失时逐项报告问题', () => {
		const issues = validateModelProfileDraft(
			createDraft({ name: '', baseUrl: '', modelName: '' }),
			[],
		);
		expect(issues).toContain('名称不能为空');
		expect(issues).toContain('API 地址不能为空');
		expect(issues).toContain('模型名称不能为空');
	});

	it('API 地址必须以 http(s):// 开头', () => {
		const issues = validateModelProfileDraft(
			createDraft({ baseUrl: '127.0.0.1:1234/v1' }),
			[],
		);
		expect(issues).toContain('API 地址需以 http:// 或 https:// 开头');
	});

	it('名称与其他档位重复时拒绝（大小写不敏感）', () => {
		const others = [createProfile({ name: 'Local Studio' })];
		expect(
			validateModelProfileDraft(createDraft({ name: 'local studio' }), others),
		).toContain('名称与其他接入口重复');
	});

	it('编辑时排除自身 id 后不视为重名', () => {
		const others = [createProfile()];
		expect(
			validateModelProfileDraft(
				createDraft({ name: '本地 LM Studio' }),
				others,
				'profile-1',
			),
		).toEqual([]);
	});

	it('maxTokens 覆盖越界时拒绝，未填写时放行', () => {
		expect(
			validateModelProfileDraft(createDraft({ maxTokens: 128 }), []),
		).toContain('最长 token 需为 256-51200 之间的整数');
		expect(
			validateModelProfileDraft(createDraft({ maxTokens: 51200 }), []),
		).toEqual([]);
		expect(validateModelProfileDraft(createDraft(), [])).toEqual([]);
	});
});

describe('数组级增删改', () => {
	it('新增档位：追加到末尾并生成新 id', () => {
		const existing = [createProfile()];
		const next = addModelProfile(existing, createDraft({ name: '云端' }));
		expect(next).toHaveLength(2);
		expect(next[1]?.name).toBe('云端');
		expect(next[1]?.id).not.toBe('profile-1');
		// 原数组不被修改（纯函数）
		expect(existing).toHaveLength(1);
	});

	it('更新档位：按 id 替换字段并保留原 id', () => {
		const next = updateModelProfile(
			[createProfile()],
			'profile-1',
			createDraft({ name: '改名', modelName: 'gpt-4o-mini' }),
		);
		expect(next[0]?.name).toBe('改名');
		expect(next[0]?.modelName).toBe('gpt-4o-mini');
		expect(next[0]?.id).toBe('profile-1');
	});

	it('更新不存在的 id 时原样返回', () => {
		const profiles = [createProfile()];
		expect(
			updateModelProfile(profiles, 'missing', createDraft()),
		).toEqual(profiles);
	});

	it('删除档位：按 id 过滤', () => {
		const profiles = [
			createProfile(),
			createProfile({ id: 'profile-2', name: '云端' }),
		];
		const next = removeModelProfile(profiles, 'profile-1');
		expect(next).toHaveLength(1);
		expect(next[0]?.id).toBe('profile-2');
	});
});

describe('宿主级操作（含激活档位维护）', () => {
	it('新增首个档位后自动激活，后续新增不改变激活', () => {
		const host = createHost();
		expect(applyAddModelProfile(host, createDraft())).toEqual([]);

		const firstId = host.activeModelId;
		expect(firstId).not.toBe('');
		expect(host.models).toHaveLength(1);

		expect(
			applyAddModelProfile(host, createDraft({ name: '云端' })),
		).toEqual([]);
		expect(host.models).toHaveLength(2);
		expect(host.activeModelId).toBe(firstId);
	});

	it('校验失败时返回问题且不修改宿主', () => {
		const host = createHost();
		const issues = applyAddModelProfile(host, createDraft({ name: '' }));
		expect(issues.length).toBeGreaterThan(0);
		expect(host.models).toHaveLength(0);
	});

	it('更新档位时排除自身 id 查重', () => {
		const host = createHost([createProfile()], 'profile-1');
		expect(
			applyUpdateModelProfile(
				host,
				'profile-1',
				createDraft({ modelName: 'qwen3.8-14b' }),
			),
		).toEqual([]);
		expect(host.models[0]?.modelName).toBe('qwen3.8-14b');
	});

	it('更新不存在的 id 时报错', () => {
		const host = createHost([createProfile()], 'profile-1');
		expect(
			applyUpdateModelProfile(host, 'missing', createDraft()),
		).toContain('模型接入口不存在');
	});

	it('删除激活档位后自动切换到剩余首个档位', () => {
		const host = createHost(
			[createProfile(), createProfile({ id: 'profile-2', name: '云端' })],
			'profile-1',
		);
		expect(applyRemoveModelProfile(host, 'profile-1')).toEqual([]);
		expect(host.models.map((profile) => profile.id)).toEqual(['profile-2']);
		expect(host.activeModelId).toBe('profile-2');
	});

	it('删除非激活档位不影响激活标识', () => {
		const host = createHost(
			[createProfile(), createProfile({ id: 'profile-2', name: '云端' })],
			'profile-1',
		);
		expect(applyRemoveModelProfile(host, 'profile-2')).toEqual([]);
		expect(host.activeModelId).toBe('profile-1');
	});

	it('不允许删除最后一个档位，保护已录入的密钥等信息', () => {
		const host = createHost([createProfile()], 'profile-1');
		expect(applyRemoveModelProfile(host, 'profile-1')).toContain(
			'至少保留一个模型接入口',
		);
		expect(host.models).toHaveLength(1);
	});

	it('切换激活档位：存在则生效，不存在则报错', () => {
		const host = createHost(
			[createProfile(), createProfile({ id: 'profile-2', name: '云端' })],
			'profile-1',
		);
		expect(applySetActiveModelProfile(host, 'profile-2')).toEqual([]);
		expect(host.activeModelId).toBe('profile-2');
		expect(applySetActiveModelProfile(host, 'missing')).toContain(
			'模型接入口不存在',
		);
	});
});

describe('getActiveModelProfile', () => {
	it('激活标识命中对应档位', () => {
		const host = createHost(
			[createProfile(), createProfile({ id: 'profile-2', name: '云端' })],
			'profile-2',
		);
		expect(getActiveModelProfile(host)?.id).toBe('profile-2');
	});

	it('激活标识失效时回退到首个档位', () => {
		const host = createHost([createProfile()], 'gone');
		expect(getActiveModelProfile(host)?.id).toBe('profile-1');
	});

	it('无档位时返回 undefined', () => {
		expect(getActiveModelProfile(createHost())).toBeUndefined();
	});
});

describe('resolveActiveModelSettings', () => {
	it('激活档位字段优先，未设置的覆盖字段回退全局默认', () => {
		const host = createHost(
			[
				createProfile({
					maxTokens: 8192,
					proxyEnabled: true,
					proxyUrl: 'http://127.0.0.1:7890',
				}),
			],
			'profile-1',
		);
		const resolved = resolveActiveModelSettings(host);
		expect(resolved.baseUrl).toBe('http://127.0.0.1:1234/v1');
		expect(resolved.modelName).toBe('qwen3.8-9b');
		expect(resolved.structuredOutput).toBe('auto');
		expect(resolved.maxTokens).toBe(8192);
		expect(resolved.proxyEnabled).toBe(true);
		expect(resolved.proxyUrl).toBe('http://127.0.0.1:7890');
		expect(resolved.streamingEnabled).toBe(true);
		expect(resolved.protocol).toBe('openai-compatible');
	});

	it('档位覆盖字段缺省时使用全局设置', () => {
		const host = createHost([createProfile()], 'profile-1');
		const resolved = resolveActiveModelSettings(host);
		expect(resolved.maxTokens).toBe(4096);
		expect(resolved.proxyEnabled).toBe(false);
		expect(resolved.proxyUrl).toBe('http://127.0.0.1:7897');
	});

	it('无档位时回退旧版扁平字段（向后兼容迁移前数据）', () => {
		const host: GlobalModelDefaults = {
			...createHost(),
			baseUrl: 'https://api.deepseek.com/v1',
			modelName: 'deepseek-chat',
		};
		// 经局部视图写入旧版扁平字段（已标注 @deprecated，避免直接引用属性符号）
		const legacy = host as {
			apiKey?: string;
			baseUrl?: string;
			modelName?: string;
		};
		legacy.apiKey = 'legacy-key';
		const resolved = resolveActiveModelSettings(host);
		expect(resolved.baseUrl).toBe('https://api.deepseek.com/v1');
		expect(resolved.modelName).toBe('deepseek-chat');
		expect(resolved.apiKey).toBe('legacy-key');
		expect(resolved.structuredOutput).toBe('auto');
	});

	it('无档位且无旧字段时返回未配置形状', () => {
		const resolved = resolveActiveModelSettings(createHost());
		expect(resolved.baseUrl).toBe('');
		expect(resolved.modelName).toBe('');
	});
});

describe('applyLegacyModelMigration', () => {
	it('旧版扁平字段迁移为首个档位并激活', () => {
		const host = createHost();
		// 经局部视图写入旧版扁平字段（已标注 @deprecated，避免直接引用属性符号）
		const legacy = host as {
			apiKey?: string;
			baseUrl?: string;
			modelName?: string;
		};
		legacy.apiKey = 'legacy-key';
		legacy.baseUrl = 'http://127.0.0.1:1234/v1';
		legacy.modelName = 'qwen3.8-9b';

		expect(applyLegacyModelMigration(host)).toBe(true);
		expect(host.models).toHaveLength(1);
		const migrated = host.models[0];
		expect(migrated?.baseUrl).toBe('http://127.0.0.1:1234/v1');
		expect(migrated?.modelName).toBe('qwen3.8-9b');
		expect(migrated?.apiKey).toBe('legacy-key');
		expect(migrated?.structuredOutput).toBe('auto');
		expect(host.activeModelId).toBe(migrated?.id);
	});

	it('迁移具有幂等性：二次调用不再产生变更', () => {
		const host = createHost();
		const legacy = host as { baseUrl?: string; modelName?: string };
		legacy.baseUrl = 'http://127.0.0.1:1234/v1';
		legacy.modelName = 'qwen3.8-9b';
		applyLegacyModelMigration(host);
		const snapshot = JSON.stringify(host.models);
		expect(applyLegacyModelMigration(host)).toBe(false);
		expect(JSON.stringify(host.models)).toBe(snapshot);
	});

	it('剥离历史版本遗留的无效设置键', () => {
		const host = createHost([createProfile()], 'profile-1');
		const record = host as unknown as Record<string, unknown>;
		record.retryCount = 0;
		record.thinkingEnabled = false;

		expect(applyLegacyModelMigration(host)).toBe(true);
		expect(record.retryCount).toBeUndefined();
		expect(record.thinkingEnabled).toBeUndefined();
	});

	it('激活标识失效时修正为首个档位', () => {
		const host = createHost([createProfile()], 'gone');
		expect(applyLegacyModelMigration(host)).toBe(true);
		expect(host.activeModelId).toBe('profile-1');
	});
});

describe('isConfigValid', () => {
	it('存在配置完整的激活档位时视为已配置', () => {
		const host = createHost([createProfile()], 'profile-1');
		expect(isConfigValid(host)).toBe(true);
	});

	it('档位缺失必填字段时视为未配置', () => {
		const host = createHost(
			[createProfile({ baseUrl: '', modelName: '' })],
			'profile-1',
		);
		expect(isConfigValid(host)).toBe(false);
	});

	it('无任何配置时视为未配置', () => {
		expect(isConfigValid(createHost())).toBe(false);
	});
});

describe('findModelProfile', () => {
	it('按 id 查找档位', () => {
		const profiles = [createProfile(), createProfile({ id: 'profile-2' })];
		expect(findModelProfile(profiles, 'profile-2')?.id).toBe('profile-2');
		expect(findModelProfile(profiles, 'missing')).toBeUndefined();
	});
});
