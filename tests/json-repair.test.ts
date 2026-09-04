import { describe, expect, it } from 'vitest';
import { repairJsonText } from '../src/utils/json-repair';

describe('repairJsonText', () => {
	it('修复字符串值内未转义的英文双引号（回归线上日志）', () => {
		const broken = '"usage": "表示"资源和资产"，用于描述有价值的人或物。"';
		const repaired = repairJsonText(`{\n  ${broken}\n}`);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as { usage: string };
		// 字段值原样保留，仅内部引号被转义
		expect(parsed.usage).toBe('表示"资源和资产"，用于描述有价值的人或物。');
	});

	it('修复完整 JSON 对象中的多处未转义引号', () => {
		const broken =
			'{"a": "他说"你好"，然后离开", "b": "引号"在这里"}';
		const repaired = repairJsonText(broken);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as {
			a: string;
			b: string;
		};
		expect(parsed.a).toBe('他说"你好"，然后离开');
		expect(parsed.b).toBe('引号"在这里');
	});

	it('已转义的引号与合法 JSON 不做任何变更', () => {
		const valid = '{"a": "他说\\"你好\\"", "b": [1, 2], "c": {"d": true}}';
		expect(repairJsonText(valid)).toBeNull();
	});

	it('单引号与中文引号不受影响', () => {
		const broken = '{"a": "他说\'你好\'，引用"词语"完成"}';
		const repaired = repairJsonText(broken);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as { a: string };
		expect(parsed.a).toBe('他说\'你好\'，引用"词语"完成');
	});

	it('文本在字符串中途截断时不做无意义变更', () => {
		// 修复器只处理引号缺陷；截断等缺失类缺陷无变更，返回 null 交由上层报错
		expect(repairJsonText('{"a": "b"')).toBeNull();
	});
});
