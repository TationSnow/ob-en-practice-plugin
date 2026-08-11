/** 分数等级对应的语义化 CSS 类 */
export type ScoreClass = 'is-high' | 'is-mid' | 'is-low';

/**
 * 根据分数返回语义化等级。
 * @param score 0-100 的分数
 * @returns 等级类名
 */
export function getScoreClass(score: number): ScoreClass {
	if (score >= 80) return 'is-high';
	if (score >= 60) return 'is-mid';
	return 'is-low';
}
