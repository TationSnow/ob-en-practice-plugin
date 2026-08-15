/** 主题下拉中的“随机”选项常量 */
export const RANDOM_THEME = '随机';

/**
 * 规范化主题名称：去除首尾空白并合并连续空白。
 * @param input 原始输入
 * @returns 规范化后的主题名称
 */
export function normalizeThemeName(input: string): string {
	return input.trim().replace(/\s+/g, ' ');
}

/**
 * 判断主题列表中是否已存在同名主题（忽略大小写）。
 * @param themes 现有主题列表
 * @param name 待检查的主题名称
 * @returns 是否存在
 */
export function hasTheme(themes: readonly string[], name: string): boolean {
	const normalized = normalizeThemeName(name);
	if (!normalized) return false;
	return themes.some(
		(item) => item.toLowerCase() === normalized.toLowerCase(),
	);
}

/**
 * 新增主题：自动去重并忽略空名称。
 * @param themes 现有主题列表
 * @param name 新主题名称
 * @returns 更新后的主题列表
 */
export function addTheme(
	themes: readonly string[],
	name: string,
): string[] {
	const normalized = normalizeThemeName(name);
	if (!normalized || hasTheme(themes, normalized)) {
		return [...themes];
	}
	return [...themes, normalized];
}

/**
 * 重命名主题：空名称或与其他主题重名时不修改。
 * @param themes 现有主题列表
 * @param oldName 原主题名称
 * @param newName 新主题名称
 * @returns 更新后的主题列表
 */
export function renameTheme(
	themes: readonly string[],
	oldName: string,
	newName: string,
): string[] {
	const normalized = normalizeThemeName(newName);
	if (!normalized || normalized === oldName) {
		return [...themes];
	}
	const others = themes.filter((item) => item !== oldName);
	if (hasTheme(others, normalized)) {
		return [...themes];
	}
	return themes.map((item) => (item === oldName ? normalized : item));
}

/**
 * 删除主题。
 * @param themes 现有主题列表
 * @param name 要删除的主题名称
 * @returns 更新后的主题列表
 */
export function removeTheme(
	themes: readonly string[],
	name: string,
): string[] {
	return themes.filter((item) => item !== name);
}

/**
 * 解析生成题目时实际使用的主题。
 * 选中“随机”且存在自定义主题时随机挑选一个；没有自定义主题时返回 null（不指定主题）。
 * @param selected 下拉框当前选中值
 * @param themes 自定义主题列表
 * @param random 随机数函数（默认为 Math.random，测试时可注入）
 * @returns 实际使用的主题；null 表示不指定主题
 */
export function resolveSelectedTheme(
	selected: string,
	themes: readonly string[],
	random: () => number = Math.random,
): string | null {
	if (selected !== RANDOM_THEME) {
		return selected;
	}
	if (themes.length === 0) {
		return null;
	}
	const index = Math.min(
		themes.length - 1,
		Math.floor(random() * themes.length),
	);
	return themes[index] ?? null;
}

/**
 * 生成随机数种子文本。
 * 每次调用产生新值，用于题目生成时避免每次得到相同题目。
 * @param random 随机数函数（默认 Math.random，测试时可注入）
 * @returns 随机种子文本
 */
export function createRandomSeed(random: () => number = Math.random): string {
	return `seed-${Date.now().toString(36)}-${Math.floor(
		random() * 0x7fffffff,
	).toString(36)}`;
}
