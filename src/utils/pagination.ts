/**
 * 分页纯函数：供词典查询面板等列表场景使用。
 * 只负责状态计算（页数、切片区间、页码收敛），不涉及 DOM。
 */

/** 分页计算结果 */
export interface PaginationResult {
	/** 数据总数 */
	totalItems: number;
	/** 收敛后的当前页（1 起） */
	page: number;
	/** 收敛后的每页大小 */
	pageSize: number;
	/** 总页数（无数据时为 0） */
	pageCount: number;
	/** 当前页切片起始下标（0 起，含） */
	startIndex: number;
	/** 当前页切片结束下标（不含） */
	endIndex: number;
}

/**
 * 计算分页状态。
 * 页码越界自动收敛到 [1, max(1, pageCount)]；每页大小小于 1 按 1 处理，避免除零。
 * @param totalItems 数据总数
 * @param page 期望页码（1 起，可越界）
 * @param pageSize 每页大小
 * @returns 分页状态
 */
export function paginate(
	totalItems: number,
	page: number,
	pageSize: number,
): PaginationResult {
	const safePageSize = pageSize >= 1 ? pageSize : 1;
	const pageCount =
		totalItems > 0 ? Math.ceil(totalItems / safePageSize) : 0;
	const safePage = Math.min(Math.max(page, 1), Math.max(pageCount, 1));
	const startIndex = (safePage - 1) * safePageSize;
	const endIndex = Math.min(startIndex + safePageSize, totalItems);
	return {
		totalItems,
		page: safePage,
		pageSize: safePageSize,
		pageCount,
		startIndex,
		endIndex,
	};
}
