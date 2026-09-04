import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					// 上限略高于测试文件数量，新增测试文件时同步登记下方 allowDefaultProject
					maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 25,
					allowDefaultProject: [
					'eslint.config.mts',
					'manifest.json',
					'vitest.config.ts',
					// 测试文件不在 tsconfig 覆盖范围内，需逐个登记到 default project
					'tests/prompts.test.ts',
					'tests/structured-output.test.ts',
					'tests/model.test.ts',
					'tests/sentence-utils.test.ts',
					'tests/grammar-validator.test.ts',
					'tests/grammar-normalize.test.ts',
					'tests/panel-events.test.ts',
					'tests/grammar-highlight.test.ts',
					'tests/grammar-render.test.ts',
					'tests/controls.test.ts',
					'tests/editor.test.ts',
					'tests/score.test.ts',
					'tests/debug-log.test.ts',
					'tests/proxy-fetch.test.ts',
					'tests/grammar-graph.test.ts',
					'tests/grammar-improvement.test.ts',
					'tests/writing-options.test.ts',
					'tests/improvement-render.test.ts',
					'tests/setup.ts',
				],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/setup.ts'],
		rules: {
			// 测试 mock 中没有 obsidian createDiv 运行时实现，保留原生 DOM 创建方式
			'obsidianmd/prefer-create-el': 'off',
		},
	},
	{
		rules: {
			// URL、API Key 占位符与模型名属于大小写敏感内容，跳过 sentence-case 误报
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					ignoreRegex: [
						'sk-\\.\\.\\.',
						'https?://\\S+',
						'gpt-4o-mini',
						'Clash\\s+Verge',
					],
				},
			],
		},
	},
);
