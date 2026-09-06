import { describe, expect, it } from 'vitest';
import { paginate } from '../src/utils/pagination';

describe('paginate', () => {
	it('常规分页：计算页数与当前页切片区间', () => {
		const result = paginate(12, 1, 5);
		expect(result).toEqual({
			totalItems: 12,
			page: 1,
			pageSize: 5,
			pageCount: 3,
			startIndex: 0,
			endIndex: 5,
		});
		// 末页切片不越界
		expect(paginate(12, 3, 5)).toMatchObject({
			page: 3,
			pageCount: 3,
			startIndex: 10,
			endIndex: 12,
		});
	});

	it('页码越界时收敛到合法区间', () => {
		expect(paginate(12, 0, 5).page).toBe(1);
		expect(paginate(12, -5, 5).page).toBe(1);
		expect(paginate(12, 99, 5).page).toBe(3);
	});

	it('整除时最后一页恰好取完', () => {
		expect(paginate(10, 2, 5)).toMatchObject({
			pageCount: 2,
			startIndex: 5,
			endIndex: 10,
		});
	});

	it('无数据时页数为 0，页码收敛为 1 且切片为空区间', () => {
		expect(paginate(0, 5, 5)).toEqual({
			totalItems: 0,
			page: 1,
			pageSize: 5,
			pageCount: 0,
			startIndex: 0,
			endIndex: 0,
		});
	});

	it('非法每页大小按 1 处理，避免除零', () => {
		const result = paginate(3, 1, 0);
		expect(result.pageSize).toBe(1);
		expect(result.pageCount).toBe(3);
	});
});
