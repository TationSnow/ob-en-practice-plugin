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

describe('repairJsonText（缺失收尾引号修复）', () => {
	it('修复字符串值缺失收尾引号（回归线上日志：全角引号干扰）', () => {
		// 取自真实报错日志：模型把释义末尾的全角引号误当字符串结束，漏掉收尾直引号
		const broken =
			'{\n  "hasGrammarIssues": true,\n  "summary": "缺少冠词，应为“the elders”或“elderly people”\n}\n';
		const repaired = repairJsonText(broken);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as {
			hasGrammarIssues: boolean;
			summary: string;
		};
		expect(parsed.hasGrammarIssues).toBe(true);
		// 全角引号内容原样保留
		expect(parsed.summary).toBe(
			'缺少冠词，应为“the elders”或“elderly people”',
		);
	});

	it('文本结束时仍在字符串内：收尾引号插在尾部结构闭符之前', () => {
		// 尾部的 } 按启发式视为对象收口（而非字符串内容），引号插在其前
		const repaired = repairJsonText('{"a": "未闭合}');
		expect(repaired).toBe('{"a": "未闭合"}');
		const parsed = JSON.parse(repaired as string) as { a: string };
		expect(parsed.a).toBe('未闭合');
	});

	it('字符串内裸换行且下一行为续行内容时，转义换行保持字符串延续', () => {
		const broken = '{"a": "第一行\n第二行"}';
		const repaired = repairJsonText(broken);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as { a: string };
		expect(parsed.a).toBe('第一行\n第二行');
	});

	it('CRLF 行尾的缺失收尾引号同样修复', () => {
		const broken =
			'{\r\n  "a": "缺少收尾引号\r\n}';
		const repaired = repairJsonText(broken);

		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired as string) as { a: string };
		expect(parsed.a).toBe('缺少收尾引号');
	});

	it('合法 JSON 中的转义换行与换行缩进不受影响', () => {
		// 值内的 \n 为转义序列（两个字符），对象间的换行缩进在字符串外
		const valid = '{\n  "a": "第一行\\n第二行",\n  "b": 1\n}';
		expect(repairJsonText(valid)).toBeNull();
	});
});
