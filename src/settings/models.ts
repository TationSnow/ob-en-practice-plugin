/**
 * 模型接入口（Profile）数据层。
 *
 * 设计要点：
 * - 档位（ModelProfile）是“一个可用的模型接入口”的完整描述：协议、地址、密钥、模型名，
 *   以及该后端专属的覆盖项（结构化输出模式 / 代理 / 最长 token）；
 * - 数组级函数（add/update/remove）是纯函数，返回新数组，便于测试与回写；
 * - 宿主级函数（apply*）在档位集合之上维护 activeModelId（激活档位）的一致性，
 *   由设置页弹窗与测试共享；
 * - resolveActiveModelSettings 是“激活档位 + 全局默认 → AI 层消费配置”的单一解析点：
 *   AI 层只依赖解析结果，不感知档位结构，为多协议扩展预留接缝。
 */

/** 模型接入口协议（预留多协议扩展，当前仅实现 OpenAI 兼容协议） */
export type ModelProtocol = 'openai-compatible';

/**
 * 结构化输出模式（按档位配置）。
 * - auto：自动降级阶梯（json_object → json_schema → 不发送），见 src/ai/structured-mode.ts
 * - json_object：OpenAI JSON 模式（云端兼容面最广，如 DeepSeek）
 * - json_schema：JSON 架构约束（LM Studio / llama.cpp / vLLM 等本地后端）
 * - none：不发送 response_format，仅靠提示词约束 + 本地解析修复
 */
export type StructuredOutputMode =
	| 'auto'
	| 'json_object'
	| 'json_schema'
	| 'none';

/** 单个模型接入口配置档位 */
export interface ModelProfile {
	/** 稳定标识（randomUUID，与显示名解耦，供下拉/激活标识引用） */
	id: string;
	/** 显示名（唯一，如「本地 LM Studio」「DeepSeek 云端」） */
	name: string;
	/** 接口协议 */
	protocol: ModelProtocol;
	/** API 请求地址（必填），如 https://api.openai.com/v1 */
	baseUrl: string;
	/** API 密钥（可选，本地服务通常无需填写） */
	apiKey: string;
	/** 模型名称（必填），如 gpt-4o-mini */
	modelName: string;
	/** 结构化输出模式（针对该后端的能力适配） */
	structuredOutput: StructuredOutputMode;
	/** 代理覆盖：未设置 = 跟随全局开关（云端走代理、本地直连的切换诉求） */
	proxyEnabled?: boolean;
	/** 代理覆盖地址：未设置或为空 = 跟随全局代理地址 */
	proxyUrl?: string;
	/** 最长 token 覆盖：未设置 = 跟随全局 */
	maxTokens?: number;
}

/** 表单草稿：与 ModelProfile 相比缺少 id，可选字段允许缺省 */
export type ModelProfileDraft = Omit<ModelProfile, 'id'>;

/** 结构化输出模式的界面文案（设置页下拉与弹窗共用） */
export const STRUCTURED_OUTPUT_MODE_OPTIONS: Record<StructuredOutputMode, string> =
	{
		auto: '自动（推荐）',
		json_object: 'JSON 对象模式（json_object）',
		json_schema: 'JSON 架构模式（json_schema）',
		none: '不使用（仅提示词约束）',
	};

/** 档位覆盖 maxTokens 的合法区间（与设置页全局“最长 token”一致） */
export const MODEL_PROFILE_MAX_TOKENS_MIN = 256;
export const MODEL_PROFILE_MAX_TOKENS_MAX = 32768;

/** 旧版本遗留的无效设置键：迁移时从 data.json 剥离，避免永久滞留 */
const LEGACY_RESIDUE_KEYS = ['retryCount', 'thinkingEnabled'] as const;

/** 旧版扁平配置迁移生成的首个档位默认名称 */
const MIGRATED_PROFILE_NAME = '默认接入';

/** 生成档位 id：Electron 渲染进程与 Node 18+ 均提供全局 crypto.randomUUID，异常时回退随机串 */
export function createModelProfileId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `profile-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 10)}`;
}

/**
 * 规范化档位草稿：接受不完整的草稿（如表单半填写状态），
 * 去除首尾空白并补全协议、结构化输出默认值。
 * @param draft 原始草稿（允许缺省字段）
 * @returns 规范化后的完整草稿
 */
export function normalizeModelProfileDraft(
	draft: Partial<ModelProfileDraft>,
): ModelProfileDraft {
	return {
		name: (draft.name ?? '').trim(),
		protocol: draft.protocol ?? 'openai-compatible',
		baseUrl: (draft.baseUrl ?? '').trim(),
		apiKey: (draft.apiKey ?? '').trim(),
		modelName: (draft.modelName ?? '').trim(),
		structuredOutput: draft.structuredOutput ?? 'auto',
		proxyEnabled: draft.proxyEnabled,
		proxyUrl: draft.proxyUrl,
		maxTokens: draft.maxTokens,
	};
}

/**
 * 校验档位草稿，返回中文问题列表（空数组 = 合法）。
 * @param draft 已规范化的草稿
 * @param others 其余档位（用于名称查重）
 * @param excludeId 编辑场景下排除自身的 id
 * @returns 问题列表
 */
export function validateModelProfileDraft(
	draft: ModelProfileDraft,
	others: readonly ModelProfile[],
	excludeId?: string,
): string[] {
	const issues: string[] = [];
	if (!draft.name) {
		issues.push('名称不能为空');
	} else if (
		others.some(
			(profile) =>
				profile.id !== excludeId &&
				profile.name.trim().toLowerCase() === draft.name.toLowerCase(),
		)
	) {
		issues.push('名称与其他接入口重复');
	}
	if (!draft.baseUrl) {
		issues.push('API 地址不能为空');
	} else if (!/^https?:\/\//i.test(draft.baseUrl)) {
		issues.push('API 地址需以 http:// 或 https:// 开头');
	}
	if (!draft.modelName) {
		issues.push('模型名称不能为空');
	}
	if (draft.maxTokens !== undefined) {
		const { maxTokens } = draft;
		if (
			!Number.isInteger(maxTokens) ||
			maxTokens < MODEL_PROFILE_MAX_TOKENS_MIN ||
			maxTokens > MODEL_PROFILE_MAX_TOKENS_MAX
		) {
			issues.push(
				`最长 token 需为 ${MODEL_PROFILE_MAX_TOKENS_MIN}-${MODEL_PROFILE_MAX_TOKENS_MAX} 之间的整数`,
			);
		}
	}
	return issues;
}

/**
 * 新增档位（纯函数）：追加到末尾并生成新 id。
 * 调用方需先通过 validateModelProfileDraft 校验。
 * @param profiles 现有档位列表
 * @param draft 档位草稿
 * @returns 更新后的档位列表
 */
export function addModelProfile(
	profiles: readonly ModelProfile[],
	draft: ModelProfileDraft,
): ModelProfile[] {
	return [...profiles, { id: createModelProfileId(), ...normalizeModelProfileDraft(draft) }];
}

/**
 * 更新档位（纯函数）：按 id 替换字段并保留原 id；id 不存在时原样返回。
 * @param profiles 现有档位列表
 * @param id 目标档位 id
 * @param draft 档位草稿
 * @returns 更新后的档位列表
 */
export function updateModelProfile(
	profiles: readonly ModelProfile[],
	id: string,
	draft: ModelProfileDraft,
): ModelProfile[] {
	return profiles.map((profile) =>
		profile.id === id
			? { ...profile, ...normalizeModelProfileDraft(draft), id }
			: profile,
	);
}

/**
 * 删除档位（纯函数）：按 id 过滤。
 * @param profiles 现有档位列表
 * @param id 目标档位 id
 * @returns 更新后的档位列表
 */
export function removeModelProfile(
	profiles: readonly ModelProfile[],
	id: string,
): ModelProfile[] {
	return profiles.filter((profile) => profile.id !== id);
}

/**
 * 按 id 查找档位。
 * @param profiles 档位列表
 * @param id 档位 id
 * @returns 命中的档位；未命中返回 undefined
 */
export function findModelProfile(
	profiles: readonly ModelProfile[],
	id: string,
): ModelProfile | undefined {
	return profiles.find((profile) => profile.id === id);
}

/** 模型档位集合的宿主形状（由 EnPracticeSettings 结构性满足） */
export interface ModelProfileHost {
	models: ModelProfile[];
	activeModelId: string;
}

/**
 * 获取当前生效的档位：优先激活标识命中的档位，失效时回退首个档位。
 * @param settings 档位宿主
 * @returns 生效档位；无档位时返回 undefined
 */
export function getActiveModelProfile(
	settings: ModelProfileHost,
): ModelProfile | undefined {
	// 防御旧形状数据：迁移前的设置对象可能没有 models 字段
	const models = settings.models ?? [];
	return findModelProfile(models, settings.activeModelId) ?? models[0];
}

/** 解析器输入的全局设置形状（由 EnPracticeSettings 结构性满足） */
export interface GlobalModelDefaults extends ModelProfileHost {
	/** @deprecated 旧版单模型配置字段，仅在迁移与无档位回退时读取 */
	apiKey?: string;
	/** @deprecated 旧版单模型配置字段，仅在迁移与无档位回退时读取 */
	baseUrl?: string;
	/** @deprecated 旧版单模型配置字段，仅在迁移与无档位回退时读取 */
	modelName?: string;
	/** 全局最长 token（档位未覆盖时使用） */
	maxTokens: number;
	/** 全局代理开关（档位未覆盖时使用） */
	proxyEnabled: boolean;
	/** 全局代理地址（档位未覆盖时使用） */
	proxyUrl: string;
	/** 是否启用流式输出（全局） */
	streamingEnabled: boolean;
	/** 调试模式（全局） */
	debugMode: boolean;
}

/** AI 层消费的模型运行配置（激活档位与全局默认的合成结果） */
export interface ResolvedModelSettings {
	/** 接口协议 */
	protocol: ModelProtocol;
	/** API 请求地址（已 trim；未配置时为空字符串） */
	baseUrl: string;
	/** API 密钥 */
	apiKey: string;
	/** 模型名称（已 trim） */
	modelName: string;
	/** 结构化输出模式（来自激活档位） */
	structuredOutput: StructuredOutputMode;
	/** 最长 token（档位覆盖优先，回退全局） */
	maxTokens: number;
	/** 代理开关（档位覆盖优先，回退全局） */
	proxyEnabled: boolean;
	/** 代理地址（档位覆盖优先，回退全局） */
	proxyUrl: string;
	/** 是否启用流式输出（全局） */
	streamingEnabled: boolean;
	/** 调试模式（全局） */
	debugMode: boolean;
}

/**
 * 按指定档位合成运行配置（其余字段取全局默认）。
 * 供「测试连接」探测未保存的候选档位使用。
 * @param settings 全局设置
 * @param profile 目标档位
 * @returns 运行配置
 */
export function resolveModelSettingsForProfile(
	settings: GlobalModelDefaults,
	profile: ModelProfile,
): ResolvedModelSettings {
	return {
		protocol: profile.protocol,
		baseUrl: profile.baseUrl.trim(),
		apiKey: profile.apiKey,
		modelName: profile.modelName.trim(),
		structuredOutput: profile.structuredOutput,
		maxTokens: profile.maxTokens ?? settings.maxTokens,
		proxyEnabled: profile.proxyEnabled ?? settings.proxyEnabled,
		proxyUrl: profile.proxyUrl?.trim()
			? profile.proxyUrl.trim()
			: settings.proxyUrl,
		streamingEnabled: settings.streamingEnabled,
		debugMode: settings.debugMode,
	};
}

/** 旧版扁平字段的局部视图：这些属性已标记废弃，此处为兼容回退的刻意读取 */
interface LegacyFlatFields {
	apiKey?: string;
	baseUrl?: string;
	modelName?: string;
}

/**
 * 单一解析点：把激活档位与全局默认合成为 AI 层消费的运行配置。
 * - 有档位：激活档位字段优先，覆盖项未设置时回退全局默认；
 * - 无档位：回退旧版扁平字段（@deprecated，保证迁移前数据与既有调用路径可用）；
 * - 无任何配置：返回未配置形状（baseUrl/modelName 为空，由 isConfigValid 判定）。
 * @param settings 全局设置
 * @returns 运行配置
 */
export function resolveActiveModelSettings(
	settings: GlobalModelDefaults,
): ResolvedModelSettings {
	const profile = getActiveModelProfile(settings);
	if (profile) {
		return resolveModelSettingsForProfile(settings, profile);
	}
	// 经局部视图读取旧版扁平字段，避免直接引用已废弃的属性符号
	const legacy = settings as LegacyFlatFields;
	const legacyBaseUrl = (legacy.baseUrl ?? '').trim();
	const legacyModelName = (legacy.modelName ?? '').trim();
	const legacyConfigured = legacyBaseUrl !== '' && legacyModelName !== '';
	return {
		protocol: 'openai-compatible',
		baseUrl: legacyConfigured ? legacyBaseUrl : '',
		apiKey: legacyConfigured ? (legacy.apiKey ?? '') : '',
		modelName: legacyConfigured ? legacyModelName : '',
		structuredOutput: 'auto',
		maxTokens: settings.maxTokens,
		proxyEnabled: settings.proxyEnabled,
		proxyUrl: settings.proxyUrl,
		streamingEnabled: settings.streamingEnabled,
		debugMode: settings.debugMode,
	};
}

/**
 * 旧版单模型配置迁移：把旧扁平字段打包为首个档位并激活；
 * 同时剥离历史版本遗留的无效设置键、修正失效的激活标识。
 * 在 loadSettings 中执行，返回 true 时调用方需立即写回 data.json。
 * @param settings 全局设置（就地修改）
 * @returns 是否发生变更
 */
export function applyLegacyModelMigration(
	settings: GlobalModelDefaults,
): boolean {
	let changed = false;

	// 剥离历史版本遗留的无效设置键（如 retryCount / thinkingEnabled）
	const record = settings as unknown as Record<string, unknown>;
	for (const key of LEGACY_RESIDUE_KEYS) {
		if (key in record) {
			delete record[key];
			changed = true;
		}
	}

	// 旧扁平字段 → 首个档位（仅当尚未建立任何档位时执行一次，保证幂等）；
	// 经局部视图读取旧版扁平字段，避免直接引用已废弃的属性符号
	if ((settings.models ?? []).length === 0) {
		const legacy = settings as LegacyFlatFields;
		const legacyBaseUrl = (legacy.baseUrl ?? '').trim();
		const legacyModelName = (legacy.modelName ?? '').trim();
		if (legacyBaseUrl !== '' && legacyModelName !== '') {
			settings.models = addModelProfile(settings.models, {
				name: MIGRATED_PROFILE_NAME,
				protocol: 'openai-compatible',
				baseUrl: legacyBaseUrl,
				apiKey: legacy.apiKey ?? '',
				modelName: legacyModelName,
				structuredOutput: 'auto',
			});
			settings.activeModelId = settings.models[0]?.id ?? '';
			changed = true;
		}
	}

	// 修正失效的激活标识（指向已不存在的档位时回退首个档位）
	const active = getActiveModelProfile(settings);
	const expectedActiveId = active?.id ?? '';
	if (settings.activeModelId !== expectedActiveId) {
		settings.activeModelId = expectedActiveId;
		changed = true;
	}
	return changed;
}

/**
 * 宿主级新增：校验 → 追加档位；首个档位自动激活，避免新增后仍处于未配置状态。
 * @param host 档位宿主（就地修改）
 * @param draft 档位草稿
 * @returns 问题列表（空数组 = 成功）
 */
export function applyAddModelProfile(
	host: ModelProfileHost,
	draft: ModelProfileDraft,
): string[] {
	const normalized = normalizeModelProfileDraft(draft);
	const issues = validateModelProfileDraft(normalized, host.models);
	if (issues.length > 0) {
		return issues;
	}
	const wasEmpty = host.models.length === 0;
	host.models = addModelProfile(host.models, normalized);
	if (wasEmpty) {
		host.activeModelId = host.models[host.models.length - 1]?.id ?? '';
	}
	return [];
}

/**
 * 宿主级更新：校验（排除自身查重）→ 按 id 替换字段。
 * @param host 档位宿主（就地修改）
 * @param id 目标档位 id
 * @param draft 档位草稿
 * @returns 问题列表（空数组 = 成功）
 */
export function applyUpdateModelProfile(
	host: ModelProfileHost,
	id: string,
	draft: ModelProfileDraft,
): string[] {
	if (!findModelProfile(host.models, id)) {
		return ['模型接入口不存在'];
	}
	const normalized = normalizeModelProfileDraft(draft);
	const issues = validateModelProfileDraft(normalized, host.models, id);
	if (issues.length > 0) {
		return issues;
	}
	host.models = updateModelProfile(host.models, id, normalized);
	return [];
}

/**
 * 宿主级删除：删除激活档位后自动切换到剩余首个档位；
 * 不允许删除最后一个档位，避免误删导致已录入的密钥等信息丢失。
 * @param host 档位宿主（就地修改）
 * @param id 目标档位 id
 * @returns 问题列表（空数组 = 成功）
 */
export function applyRemoveModelProfile(
	host: ModelProfileHost,
	id: string,
): string[] {
	if (!findModelProfile(host.models, id)) {
		return ['模型接入口不存在'];
	}
	if (host.models.length <= 1) {
		return ['至少保留一个模型接入口'];
	}
	host.models = removeModelProfile(host.models, id);
	if (host.activeModelId === id) {
		host.activeModelId = host.models[0]?.id ?? '';
	}
	return [];
}

/**
 * 宿主级切换激活档位。
 * @param host 档位宿主（就地修改）
 * @param id 目标档位 id
 * @returns 问题列表（空数组 = 成功）
 */
export function applySetActiveModelProfile(
	host: ModelProfileHost,
	id: string,
): string[] {
	if (!findModelProfile(host.models, id)) {
		return ['模型接入口不存在'];
	}
	host.activeModelId = id;
	return [];
}
